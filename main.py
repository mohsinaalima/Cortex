from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader

from sentence_transformers import SentenceTransformer, CrossEncoder

from qdrant_client import QdrantClient
from qdrant_client.models import (
    PointStruct,
    VectorParams,
    Distance,
    Filter,
    FieldCondition,
    MatchValue,
    FilterSelector,
)

from openai import OpenAI
from dotenv import load_dotenv

import io
import uuid
import re
import os
from typing import List, Optional

# ============================================================
# ENVIRONMENT VARIABLES
# ============================================================
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing. Please add it to your .env file.")

# ============================================================
# FASTAPI & EXTERNAL CLIENTS
# ============================================================
app = FastAPI(title="Cortex - Personal Second Brain API", version="1.0.0")
client = OpenAI(api_key=OPENAI_API_KEY)

# ============================================================
# AI MODELS
# ============================================================
print("Loading embedding model (Bi-Encoder)...")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
VECTOR_SIZE = 384
print("Embedding model loaded!")

print("Loading reranker model (Cross-Encoder)...")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
print("Reranker loaded!")

# ============================================================
# QDRANT VECTOR DATABASE
# ============================================================
print("Initializing Qdrant...")
qdrant = QdrantClient(path="local_qdrant")
COLLECTION_NAME = "second_brain_chunks"

if not qdrant.collection_exists(COLLECTION_NAME):
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
    session_id: str = "default_session"

# ============================================================
# IN-MEMORY REGISTRIES (Will move to DB later)
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


def chunk_text(text: str, chunk_size: int = 500, chunk_overlap: int = 100) -> List[str]:
    chunks = []
    if not text:
        return chunks
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size.")
    if len(text) <= chunk_size:
        return [text]

    step = chunk_size - chunk_overlap
    for i in range(0, len(text), step):
        chunk = text[i:i + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
        if i + chunk_size >= len(text):
            break
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
You are a query rewriting system for a personal knowledge base.
Rewrite the user's latest question into a standalone semantic search query using the conversation history.
Resolve references like it, this, that, he, she.
IMPORTANT RULES:
1. Do NOT answer the question.
2. ONLY output the rewritten search query.
3. If already standalone, return it unchanged.

Conversation History:
{history_text}

Latest Question: {current_question}
Standalone Search Query:
"""
    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[{"role": "user", "content": rewrite_prompt}],
            temperature=0.0,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Query rewriting failed: {e}")
        return current_question

# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/")
async def root():
    return {
        "message": "Cortex Second Brain API is running",
        "status": "healthy",
        "features": ["Ingestion", "Reranking", "Memory", "Query Rewriting", "Document Management"]
    }

# ------------------------------------------------------------
# DOCUMENT MANAGEMENT
# ------------------------------------------------------------

@app.get("/documents")
async def list_documents():
    return {
        "total_documents": len(document_registry),
        "documents": list(document_registry.values()),
    }


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    if document_id not in document_registry:
        raise HTTPException(status_code=404, detail="Document not found in registry.")

    try:
        qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(
                filter=Filter(must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))])
            ),
        )
        deleted_info = document_registry.pop(document_id)
        return {"message": "Document successfully deleted.", "deleted_document": deleted_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {str(e)}")


@app.post("/documents/upload")
async def extract_text_from_file(file: UploadFile) -> List[dict]:
    """
    Factory function to extract text based on file extension.
    Returns a list of dictionaries: [{"page_number": int, "text": str}]
    """
    filename = file.filename.lower()
    file_bytes = await file.read()
    
    if not file_bytes:
        raise ValueError("Uploaded file is empty.")

    pages_data = []

    # ----------------------------------------------------
    # PDF PARSER
    # ----------------------------------------------------
    if filename.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(file_bytes))
        for page_num, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                pages_data.append({
                    "page_number": page_num + 1,
                    "text": text
                })
                
    # ----------------------------------------------------
    # TXT / MARKDOWN PARSER
    # ----------------------------------------------------
    elif filename.endswith(".txt") or filename.endswith(".md"):
        try:
            # Decode raw bytes to string
            text = file_bytes.decode("utf-8")
            # For plain text, we treat the entire file as "Page 1"
            if text.strip():
                pages_data.append({
                    "page_number": 1,
                    "text": text
                })
        except UnicodeDecodeError:
            raise ValueError("File is not a valid UTF-8 encoded text document.")
            
    # ----------------------------------------------------
    # UNSUPPORTED
    # ----------------------------------------------------
    else:
        raise ValueError("Unsupported file type. Please upload .pdf, .txt, or .md")

    return pages_data

# ------------------------------------------------------------
# SEMANTIC SEARCH
# ------------------------------------------------------------

@app.post("/search")
async def search_documents(query: SearchQuery):
    if not query.query.strip() or query.top_k <= 0:
        raise HTTPException(status_code=400, detail="Invalid search query or top_k.")

    try:
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
                "score": float(result.score),
                "text": payload.get("text", ""),
                "source": payload.get("filename", "Unknown"),
                "page": payload.get("page_number", None),
                "document_id": payload.get("document_id", None),
            })

        return {"query": query.query, "results": formatted_results, "count": len(formatted_results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")


# ------------------------------------------------------------
# CONVERSATIONAL RAG CHAT
# ------------------------------------------------------------

@app.post("/chat")
async def chat_with_document(request: ChatRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        session_id = request.session_id
        search_query = request.question

        # Step 1: Query Rewriting
        if session_id in chat_sessions and len(chat_sessions[session_id]) > 0:
            search_query = rewrite_query(request.question, chat_sessions[session_id])

        # Step 2: Retrieve Candidates (Stage 1)
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
            return {
                "question": request.question,
                "answer": "I could not find relevant information in your knowledge base.",
                "sources_map": {},
                "session_id": session_id,
            }

        # Step 3: Reranking (Stage 2)
        cross_encoder_inputs = [[search_query, pt.payload.get("text", "")] for pt in search_results.points]
        rerank_scores = reranker_model.predict(cross_encoder_inputs)

        scored_points = [{"point": pt, "rerank_score": float(rerank_scores[i])} for i, pt in enumerate(search_results.points)]
        scored_points.sort(key=lambda item: item["rerank_score"], reverse=True)
        top_3_results = scored_points[:3]

        # Step 4: Build Context
        retrieved_texts = []
        sources_map = {}

        for i, item in enumerate(top_3_results):
            source_id = i + 1
            pt = item["point"]
            payload = pt.payload or {}
            
            text = payload.get("text", "")
            filename = payload.get("filename", "Unknown")
            page_number = payload.get("page_number", None)

            formatted_chunk = f"[Source {source_id}]\nDocument: {filename}\nPage: {page_number}\nContent:\n{text}\n"
            retrieved_texts.append(formatted_chunk)

            sources_map[str(source_id)] = {
                "filename": filename,
                "page": page_number,
                "chunk_text": text,
                "rerank_score": item["rerank_score"],
            }

        context_string = "\n---\n".join(retrieved_texts)

        system_prompt = f"""
You are Cortex, a rigorous and helpful personal knowledge assistant.
Answer the user's question using ONLY the provided context.
If the answer is not present, say: "I cannot answer this based on the provided documents."
Every factual claim must include an inline citation formatted exactly like this: [1] or [2].
Put the citation immediately after the claim it supports.

RETRIEVED DOCUMENT CONTEXT:
{context_string}
"""
        # Step 5: Memory Injection
        if session_id not in chat_sessions:
            chat_sessions[session_id] = []

        messages_to_send = [{"role": "system", "content": system_prompt}]
        messages_to_send.extend(chat_sessions[session_id])
        messages_to_send.append({"role": "user", "content": request.question})

        # Step 6: Generate Answer
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages_to_send,
            temperature=0.2,
        )
        answer = response.choices[0].message.content

        # Step 7: Update Memory
        chat_sessions[session_id].append({"role": "user", "content": request.question})
        chat_sessions[session_id].append({"role": "assistant", "content": answer})
        if len(chat_sessions[session_id]) > 10:
            chat_sessions[session_id] = chat_sessions[session_id][-10:]

        return {
            "question": request.question,
            "search_query": search_query,
            "answer": answer,
            "sources_map": sources_map,
            "session_id": session_id,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG/LLM error: {str(e)}")