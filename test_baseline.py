"""Quick test: RAG-Anything direct PDF processing"""
import asyncio
import sys
from pathlib import Path
from functools import partial

sys.path.insert(0, str(Path(__file__).parent / "RAG-Anything"))

from raganything import RAGAnything, RAGAnythingConfig
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import EmbeddingFunc

API_KEY = "ark-0894b21d-a913-4fbf-bbb3-7d646fc41ff8-cea4b"
BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"

async def main():
    config = RAGAnythingConfig(
        working_dir="./rag_storage",
        parser="mineru",
        parse_method="auto",
        enable_image_processing=True,
        enable_table_processing=True,
        enable_equation_processing=True,
    )

    def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
        return openai_complete_if_cache(
            "DeepSeek-V4-Pro", prompt,
            system_prompt=system_prompt,
            history_messages=history_messages,
            api_key=API_KEY, base_url=BASE_URL,
            **kwargs,
        )

    def vision_model_func(prompt, system_prompt=None, history_messages=[],
                          image_data=None, messages=None, **kwargs):
        if image_data:
            return openai_complete_if_cache(
                "Kimi-K2.6", "",
                system_prompt=None, history_messages=[],
                messages=[
                    {"role": "system", "content": system_prompt} if system_prompt else None,
                    {"role": "user", "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
                    ]},
                ],
                api_key=API_KEY, base_url=BASE_URL, **kwargs,
            )
        else:
            return llm_model_func(prompt, system_prompt, history_messages, **kwargs)

    embedding_func = EmbeddingFunc(
        embedding_dim=3072, max_token_size=8192,
        func=partial(openai_embed.func, model="text-embedding-3-large",
                     api_key=API_KEY, base_url=BASE_URL),
    )

    rag = RAGAnything(
        config=config,
        llm_model_func=llm_model_func,
        vision_model_func=vision_model_func,
        embedding_func=embedding_func,
    )

    pdf = "./相关样例/Stanford+B+型主动脉夹层诊断和治疗中国专家共识（2022版）.pdf"
    print(f"Processing: {pdf}")

    await rag.process_document_complete(
        file_path=pdf,
        output_dir="./output",
        parse_method="auto",
        lang="ch",
        backend="pipeline",
        formula=True,
        table=True,
        display_stats=True,
    )

    print("\n--- Query test ---")
    result = await rag.aquery("Stanford B型主动脉夹层的诊断标准是什么？", mode="hybrid")
    print(result[:500])

if __name__ == "__main__":
    asyncio.run(main())