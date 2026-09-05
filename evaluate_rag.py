import requests
import os
from groq import Groq
from dotenv import load_dotenv

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

API_URL = "http://127.0.0.1:8000/chat"

EVAL_DATASET = [
    {
        "question": "Who built Cortex and what database does it use?",
        "expected_filename": "test_doc.txt"
    }
]

def evaluate_retrieval(expected_filename: str, sources_map: dict) -> int:
    for source_id, data in sources_map.items():
        if data.get("filename") == expected_filename:
            return 1
    return 0

def evaluate_generation(question: str, context: str, answer: str) -> int:
    prompt = f"""
    You are an impartial judge evaluating a RAG system.
    Question: {question}
    Retrieved Context: {context}
    Generated Answer: {answer}
    
    Task: Is the Generated Answer fully supported by the Retrieved Context? 
    Respond with exactly one word: YES or NO.
    """
    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0
        )
        verdict = response.choices[0].message.content.strip().upper()
        return 1 if "YES" in verdict else 0
    except Exception as e:
        print(f"Judge Error: {e}")
        return 0

def run_evaluation():
    print(f"Starting evaluation of {len(EVAL_DATASET)} queries...")
    total_retrieval_score = 0
    total_generation_score = 0
    
    for item in EVAL_DATASET:
        print(f"\nTesting: {item['question']}")
        
        try:
            res = requests.post(API_URL, json={"question": item["question"], "session_id": "eval_test"})
            headers={"Connection": "close"}
            res_data = res.json()
        except Exception as e:
            print(f"API Call Failed: {e}")
            continue
            
        answer = res_data.get("answer", "")
        sources_map = res_data.get("sources_map", {})
        
        retrieved_context = "\n".join([data["chunk_text"] for data in sources_map.values()])
        
        retrieval_score = evaluate_retrieval(item["expected_filename"], sources_map)
        total_retrieval_score += retrieval_score
        print(f"Retrieval Hit: {'✅' if retrieval_score else '❌'}")
        
        if retrieval_score:
            gen_score = evaluate_generation(item["question"], retrieved_context, answer)
            total_generation_score += gen_score
            print(f"Faithful Generation: {'✅' if gen_score else '❌'}")
            
    hit_rate = (total_retrieval_score / len(EVAL_DATASET)) * 100
    faithfulness = (total_generation_score / total_retrieval_score) * 100 if total_retrieval_score else 0
    
    print("\n" + "="*30)
    print("EVALUATION RESULTS")
    print("="*30)
    print(f"Retrieval Hit Rate: {hit_rate:.1f}%")
    print(f"Answer Faithfulness: {faithfulness:.1f}%")

if __name__ == "__main__":
    run_evaluation()