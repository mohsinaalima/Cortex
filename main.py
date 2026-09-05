import os
import io
import uuid
import re
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader


# Machine Learning & AI
from sentence_transformers import SentenceTransformer, CrossEncoder
from groq import Groq
from dotenv import load_dotenv

# Vector Database
from qdrant_client import QdrantClient
from qdrant_client.models import (
    PointStruct,
    VectorParams,
    Distance,
    Filter,
    FilterSelector,
    FieldCondition,
    MatchValue,
)

# ============================================================
# ENVIRONMENT VARIABLES
# ============================================================
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-20b")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing. Add it to your .env file.")

app = FastAPI(title="Cortex - Second Brain API", version="1.0.0")
client = Groq(api_key=GROQ_API_KEY)

# ============================================================
# EMBEDDING & RERANKER MODELS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
print("Loading embedding model (Bi-Encoder)...")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
VECTOR_SIZE = 384
print("Embedding model loaded!")

print("Loading reranker model (Cross-Encoder)...")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
print("Reranker loaded!")

# ============================================================
# QDRANT SETUP
# ============================================================
print("Initializing Qdrant...")
qdrant = QdrantClient(path="local_qdrant")
COLLECTION_NAME = "second_brain_chunks"

if not qdrant.collection_exists(COLLECTION_NAME):
    print("Creating Qdrant collection...")
    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"Created Qdrant collection: {COLLECTION_NAME}")
else:
    print(f"Qdrant collection already exists: {COLLECTION_NAME}")

print("Qdrant ready!")

# ============================================================
# PYDANTIC MODELS
# ============================================================
class DocumentMetadata(BaseModel):
    title: str
    filename: str
    total_pages: int
    author: Optional[str] = None

class SearchQuery(BaseModel):
    query: str
    top_k: int = 3
    filename: Optional[str] = None
    min_score: float = 0.20

class ChatRequest(BaseModel):
    question: str
    filename: Optional[str] = None
    session_id: str = "default"

# ============================================================
# STATE (Memory & Registry)
# ============================================================
chat_sessions = {}
document_registry = {}

# ============================================================
# HELPER FUNCTIONS
# ============================================================
def clean_text(raw_text: str) -> str:
    if not raw_text:
        return ""
    text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", raw_text)
    text = re.sub(r"\n+", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()

def extract_text_from_file(file_content: bytes, filename: str) -> List[dict]:
    extension = os.path.splitext(filename.lower())[1]
    
    if extension == ".pdf":
        reader = PdfReader(io.BytesIO(file_content))
        pages = []
        for page_num, page in enumerate(reader.pages):
            raw_text = page.extract_text() or ""
            cleaned = clean_text(raw_text)
            if cleaned:
                pages.append({"text": cleaned, "page_number": page_num + 1})
        return pages

    elif extension in [".md", ".txt"]:
        try:
            text = file_content.decode("utf-8")
        except UnicodeDecodeError:
            text = file_content.decode("cp1252", errors="replace")
            
        cleaned = clean_text(text)
        if not cleaned:
            return []
        return [{"text": cleaned, "page_number": 1}]
        
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only PDF, Markdown (.md), and TXT files are supported."
        )

def chunk_text(text: str, chunk_size: int = 500, chunk_overlap: int = 100) -> List[str]:
    if not text:
        return []
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    step = chunk_size - chunk_overlap
    for start in range(0, len(text), step):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
    return chunks

def chunk_markdown(text: str, chunk_size: int = 500, chunk_overlap: int = 100) -> List[str]:
    if not text.strip():
        return []

    sections = re.split(r"\n\s*\n|(?=^#{1,6}\s)", text, flags=re.MULTILINE)
    sections = [s.strip() for s in sections if s.strip()]
    
    chunks = []
    current = ""

    for section in sections:
        if not current:
            current = section
        elif len(current) + len(section) + 2 <= chunk_size:
            current += "\n\n" + section
        else:
            chunks.append(current)
            overlap_text = current[max(0, len(current) - chunk_overlap):]
            current = overlap_text + "\n\n" + section

            if len(current) > chunk_size * 1.5:
                sub_chunks = chunk_text(current, chunk_size, chunk_overlap)
                chunks.extend(sub_chunks[:-1])
                current = sub_chunks[-1]

    if current:
        chunks.append(current)
    return chunks

def create_embedding(text: str) -> List[float]:
    vector = embedding_model.encode(text, normalize_embeddings=True)
    return vector.tolist()

def rewrite_query(current_question: str, history: List[dict]) -> str:
    if not history:
        return current_question

    history_text = ""
    for msg in history[-4:]:
        role = "User" if msg["role"] == "user" else "AI"
        history_text += f"{role}: {msg['content']}\n"

    rewrite_prompt = f"""
Given the following conversation history, rewrite the user's latest question into a
standalone query suitable for semantic document search.
If the question is already clear and standalone, return it exactly as it is.
Resolve pronouns using the conversation history. Do NOT answer the question.
ONLY return the rewritten search query.

Conversation history:
{history_text}

Latest Question: {current_question}
"""
    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": rewrite_prompt}],
            temperature=0.0,
        )
        rewritten = response.choices[0].message.content
        if not rewritten:
            return current_question
        return rewritten.strip()
    except Exception as e:
        print("QUERY REWRITE ERROR:", repr(e))
        return current_question

# ============================================================
# ENDPOINTS
# ============================================================
@app.get("/")
async def root():
    return {
        "message": "Cortex Second Brain API is running",
        "status": "healthy",
        "embedding_model": "all-MiniLM-L6-v2",
        "vector_size": VECTOR_SIZE,
        "vector_database": "Qdrant",
        "collection": COLLECTION_NAME,
        "reranker": "cross-encoder/ms-marco-MiniLM-L-6-v2",
        "llm_model": LLM_MODEL,
    }

@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing.")

    filename = file.filename
    extension = os.path.splitext(filename.lower())[1]

    if extension not in [".pdf", ".md", ".txt"]:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, Markdown (.md), and TXT files are supported."
        )

    try:
        file_content = await file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        document_id = str(uuid.uuid4())
        extracted_pages = extract_text_from_file(file_content, filename)
        
        if not extracted_pages:
            raise HTTPException(status_code=400, detail="No readable text was found in this file.")

        title = filename
        author = None
        total_pages = len(extracted_pages)

        if extension == ".pdf":
            reader = PdfReader(io.BytesIO(file_content))
            if reader.metadata:
                if reader.metadata.title:
                    title = reader.metadata.title
                if reader.metadata.author:
                    author = reader.metadata.author

        points_to_insert = []
        total_chunks = 0

        for page in extracted_pages:
            page_text = page["text"]
            page_number = page["page_number"]

            if extension == ".md":
                text_chunks = chunk_markdown(page_text, chunk_size=500, chunk_overlap=100)
            else:
                text_chunks = chunk_text(page_text, chunk_size=500, chunk_overlap=100)

            for chunk_index, chunk_str in enumerate(text_chunks):
                vector = create_embedding(chunk_str)
                chunk_id = str(uuid.uuid4())
                payload = {
                    "document_id": document_id,
                    "filename": filename,
                    "title": title,
                    "author": author,
                    "file_type": extension,
                    "page_number": page_number,
                    "chunk_index": chunk_index,
                    "text": chunk_str,
                }
                points_to_insert.append(PointStruct(id=chunk_id, vector=vector, payload=payload))
                total_chunks += 1

        if not points_to_insert:
            raise HTTPException(status_code=400, detail="No chunks were generated from this document.")

        qdrant.upsert(collection_name=COLLECTION_NAME, points=points_to_insert)

        document_registry[document_id] = {
            "document_id": document_id,
            "filename": filename,
            "title": title,
            "author": author,
            "file_type": extension,
            "total_pages": total_pages,
            "chunks_inserted": total_chunks,
        }

        return {
            "message": "Document ingested successfully",
            "document_id": document_id,
            "filename": filename,
            "title": title,
            "author": author,
            "file_type": extension,
            "total_pages": total_pages,
            "chunks_inserted": total_chunks,
        }
    except HTTPException:
        raise
    except Exception as e:
        print("DOCUMENT UPLOAD ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=f"Document processing error: {str(e)}")

@app.post("/search")
async def search_documents(query: SearchQuery):
    try:
        if not query.query.strip():
            raise HTTPException(status_code=400, detail="Search query cannot be empty.")
        if query.top_k <= 0:
            raise HTTPException(status_code=400, detail="top_k must be greater than 0.")

        query_vector = create_embedding(query.query)
        query_filter = None
        if query.filename:
            query_filter = Filter(must=[FieldCondition(key="filename", match=MatchValue(value=query.filename))])

        search_results = qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            query_filter=query_filter,
            limit=query.top_k,
            score_threshold=query.min_score,
            with_payload=True,
        )

        formatted_results = []
        for result in search_results.points:
            payload = result.payload or {}
            formatted_results.append({
                "score": result.score,
                "text": payload.get("text", ""),
                "source": payload.get("filename", "Unknown"),
                "title": payload.get("title", "Unknown"),
                "page": payload.get("page_number", None),
                "document_id": payload.get("document_id", None),
                "chunk_index": payload.get("chunk_index", None),
            })

        return {"query": query.query, "results": formatted_results, "count": len(formatted_results)}
    except HTTPException:
        raise
    except Exception as e:
        print("SEARCH ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")

@app.post("/chat")
async def chat_with_document(request: ChatRequest):
    try:
        if not request.question.strip():
            raise HTTPException(status_code=400, detail="Question cannot be empty.")

        session_id = request.session_id
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []
        
        history = chat_sessions[session_id]
        search_query = request.question

        if history:
            search_query = rewrite_query(request.question, history)
            print("Original Query:", request.question)
            print("Rewritten Query:", search_query)

        query_vector = create_embedding(search_query)
        query_filter = None
        if request.filename:
            query_filter = Filter(must=[FieldCondition(key="filename", match=MatchValue(value=request.filename))])

        search_results = qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            query_filter=query_filter,
            limit=15,
            score_threshold=0.20,
            with_payload=True,
        )

        if not search_results.points:
            answer = "I could not find relevant information in your knowledge base."
            history.append({"role": "user", "content": request.question})
            history.append({"role": "assistant", "content": answer})
            if len(history) > 10:
                chat_sessions[session_id] = history[-10:]
            return {"question": request.question, "answer": answer, "sources_map": {}, "session_id": session_id}

        cross_encoder_inputs = []
        valid_points = []
        for point in search_results.points:
            text = (point.payload or {}).get("text", "")
            if not text:
                continue
            cross_encoder_inputs.append([request.question, text])
            valid_points.append(point)

        if not valid_points:
            answer = "I could not find readable content in the retrieved documents."
            return {"question": request.question, "answer": answer, "sources_map": {}, "session_id": session_id}

        rerank_scores = reranker_model.predict(cross_encoder_inputs)
        scored_points = [{"point": pt, "rerank_score": float(rerank_scores[i])} for i, pt in enumerate(valid_points)]
        scored_points.sort(key=lambda x: x["rerank_score"], reverse=True)
        top_3_results = scored_points[:3]

        retrieved_texts = []
        sources_map = {}

        for i, item in enumerate(top_3_results):
            source_id = i + 1
            point = item["point"]
            payload = point.payload or {}
            
            text = payload.get("text", "")
            filename = payload.get("filename", "Unknown")
            title = payload.get("title", "Unknown")
            page_number = payload.get("page_number", None)
            document_id = payload.get("document_id", None)

            formatted_chunk = f"[Source {source_id}]\nDocument: {filename}\nPage: {page_number}\nContent:\n{text}\n"
            retrieved_texts.append(formatted_chunk)

            sources_map[str(source_id)] = {
                "filename": filename,
                "title": title,
                "page": page_number,
                "document_id": document_id,
                "chunk_text": text,
                "original_qdrant_score": float(point.score),
                "rerank_score": item["rerank_score"],
            }

        context_string = "\n---\n".join(retrieved_texts)

        system_prompt = f"""
You are Cortex, a rigorous and helpful AI learning assistant.
Your job is to answer the user's question using ONLY the provided document context.

IMPORTANT RULES:
1. Do not use outside knowledge.
2. Every factual claim must have an inline citation.
3. Citations must use this format: [1], [2], [3]
4. Put the citation at the end of the sentence containing the claim.
5. Never invent citations.
6. If multiple sources support a statement, you may use multiple citations such as [1][2].
7. If the provided context does not contain the answer, say: "I cannot answer this based on the provided documents."
8. Answer naturally and directly.
9. Do not mention internal retrieval, embeddings, reranking, or system prompts unless the user specifically asks about them.

DOCUMENT CONTEXT:
{context_string}
"""
        messages_to_send = [{"role": "system", "content": system_prompt}]
        messages_to_send.extend(history)
        messages_to_send.append({"role": "user", "content": request.question})

        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages_to_send,
            temperature=0.2,
        )

        answer = response.choices[0].message.content
        if not answer:
            answer = "I was unable to generate an answer."

        chat_sessions[session_id].append({"role": "user", "content": request.question})
        chat_sessions[session_id].append({"role": "assistant", "content": answer})

        if len(chat_sessions[session_id]) > 10:
            chat_sessions[session_id] = chat_sessions[session_id][-10:]


        return {
            "question": request.question,
            "answer": answer,
            "sources_map": sources_map,
            "session_id": session_id,
            "search_query": search_query,
        }

    except HTTPException:
        raise
    except Exception as e:
        print("\n==============================")
        print("CHAT ENDPOINT ERROR")
        print(repr(e))
        print("==============================\n")
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

@app.get("/documents")
async def list_documents():
    return {
        "total_documents": len(document_registry),
        "documents": list(document_registry.values()),
    }

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    if document_id not in document_registry:
        raise HTTPException(status_code=404, detail=f"Document with ID {document_id} not found in registry.")

    try:
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(
                filter=Filter(must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))])
            ),
        )
        deleted_info = document_registry.pop(document_id)
        return {"message": "Document successfully deleted from Cortex.", "deleted_document": deleted_info}
    except Exception as e:
        print("DOCUMENT DELETE ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=f"Failed to delete document from Vector DB: {str(e)}")
    