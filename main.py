import os
import io
import uuid
import re
import json
import base64
import requests
from bs4 import BeautifulSoup
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row

# Machine Learning & AI
from sentence_transformers import SentenceTransformer, CrossEncoder
from openai import OpenAI

# Vector Database
from qdrant_client import QdrantClient
from qdrant_client.models import (
    PointStruct,
    VectorParams,
    Distance,
    Filter,
    FieldCondition,
    MatchValue,
)

# ============================================================
# ENVIRONMENT VARIABLES
# ============================================================
load_dotenv()

# Google documents both names in its tooling; prefer the Gemini-specific one.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
LLM_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-3.6-flash")
DATABASE_URL = os.getenv("DATABASE_URL")

if not GEMINI_API_KEY:
    raise RuntimeError(
        "Gemini API key is missing. Add GEMINI_API_KEY=your_gemini_api_key "
        "(or GOOGLE_API_KEY=your_gemini_api_key) to your .env file."
    )

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing. Add your Neon PostgreSQL connection string to .env.")

# ============================================================
# INITIALIZE CLIENTS & APP
# ============================================================
app = FastAPI(title="Cortex - Second Brain API", version="1.0.0")

client = OpenAI(
    api_key=GEMINI_API_KEY,
    # Gemini's API is OpenAI-compatible; `openai` is only the client library here.
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# EMBEDDING & RERANKER MODELS
# ============================================================
print("Loading embedding model (Bi-Encoder)...")
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
VECTOR_SIZE = 384
print("Embedding model loaded!")

print("Loading reranker model (Cross-Encoder)...")
reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
print("Reranker loaded!")


print("Initializing Qdrant...")
qdrant = QdrantClient(host="localhost", port=6333)
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
class URLRequest(BaseModel):
    url: str

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
def get_db_connection():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=10)


def save_source(source: dict) -> None:
    """Persist source metadata while Qdrant retains the embedding vectors."""
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "Source" (
                "id", "filename", "title", "sourceType", "chunksInserted",
                "summary", "keyPoints", "easyExplanation", "createdAt", "updatedAt"
            ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW(), NOW())
            ON CONFLICT ("id") DO UPDATE SET
                "filename" = EXCLUDED."filename",
                "title" = EXCLUDED."title",
                "sourceType" = EXCLUDED."sourceType",
                "chunksInserted" = EXCLUDED."chunksInserted",
                "summary" = EXCLUDED."summary",
                "keyPoints" = EXCLUDED."keyPoints",
                "easyExplanation" = EXCLUDED."easyExplanation",
                "updatedAt" = NOW()
            ''',
            (
                source["document_id"], source["filename"], source["title"],
                source["source_type"], source["chunks_inserted"], source.get("summary"),
                json.dumps(source.get("key_points", [])), source.get("easy_explanation"),
            ),
        )


def load_sources() -> dict:
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Source" ORDER BY "createdAt" DESC')
        rows = cur.fetchall()
    return {
        row["id"]: {
            "document_id": row["id"],
            "filename": row["filename"],
            "title": row["title"],
            "source_type": row["sourceType"],
            "chunks_inserted": row["chunksInserted"],
            "summary": row["summary"] or "",
            "key_points": row["keyPoints"] or [],
            "easy_explanation": row["easyExplanation"] or "",
        }
        for row in rows
    }


def save_source_chunks(source_id: str, chunks: List[str]) -> None:
    """Store the extracted source text in Neon; Qdrant stores its embeddings separately."""
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "SourceChunk" WHERE "sourceId" = %s', (source_id,))
        cur.executemany(
            '''
            INSERT INTO "SourceChunk" ("id", "chunkIndex", "content", "sourceId", "createdAt")
            VALUES (%s, %s, %s, %s, NOW())
            ''',
            [(str(uuid.uuid4()), index, chunk, source_id) for index, chunk in enumerate(chunks)],
        )


def load_chat_history(session_id: str) -> List[dict]:
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "role", "content" FROM "ChatMessage"
            WHERE "sessionId" = %s
            ORDER BY "createdAt" DESC
            LIMIT 10
            ''',
            (session_id,),
        )
        rows = cur.fetchall()
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def save_chat_message(session_id: str, role: str, content: str, source_id: Optional[str] = None) -> None:
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "ChatSession" ("id", "createdAt", "updatedAt")
            VALUES (%s, NOW(), NOW())
            ON CONFLICT ("id") DO UPDATE SET "updatedAt" = NOW()
            ''',
            (session_id,),
        )
        cur.execute(
            '''
            INSERT INTO "ChatMessage" ("id", "role", "content", "createdAt", "sessionId", "sourceId")
            VALUES (%s, %s, %s, NOW(), %s, %s)
            ''',
            (str(uuid.uuid4()), role, content, session_id, source_id),
        )


def save_chat_exchange(session_id: str, question: str, answer: str, filename: Optional[str]) -> None:
    source_id = next(
        (source["document_id"] for source in document_registry.values() if source["filename"] == filename),
        None,
    )
    save_chat_message(session_id, "user", question, source_id)
    save_chat_message(session_id, "assistant", answer, source_id)


@app.on_event("startup")
def restore_persisted_sources() -> None:
    """Restore source metadata after an API restart."""
    document_registry.clear()
    document_registry.update(load_sources())
    print(f"Loaded {len(document_registry)} source(s) from Neon.")


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
        raise HTTPException(status_code=400, detail="Unsupported file type.")

def chunk_text(text: str, chunk_size: int = 500, chunk_overlap: int = 100) -> List[str]:
    if not text:
        return []
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
Given the conversation history, rewrite the user's latest question into a standalone query.
History:
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
        return rewritten.strip() if rewritten else current_question
    except:
        return current_question

def generate_source_summary(text: str) -> dict:
    if not text:
        return {"summary": "", "key_points": [], "easy_explanation": ""}
    
    short_text = text[:8000] 
    prompt = f"""
    Analyze the following text and provide a short summary, key points, and an easy explanation suitable for a beginner.
    Respond STRICTLY in JSON format with exactly these three keys: 
    "summary" (string), "key_points" (array of strings), and "easy_explanation" (string).
    
    TEXT:
    {short_text}
    """
    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2
        )
        data = json.loads(response.choices[0].message.content)
        
        if "key_points" in data and not isinstance(data["key_points"], list):
            if isinstance(data["key_points"], str):
                data["key_points"] = [data["key_points"]]
            else:
                data["key_points"] = []
                
        return data
    except Exception as e:
        error_msg = "Summarization failed due to xAI API rate limits." if "429" in str(e) else "Summarization failed."
        return {"summary": error_msg, "key_points": [], "easy_explanation": ""}

def extract_text_from_image(base64_image: str, mime_type: str) -> str:
    prompt = "Extract all readable text, data, and useful information from this image. Return ONLY the extracted text. If it is a diagram, describe its contents clearly."
    try:
        response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}}
                    ]
                }
            ],
            temperature=0.0
        )
        return response.choices[0].message.content
    except Exception as e:
        if "429" in str(e) or "insufficient_quota" in str(e):
             raise HTTPException(status_code=429, detail="xAI API rate limit reached. Cannot extract image text.")
        raise HTTPException(status_code=500, detail=f"Image extraction failed: {str(e)}")

# ============================================================
# ENDPOINTS
# ============================================================
@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing.")
    filename = file.filename
    
    try:
        file_content = await file.read()
        document_id = str(uuid.uuid4())
        extracted_pages = extract_text_from_file(file_content, filename)
        if not extracted_pages:
            raise HTTPException(status_code=400, detail="No readable text found.")

        title = filename
        points_to_insert = []
        source_chunks = []
        total_chunks = 0
        full_text = ""

        for page in extracted_pages:
            full_text += page["text"] + "\n"
            text_chunks = chunk_text(page["text"], chunk_size=500, chunk_overlap=100)
            for chunk_index, chunk_str in enumerate(text_chunks):
                source_chunks.append(chunk_str)
                vector = create_embedding(chunk_str)
                chunk_id = str(uuid.uuid4())
                payload = {
                    "document_id": document_id, "filename": filename, "title": title,
                    "source_type": "document", "text": chunk_str,
                }
                points_to_insert.append(PointStruct(id=chunk_id, vector=vector, payload=payload))
                total_chunks += 1

        if points_to_insert:
            qdrant.upsert(collection_name=COLLECTION_NAME, points=points_to_insert)

        summary_data = generate_source_summary(full_text)
        doc_info = {
            "document_id": document_id, "filename": filename, "title": title,
            "source_type": "document", "chunks_inserted": total_chunks,
            "summary": summary_data.get("summary", ""),
            "key_points": summary_data.get("key_points", []),
            "easy_explanation": summary_data.get("easy_explanation", "")
        }
        save_source(doc_info)
        save_source_chunks(document_id, source_chunks)
        document_registry[document_id] = doc_info
        return {"success": True, "message": "Document ingested successfully", **doc_info}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Document processing error: {str(e)}")

@app.post("/sources/url")
async def add_url_source(payload: URLRequest):
    url = payload.url
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL format.")
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        
        soup = BeautifulSoup(r.text, "html.parser")
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.extract()
            
        text = soup.get_text(separator=" ")
        cleaned_text = clean_text(text)
        if not cleaned_text:
            raise HTTPException(status_code=400, detail="No readable text found at URL.")
            
        title = soup.title.string.strip() if soup.title else url
        document_id = str(uuid.uuid4())
        text_chunks = chunk_text(cleaned_text, chunk_size=500, chunk_overlap=100)
        points_to_insert = []
        source_chunks = []
        
        for chunk_index, chunk_str in enumerate(text_chunks):
            source_chunks.append(chunk_str)
            vector = create_embedding(chunk_str)
            chunk_id = str(uuid.uuid4())
            payload_data = {
                "document_id": document_id, "filename": url, "title": title,
                "source_type": "url", "text": chunk_str,
            }
            points_to_insert.append(PointStruct(id=chunk_id, vector=vector, payload=payload_data))
            
        if points_to_insert:
            qdrant.upsert(collection_name=COLLECTION_NAME, points=points_to_insert)
            
        summary_data = generate_source_summary(cleaned_text)
        doc_info = {
            "document_id": document_id, "filename": url, "title": title,
            "source_type": "url", "chunks_inserted": len(points_to_insert),
            "summary": summary_data.get("summary", ""),
            "key_points": summary_data.get("key_points", []),
            "easy_explanation": summary_data.get("easy_explanation", "")
        }
        save_source(doc_info)
        save_source_chunks(document_id, source_chunks)
        document_registry[document_id] = doc_info
        return {"success": True, "message": "URL ingested successfully", **doc_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL processing error: {str(e)}")

@app.post("/images/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is missing.")
    extension = os.path.splitext(file.filename.lower())[1]
    if extension not in [".jpg", ".jpeg", ".png", ".webp"]:
        raise HTTPException(status_code=400, detail="Unsupported image format.")
        
    try:
        file_content = await file.read()
        base64_image = base64.b64encode(file_content).decode("utf-8")
        mime_type = "image/jpeg" if extension in [".jpg", ".jpeg"] else f"image/{extension[1:]}"
        
        extracted_text = extract_text_from_image(base64_image, mime_type)
        if not extracted_text or extracted_text.strip() == "":
            raise HTTPException(status_code=400, detail="No readable text extracted from image.")
            
        document_id = str(uuid.uuid4())
        text_chunks = chunk_text(extracted_text, chunk_size=500, chunk_overlap=100)
        points_to_insert = []
        source_chunks = []
        
        for chunk_index, chunk_str in enumerate(text_chunks):
            source_chunks.append(chunk_str)
            vector = create_embedding(chunk_str)
            chunk_id = str(uuid.uuid4())
            payload_data = {
                "document_id": document_id, "filename": file.filename, "title": file.filename,
                "source_type": "image", "text": chunk_str,
            }
            points_to_insert.append(PointStruct(id=chunk_id, vector=vector, payload=payload_data))
            
        if points_to_insert:
            qdrant.upsert(collection_name=COLLECTION_NAME, points=points_to_insert)
            
        summary_data = generate_source_summary(extracted_text)
        doc_info = {
            "document_id": document_id, "filename": file.filename, "title": file.filename,
            "source_type": "image", "chunks_inserted": len(points_to_insert),
            "summary": summary_data.get("summary", ""),
            "key_points": summary_data.get("key_points", []),
            "easy_explanation": summary_data.get("easy_explanation", "")
        }
        save_source(doc_info)
        save_source_chunks(document_id, source_chunks)
        document_registry[document_id] = doc_info
        return {"success": True, "message": "Image ingested successfully", **doc_info}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image processing error: {str(e)}")

@app.post("/chat")
async def chat_with_document(request: ChatRequest):
    try:
        if not request.question.strip():
            raise HTTPException(status_code=400, detail="Question cannot be empty.")
        
        session_id = request.session_id
        if session_id not in chat_sessions:
            chat_sessions[session_id] = load_chat_history(session_id)
        
        history = chat_sessions[session_id]
        search_query = rewrite_query(request.question, history) if history else request.question

        query_vector = create_embedding(search_query)
        query_filter = Filter(must=[FieldCondition(key="filename", match=MatchValue(value=request.filename))]) if request.filename else None

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
            save_chat_exchange(session_id, request.question, answer, request.filename)
            return {"question": request.question, "answer": answer, "sources_map": {}, "session_id": session_id}

        cross_encoder_inputs = [[request.question, pt.payload.get("text", "")] for pt in search_results.points if pt.payload.get("text")]
        
        if not cross_encoder_inputs:
            answer = "No readable content found."
            save_chat_exchange(session_id, request.question, answer, request.filename)
            return {"question": request.question, "answer": answer, "sources_map": {}, "session_id": session_id}

        rerank_scores = reranker_model.predict(cross_encoder_inputs)
        scored_points = [{"point": pt, "rerank_score": float(rerank_scores[i])} for i, pt in enumerate(search_results.points)]
        scored_points.sort(key=lambda x: x["rerank_score"], reverse=True)
        top_3 = scored_points[:3]

        retrieved_texts, sources_map = [], {}
        for i, item in enumerate(top_3):
            source_id = i + 1
            payload = item["point"].payload
            text = payload.get("text", "")
            filename = payload.get("filename", "Unknown")
            retrieved_texts.append(f"[Source {source_id}]\nDocument: {filename}\nContent:\n{text}\n")
            sources_map[str(source_id)] = {"filename": filename, "chunk_text": text}

        context_string = "\n---\n".join(retrieved_texts)
        system_prompt = f"""You are Cortex, a helpful AI learning assistant. Answer using ONLY the provided context. Include inline citations like [1].
DOCUMENT CONTEXT:
{context_string}"""
        
        messages_to_send = [{"role": "system", "content": system_prompt}] + history + [{"role": "user", "content": request.question}]
        
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages_to_send,
            temperature=0.2,
        )
        answer = response.choices[0].message.content or "I was unable to generate an answer."

        chat_sessions[session_id].extend([{"role": "user", "content": request.question}, {"role": "assistant", "content": answer}])
        if len(chat_sessions[session_id]) > 10:
            chat_sessions[session_id] = chat_sessions[session_id][-10:]

        save_chat_exchange(session_id, request.question, answer, request.filename)

        return {"question": request.question, "answer": answer, "sources_map": sources_map, "session_id": session_id, "search_query": search_query}

    except HTTPException:
        raise
    except Exception as e:
        if "429" in str(e) or "insufficient_quota" in str(e):
            return {
                "question": request.question,
                "answer": "xAI API rate limit reached. Please try again in a few seconds.",
                "sources_map": locals().get('sources_map', {}),
                "session_id": request.session_id,
            }
        if getattr(e, "status_code", None) in (401, 403) or "permission-denied" in str(e):
            raise HTTPException(
                status_code=503,
                detail=(
                    "Gemini access is unavailable for the configured API key. "
                    "Configure a valid Gemini API key with active API access."
                ),
            )
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

@app.get("/documents")
async def list_documents():
    document_registry.clear()
    document_registry.update(load_sources())
    return {"total_documents": len(document_registry), "documents": list(document_registry.values())}

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    if document_id in document_registry:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute('DELETE FROM "Source" WHERE "id" = %s', (document_id,))
        document_registry.pop(document_id)
        return {"message": "Deleted"}
    raise HTTPException(status_code=404)
