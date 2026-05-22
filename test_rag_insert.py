"""Inject parsed content_list into RAG-Anything and test medical Q&A"""
import asyncio, json, os, sys, numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "RAG-Anything"))
from raganything import RAGAnything, RAGAnythingConfig
from lightrag.llm.openai import openai_complete_if_cache
from lightrag.utils import EmbeddingFunc

API_KEY = "ark-0894b21d-a913-4fbf-bbb3-7d646fc41ff8-cea4b"
BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"
TEXT_MODEL = "DeepSeek-V4-Pro"

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


async def main():
    config = RAGAnythingConfig(
        working_dir="./rag_storage",
        parser="mineru",
        parse_method="auto",
        enable_image_processing=False,
        enable_table_processing=False,
        enable_equation_processing=False,
    )

    def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
        return openai_complete_if_cache(
            TEXT_MODEL, prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            api_key=API_KEY, base_url=BASE_URL, **kwargs,
        )
        # Note: openai_complete_if_cache is async, but RAG-Anything wraps and awaits it

    def vision_model_func(prompt, system_prompt=None, history_messages=[],
                          image_data=None, messages=None, **kwargs):
        return llm_model_func(prompt, system_prompt, history_messages, **kwargs)

    embedding_func = EmbeddingFunc(
        embedding_dim=1024, max_token_size=8192,
        func=local_embedding,
    )

    rag = RAGAnything(
        config=config,
        llm_model_func=llm_model_func,
        vision_model_func=vision_model_func,
        embedding_func=embedding_func,
    )

    # Load ONLY text content from parsed Chinese PDF
    content_dir = Path("./output/remote_test")
    pdf_stem = "Stanford+B+型主动脉夹层诊断和治疗中国专家共识（2022版）"

    cl_files = list(content_dir.glob(f"*{pdf_stem}*content_list.json"))
    if not cl_files:
        print("No content_list found!")
        return

    with open(cl_files[0], 'r', encoding='utf-8') as f:
        content_list = json.load(f)

    # Filter: ONLY text entries (the actual medical content)
    # Skip headers, page_nums, page_footnotes, lists (structure elements)
    text_entries = []
    for item in content_list:
        if item.get("type") == "text" and item.get("text", "").strip():
            text_entries.append(item)

    print(f"Original entries: {len(content_list)}")
    print(f"Filtered to TEXT only: {len(text_entries)} entries")
    total_chars = sum(len(item["text"]) for item in text_entries)
    print(f"Total text content: {total_chars} chars")

    # Insert pure text content
    print("\n--- Inserting text into knowledge graph ---")
    try:
        await rag.insert_content_list(
            content_list=text_entries,
            file_path="Stanford B型主动脉夹层诊断和治疗中国专家共识（2022版）.pdf",
        )
        print("Insertion successful!")
    except Exception as e:
        print(f"Insertion error: {e}")
        import traceback
        traceback.print_exc()
        return

    # Test medical Q&A
    queries = [
        "Stanford B型主动脉夹层的诊断标准是什么？",
        "Stanford B型主动脉夹层如何分型和分期？",
        "TBAD的药物治疗方案有哪些？",
        "主动脉夹层腔内修复术的适应症是什么？",
    ]

    print("\n" + "="*60)
    print("MEDICAL Q&A TEST")
    print("="*60)

    for q in queries:
        print(f"\nQ: {q}")
        try:
            result = await rag.aquery(q, mode="hybrid")
            # Handle tuple return
            answer = result if isinstance(result, str) else str(result)
            print(f"A: {answer[:600]}")
            if len(answer) > 600:
                print(f"...[truncated, total {len(answer)} chars]")
        except Exception as e:
            print(f"Query error: {e}")
        print("-"*40)


if __name__ == "__main__":
    asyncio.run(main())
