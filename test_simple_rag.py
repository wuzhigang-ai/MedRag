"""Simple RAG: Text chunking + BGE-M3 embedding + DeepSeek Q&A"""
import json, os, numpy as np, asyncio
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

import faiss
from sentence_transformers import SentenceTransformer
from openai import OpenAI

os.environ["TOKENIZERS_PARALLELISM"] = "false"

API_KEY = os.getenv("OPENAI_API_KEY", "ark-0894b21d-a913-4fbf-bbb3-7d646fc41ff8-cea4b")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://ark.cn-beijing.volces.com/api/plan/v3")
TEXT_MODEL = "DeepSeek-V4-Pro"

# 1. Load all parsed medical content
content_dir = Path("./output/remote_test")
all_chunks = []
sources = []

# Load all content_list.json files
for f in content_dir.iterdir():
    if not f.name.endswith("_content_list.json"):
        continue
    with open(f) as fh:
        data = json.load(fh)

    doc_name = f.name.replace("_content_list.json", "")
    for item in data:
        text = item.get("text", "").strip()
        if text and len(text) > 30:  # skip very short text
            all_chunks.append(text)
            sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}]")

print(f"Loaded {len(all_chunks)} text chunks from {sum(1 for _ in content_dir.iterdir() if _.name.endswith('_content_list.json'))} documents")

# 2. Build embeddings with BGE-M3
print("Building embeddings...")
model = SentenceTransformer("BAAI/bge-m3", device="cuda")
embeddings = model.encode(all_chunks, normalize_embeddings=True, show_progress_bar=True)

# 3. Build FAISS index
dim = embeddings.shape[1]
index = faiss.IndexFlatIP(dim)  # Inner product for cosine similarity (normalized)
index.add(embeddings.astype(np.float32))
print(f"FAISS index built: {index.ntotal} vectors, dim={dim}")

# 4. Q&A client
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

def retrieve(query: str, top_k: int = 5) -> list:
    """Retrieve top_k relevant chunks"""
    q_emb = model.encode([query], normalize_embeddings=True)
    scores, indices = index.search(q_emb.astype(np.float32), top_k)
    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx >= 0 and score > 0.3:  # similarity threshold
            results.append({
                "score": float(score),
                "text": all_chunks[idx],
                "source": sources[idx],
            })
    return results

def answer(query: str) -> str:
    """Generate answer with retrieved context"""
    results = retrieve(query, top_k=8)

    if not results:
        return "未找到相关文献内容，无法回答该问题。"

    # Build context
    context_parts = []
    for i, r in enumerate(results):
        context_parts.append(f"[参考{i+1} | {r['source']} | 相关度:{r['score']:.2f}]\n{r['text']}")

    context = "\n\n".join(context_parts)

    prompt = f"""你是医学文献RAG助手。根据以下文献内容回答用户问题。
要求：
- 如果文献提供了答案，请基于文献内容准确回答，并引用来源编号
- 如果文献内容不足以回答，请明确指出
- 回答使用中文

文献内容：
{context}

用户问题：{query}

回答："""

    response = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=800,
    )
    return response.choices[0].message.content

# 5. Test
queries = [
    "Stanford B型主动脉夹层的诊断标准是什么？",
    "Stanford B型主动脉夹层如何分型和分期？",
    "TBAD的药物治疗方案有哪些？",
    "主动脉夹层腔内修复术的适应症是什么？",
]

print("\n" + "="*60)
print("MEDICAL RAG Q&A TEST")
print("="*60)

for q in queries:
    print(f"\nQ: {q}")
    a = answer(q)
    print(f"A: {a}")
    print("-"*40)
