"""Direct LightRAG insertion and query test"""
import asyncio, json, os, sys, numpy as np
from pathlib import Path
from functools import partial
from dotenv import load_dotenv

load_dotenv()

from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import openai_complete_if_cache
from lightrag.utils import EmbeddingFunc

API_KEY = os.getenv("OPENAI_API_KEY", "ark-0894b21d-a913-4fbf-bbb3-7d646fc41ff8-cea4b")
BASE_URL = os.getenv("OPENAI_BASE_URL", "https://ark.cn-beijing.volces.com/api/plan/v3")
TEXT_MODEL = "DeepSeek-V4-Pro"

WORKING_DIR = "./lightrag_storage"


_embed_model = None

def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer("BAAI/bge-m3", device="cuda")
    return _embed_model

async def local_embedding(texts: list[str]) -> np.ndarray:
    model = _get_embed_model()
    embeddings = await asyncio.to_thread(
        lambda: model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    )
    return np.array(embeddings)


async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
    return await openai_complete_if_cache(
        TEXT_MODEL, prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key=API_KEY, base_url=BASE_URL, **kwargs,
    )


async def main():
    # Clean storage
    import shutil
    if os.path.exists(WORKING_DIR):
        shutil.rmtree(WORKING_DIR)

    embedding_func = EmbeddingFunc(
        embedding_dim=1024, max_token_size=8192,
        func=local_embedding,
    )

    rag = LightRAG(
        working_dir=WORKING_DIR,
        llm_model_func=llm_model_func,
        embedding_func=embedding_func,
    )
    await rag.initialize_storages()

    # Load parsed Chinese medical text
    content_dir = Path("./output/remote_test")
    pdf_stem = "Stanford+B+型主动脉夹层诊断和治疗中国专家共识（2022版）"

    cl_files = list(content_dir.glob(f"*{pdf_stem}*content_list.json"))
    with open(cl_files[0], 'r', encoding='utf-8') as f:
        content_list = json.load(f)

    # Join all text content into one document
    all_text = []
    for item in content_list:
        if item.get("type") == "text" and item.get("text", "").strip():
            all_text.append(item["text"])

    full_text = "\n\n".join(all_text)
    print(f"Loaded {len(all_text)} text blocks, {len(full_text)} chars")

    # Insert into LightRAG using ainsert (async insert)
    print("\n--- Inserting into LightRAG ---")
    try:
        await rag.ainsert(
            input=full_text,
            file_paths="Stanford B型主动脉夹层诊断和治疗中国专家共识（2022版）.pdf",
        )
        print("Insertion successful!")
    except Exception as e:
        print(f"Insertion error: {e}")
        import traceback
        traceback.print_exc()
        return

    # Test queries
    queries = [
        "Stanford B型主动脉夹层的诊断标准是什么？",
        "Stanford B型主动脉夹层如何分型和分期？",
        "TBAD的药物治疗方案有哪些？",
        "主动脉夹层腔内修复术的适应症是什么？",
    ]

    print("\n" + "="*60)
    print("MEDICAL Q&A TEST")
    print("="*60)

    query_param = QueryParam(mode="hybrid", top_k=60)

    for q in queries:
        print(f"\nQ: {q}")
        try:
            result = await rag.aquery(q, param=query_param)
            print(f"A: {str(result)[:600]}")
        except Exception as e:
            print(f"Query error: {e}")
        print("-"*40)

    await rag.finalize_storages()


if __name__ == "__main__":
    asyncio.run(main())
