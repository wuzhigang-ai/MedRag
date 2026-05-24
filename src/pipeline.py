"""
端到端医疗RAG知识库构建pipeline

多模型架构:
  - 实体提取(主): GLM-5.1 via 讯飞 astron-code-latest
  - 实体提取(兜底): DeepSeek-V4-Flash via 百度
  - RAG问答: DeepSeek-V4-Pro via 百度
  - 视觉理解: Moonshot K2.6 Vision
  - Embedding: BGE-M3 本地GPU

双引擎:
  - 主引擎: RAG-Anything/LightRAG GraphRAG (知识图谱 + 混合检索)
  - 回退引擎: BGE-M3 + FAISS 向量检索 (始终可用)
"""

import hashlib
import json
import os
import sys
import logging
import numpy as np
import torch
import asyncio
from pathlib import Path
from typing import Dict, List, Any, Optional

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, str(Path(__file__).parent.parent))

from openai import OpenAI

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["HF_HUB_OFFLINE"] = "1"  # 彻底断网, 仅用本地缓存

# ═══════════════════════════════════════════════════════════
# 多模型 API 配置
# ═══════════════════════════════════════════════════════════

PROVIDERS = {
    "xunfei": {  # GLM-5.1, LightRAG 实体提取主引擎
        "base_url": os.getenv("XUNFEI_BASE_URL", "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2"),
        "api_key": os.getenv("XUNFEI_API_KEY", ""),
        "model": "astron-code-latest",
    },
    "baidu_flash": {  # DeepSeek-V4-Flash, 实体提取兜底
        "base_url": os.getenv("BAIDU_BASE_URL", "https://qianfan.baidubce.com/v2/coding"),
        "api_key": os.getenv("BAIDU_API_KEY", ""),
        "model": "deepseek-v4-flash",
    },
    "baidu_pro": {  # DeepSeek-V4-Pro, RAG问答
        "base_url": os.getenv("BAIDU_BASE_URL", "https://qianfan.baidubce.com/v2/coding"),
        "api_key": os.getenv("BAIDU_API_KEY", ""),
        "model": "deepseek-v4-pro",
    },
    "moonshot_vision": {  # VLM 图表理解
        "base_url": os.getenv("MOONSHOT_BASE_URL", "https://api.moonshot.cn/v1"),
        "api_key": os.getenv("MOONSHOT_API_KEY", ""),
        "model": "moonshot-v1-128k-vision-preview",
    },
}

EMBED_MODEL_NAME = "BAAI/bge-m3"
EMBED_MODEL_PATH = r"C:\Users\bigda\.cache\huggingface\hub\models--BAAI--bge-m3\snapshots\5617a9f61b028005a4858fdac845db406aefb181"


class MedicalRAGPipeline:
    """医疗RAG知识库构建pipeline"""

    def __init__(
        self,
        content_dir: str = "./output/remote_test",
        cache_dir: str = "./cache",
        lightrag_working_dir: str = "./lightrag_storage",
    ):
        self.content_dir = Path(content_dir)
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.lightrag_working_dir = lightrag_working_dir

        # ─── 多模型客户端 ───
        self.clients = {
            name: OpenAI(base_url=cfg["base_url"], api_key=cfg["api_key"])
            for name, cfg in PROVIDERS.items()
        }

        # ─── 容错管理器 ───
        from src.resilience import APIResilience
        self.resilience_xunfei = APIResilience(self.clients["xunfei"])
        self.resilience_baidu_flash = APIResilience(self.clients["baidu_flash"])
        self.resilience_baidu_pro = APIResilience(self.clients["baidu_pro"])

        # ─── FAISS 引擎 ───
        self._embed_model = None
        self._embed_dim = 1024
        self.faiss_index: Any = None
        self.all_chunks: List[str] = []
        self.sources: List[str] = []
        self.chunk_meta: List[Dict] = []

        # ─── 医学语义分块器 (规则匹配, 无LLM) ───
        from src.medical_chunker import MedicalChunker
        self._chunker = MedicalChunker()

        # ─── LightRAG 引擎 ───
        self._lightrag = None
        self._lightrag_ready = False

        # ─── Knowledge Graph ───
        from src.graph import GraphManager
        self.graph_manager = GraphManager()

        # Dedup
        self._seen_hashes: set = set()

        # Remote upload state
        self._upload_state = {
            "state": "idle",
            "filename": None,
            "error": None,
            "chunks_added": 0,
        }

        # Stats
        self.doc_count = 0

    # ═══════════════════════════════════════════════════════
    # Embedding (BGE-M3 本地GPU)
    # ═══════════════════════════════════════════════════════

    @property
    def embed_model(self):
        if self._embed_model is None:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading BGE-M3 embedding model (GPU)...")
            self._embed_model = SentenceTransformer(
                EMBED_MODEL_PATH, device="cuda", local_files_only=True
            )
        return self._embed_model

    def encode(self, texts: List[str], show_progress: bool = False) -> np.ndarray:
        # GPU memory check: fall back to CPU if free mem < 2GB
        torch.cuda.empty_cache()
        try:
            free_mem = torch.cuda.mem_get_info()[0] / 1024**3
            device = "cuda" if free_mem > 2.0 else "cpu"
        except Exception:
            device = "cpu"
        if device == "cpu" and self.embed_model.device.type != "cpu":
            self.embed_model.to("cpu")
        elif device == "cuda" and self.embed_model.device.type != "cuda":
            self.embed_model.to("cuda")

        return self.embed_model.encode(
            texts, normalize_embeddings=True,
            show_progress_bar=show_progress, batch_size=16,
        )

    # ═══════════════════════════════════════════════════════
    # LLM 调用辅助 (带 讯飞 → 百度 降级)
    # ═══════════════════════════════════════════════════════

    def _llm_entity_extract(self, prompt: str, system_prompt: str = None) -> str:
        """
        实体提取专用: 百度 DeepSeek-V4-Pro 主 → 讯飞 GLM-5.1 兜底
        使用 resilience 模块的指数退避重试
        """
        # 尝试百度 DeepSeek-V4-Pro with retry
        result = self.resilience_baidu_pro.call_text_sync(
            prompt, system_prompt, model=PROVIDERS["baidu_pro"]["model"]
        )
        if result.success and result.data and len(result.data.strip()) > 10:
            return result.data
        if not result.success:
            logger.warning(f"百度Pro entity extract failed: {result.error[:120] if result.error else 'unknown'}")

        # 兜底: 讯飞 GLM-5.1 with retry
        result = self.resilience_xunfei.call_text_sync(
            prompt, system_prompt, model=PROVIDERS["xunfei"]["model"]
        )
        if result.success:
            return result.data
        logger.error(f"讯飞 fallback also failed: {result.error[:120] if result.error else 'unknown'}")
        raise RuntimeError(f"Entity extraction failed: {result.error}")

    # ═══════════════════════════════════════════════════════
    # FAISS 引擎 (同步, 百度Pro问答)
    # ═══════════════════════════════════════════════════════

    def _load_faiss_documents(self):
        if not self.content_dir.exists():
            logger.error(f"Content dir not found: {self.content_dir}")
            return 0

        self.all_chunks.clear()
        self.sources.clear()
        self.chunk_meta.clear()
        self._seen_hashes.clear()
        for f in sorted(self.content_dir.glob("*_content_list.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    data = json.load(fh)
            except Exception as e:
                logger.warning(f"Failed to load {f.name}: {e}")
                continue

            doc_name = f.name.replace("_content_list.json", "")
            for item in data:
                t = item.get("type", "text")
                if t == "text":
                    text = item.get("text", "").strip()
                    if text and len(text) > 30:
                        h = hashlib.md5(text.encode()).hexdigest()
                        if h in self._seen_hashes:
                            continue
                        self._seen_hashes.add(h)
                        self.all_chunks.append(text)
                        self.sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}]")
                        self.chunk_meta.append({
                            "type": "text", "page_idx": item.get("page_idx", 0),
                            "doc_name": doc_name,
                        })
                elif t == "image":
                    captions = item.get("image_caption", [])
                    cap = " ".join(captions) if captions else ""
                    if cap and len(cap) > 20:
                        # Try VLM analysis for clinical charts
                        img_path = item.get("img_path", "")
                        vlm_result = None
                        if img_path:
                            vlm_result = self._analyze_chart_image(img_path, cap)
                        if vlm_result:
                            text = f"[图表-VLM分析] 类型:{vlm_result.get('chart_type','?')}\n{vlm_result.get('summary','')}\n{vlm_result.get('description','')}"
                        else:
                            text = f"[图片] {cap}"
                        h = hashlib.md5(text.encode()).hexdigest()
                        if h in self._seen_hashes:
                            continue
                        self._seen_hashes.add(h)
                        self.all_chunks.append(text)
                        self.sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}, image]")
                        self.chunk_meta.append({
                            "type": "image", "page_idx": item.get("page_idx", 0),
                            "doc_name": doc_name, "vlm_analyzed": bool(vlm_result),
                        })
                elif t == "table":
                    body = item.get("table_body", "")
                    cap = " ".join(item.get("table_caption", []))
                    text = f"[表格] {cap}\n{body}" if body else f"[表格] {cap}"
                    if len(text) > 30:
                        h = hashlib.md5(text.encode()).hexdigest()
                        if h in self._seen_hashes:
                            continue
                        self._seen_hashes.add(h)
                        self.all_chunks.append(text)
                        self.sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}, table]")
                        self.chunk_meta.append({
                            "type": "table", "page_idx": item.get("page_idx", 0),
                            "doc_name": doc_name,
                        })

        # ─── 医学语义分块: 用规则匹配为每个文本块打 section_tag ───
        for i, meta in enumerate(self.chunk_meta):
            if meta.get("type") == "text" and "section_tag" not in meta:
                try:
                    tag = self._chunker.classify_section(self.all_chunks[i])
                    meta["section_tag"] = tag
                except Exception as e:
                    logger.warning(f"Section classification failed for chunk {i}: {e}")
                    meta["section_tag"] = "unknown"

        self.doc_count = len(set(s.split(" [p.")[0] for s in self.sources))
        logger.info(f"FAISS: loaded {len(self.all_chunks)} chunks from {self.doc_count} docs")
        return len(self.all_chunks)

    def _analyze_chart_image(self, img_path: str, caption: str) -> dict | None:
        """用 Moonshot VLM 分析医学图表，返回结构化结果。失败返回 None"""
        import base64
        from pathlib import Path
        if not Path(img_path).exists():
            return None
        try:
            b64 = base64.b64encode(Path(img_path).read_bytes()).decode()
        except Exception:
            return None

        prompt = f"""分析这张医学文献图表。标题: {caption}
判断类型并输出JSON:
- baseline_table: 基线特征表
- outcome_table: 结局指标表
- forest_plot: 森林图/亚组分析
- km_curve: Kaplan-Meier生存曲线
- flowchart: 流程图
- other: 其他

输出格式: {{"chart_type":"类型", "summary":"一句话总结关键医学发现（中文）", "description":"详细描述（50-150字中文）"}}"""

        try:
            client = self.clients.get("moonshot_vision")
            if not client:
                return None
            model = PROVIDERS["moonshot_vision"]["model"]
            resp = client.chat.completions.create(
                model=model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{b64}"
                        }},
                    ],
                }],
                temperature=0.3, max_tokens=400,
            )
            raw = resp.choices[0].message.content.strip()
            # Parse JSON from response
            if "```json" in raw:
                raw = raw[raw.find("```json") + 7:]
            if "```" in raw:
                raw = raw[:raw.rfind("```")]
            import json
            return json.loads(raw.strip())
        except Exception as e:
            logger.warning(f"VLM chart analysis failed for {img_path}: {e}")
            return None

    def _build_faiss_index(self, force: bool = False):
        if not self.all_chunks:
            self._load_faiss_documents()
        if self.faiss_index is not None and not force:
            return

        import faiss
        logger.info(f"FAISS: embedding {len(self.all_chunks)} chunks...")
        embeddings = self.encode(self.all_chunks, show_progress=True)
        self._embed_dim = embeddings.shape[1]
        self.faiss_index = faiss.IndexFlatIP(self._embed_dim)
        self.faiss_index.add(embeddings.astype(np.float32))
        logger.info(f"FAISS index: {self.faiss_index.ntotal} vectors, dim={self._embed_dim}")

        # Auto-save after successful build
        self.save_index()

    def _faiss_retrieve(self, query: str, top_k: int = 5, min_score: float = 0.3) -> List[Dict]:
        if self.faiss_index is None:
            self._build_faiss_index()
        q_emb = self.encode([query])
        scores, indices = self.faiss_index.search(q_emb.astype(np.float32), top_k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx >= 0 and idx < len(self.all_chunks) and score > min_score:
                results.append({
                    "score": float(score), "text": self.all_chunks[idx],
                    "source": self.sources[idx],
                    "meta": self.chunk_meta[idx] if idx < len(self.chunk_meta) else {},
                })
        return results

    def _doc_aware_retrieve(self, query: str, top_k: int = 10, min_score: float = 0.3) -> List[Dict]:
        """Document-aware retrieval: boost results matching query document names."""
        results = self._faiss_retrieve(query, top_k=max(top_k * 2, 20), min_score=0.2)
        if not results:
            return []

        # Extract potential doc names from query
        query_lower = query.lower()
        doc_boost_keywords = {
            "stanford": "Stanford+B+型主动脉夹层",
            "tbadtbad": "Stanford+B+型主动脉夹层",
            "主动脉": "Stanford+B+型主动脉夹层",
            "seyfarth": "seyfarth2008",
            "shchelochkov": "shchelochkov2019",
            "propionic": "shchelochkov2019",
            "丙酸": "shchelochkov2019",
            "todo": "todo1992",
            "肝移植": "todo1992",
            "urea": "todo1992",
            "子宫内膜": "子宫内膜异位症超声评估中国专家共识",
            "超声": "子宫内膜异位症超声评估中国专家共识",
            "endometriosis": "子宫内膜异位症超声评估中国专家共识",
        }

        boosted_doc = None
        for kw, doc_name in doc_boost_keywords.items():
            if kw in query_lower:
                boosted_doc = doc_name
                break

        # Boost results matching the target document
        if boosted_doc:
            for r in results:
                if boosted_doc in r["source"]:
                    r["score"] = min(1.0, r["score"] * 1.3)  # 30% boost
            results.sort(key=lambda x: x["score"], reverse=True)

        return [r for r in results if r["score"] > min_score][:top_k]

    def _faiss_answer(self, query: str, top_k: int = 8) -> Dict[str, Any]:
        """FAISS检索 + 百度Pro问答"""
        results = self._doc_aware_retrieve(query, top_k=top_k)
        if not results:
            return {"answer": "未找到相关文献内容。", "sources": [], "engine": "faiss"}

        parts = [
            f"[参考{i+1} | {r['source']} | 相关度:{r['score']:.2f}]\n{r['text']}"
            for i, r in enumerate(results)
        ]
        context = "\n\n".join(parts)

        prompt = f"""你是医学文献RAG助手。根据以下文献内容回答用户问题。
要求：基于文献内容准确回答，引用来源编号；如文献不足以回答请明确指出；使用中文。

文献内容：
{context}

用户问题：{query}

回答："""

        client = self.clients["baidu_pro"]
        resp = client.chat.completions.create(
            model=PROVIDERS["baidu_pro"]["model"],
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3, max_tokens=800,
        )
        return {
            "answer": resp.choices[0].message.content,
            "sources": [
                {"ref": i+1, "source": r["source"], "score": r["score"],
                 "text_preview": r["text"][:200]}
                for i, r in enumerate(results)
            ],
            "source_count": len(results),
            "engine": "faiss",
        }

    # ═══════════════════════════════════════════════════════
    # LightRAG 引擎 (百度DeepSeek-V4-Pro实体提取 + 讯飞兜底)
    # ═══════════════════════════════════════════════════════

    def _init_lightrag(self):
        if self._lightrag is not None:
            return self._lightrag

        from raganything import RAGAnything, RAGAnythingConfig
        from lightrag.utils import EmbeddingFunc

        config = RAGAnythingConfig(
            working_dir=self.lightrag_working_dir,
            parser="mineru",
            parse_method="auto",
            enable_image_processing=False,
            enable_table_processing=False,
            enable_equation_processing=False,
        )

        # LightRAG的llm_model_func: 用于实体/关系提取
        # 使用百度 DeepSeek-V4-Pro 作为主引擎 (医学知识更准确)
        async def llm_model_func(prompt, system_prompt=None, history_messages=[], **kwargs):
            return await asyncio.to_thread(
                self._llm_entity_extract, prompt, system_prompt
            )

        # VLM: Moonshot 视觉
        def vision_model_func(prompt, system_prompt=None, history_messages=[],
                              image_data=None, messages=None, **kwargs):
            client = self.clients["moonshot_vision"]
            model = PROVIDERS["moonshot_vision"]["model"]

            if messages:
                resp = client.chat.completions.create(
                    model=model, messages=messages,
                    temperature=0.3, max_tokens=600,
                )
                return resp.choices[0].message.content

            if image_data:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt or "请描述这张医学图片。"},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/jpeg;base64,{image_data}"
                            }},
                        ],
                    }],
                    temperature=0.3, max_tokens=600,
                )
                return resp.choices[0].message.content

            # 纯文本回退
            return llm_model_func(prompt, system_prompt, history_messages, **kwargs)

        # Embedding: 本地 BGE-M3
        async def embedding_func(texts: list[str]) -> np.ndarray:
            embeddings = await asyncio.to_thread(
                lambda: self.encode(texts, show_progress=False)
            )
            return np.array(embeddings)

        embedding_cfg = EmbeddingFunc(
            embedding_dim=1024, max_token_size=8192,
            func=embedding_func,
        )

        self._lightrag = RAGAnything(
            config=config,
            llm_model_func=llm_model_func,
            vision_model_func=vision_model_func,
            embedding_func=embedding_cfg,
        )
        logger.info("LightRAG engine initialized (百度DeepSeek-V4-Pro + 讯飞GLM-5.1兜底)")
        return self._lightrag

    async def _lightrag_insert_documents(self, content_dir: str = None) -> bool:
        try:
            rag = self._init_lightrag()
            await rag._ensure_lightrag_initialized()  # LightRAG instance is lazily created
            cdir = Path(content_dir or self.content_dir)

            inserted = 0
            lightrag_seen_hashes = set()
            for f in sorted(cdir.glob("*_content_list.json")):
                try:
                    with open(f, encoding="utf-8") as fh:
                        data = json.load(fh)

                    text_entries = [
                        item.get("text", "").strip()
                        for item in data
                        if item.get("type") == "text" and item.get("text", "").strip()
                    ]
                    if not text_entries:
                        continue

                    doc_name = f.name.replace("_content_list.json", "")

                    # Dedup: skip documents with identical content
                    full_text = "\n\n".join(text_entries)
                    h = hashlib.md5(full_text.encode()).hexdigest()
                    if h in lightrag_seen_hashes:
                        logger.info(f"LightRAG skipping duplicate: {doc_name}")
                        continue
                    lightrag_seen_hashes.add(h)

                    logger.info(f"LightRAG inserting: {doc_name} ({len(text_entries)} entries, {len(full_text)} chars)...")
                    # Use LightRAG's ainsert directly, bypassing RAG-Anything's insert_content_list
                    await rag.lightrag.ainsert(
                        input=full_text,
                        file_paths=f"{doc_name}.pdf",
                    )
                    inserted += 1
                    logger.info(f"  ✓ {doc_name} inserted")
                except Exception as e:
                    logger.warning(f"  ✗ {f.name}: {str(e)[:200]}")

            if inserted > 0:
                self._lightrag_ready = True
                logger.info(f"LightRAG: {inserted}/{len(list(cdir.glob('*_content_list.json')))} unique docs inserted")
                return True
            return False
        except Exception as e:
            logger.error(f"LightRAG init/insert failed: {str(e)[:300]}")
            import traceback
            traceback.print_exc()
            return False

    async def _lightrag_query(self, query: str, mode: str = "hybrid") -> Dict[str, Any]:
        rag = self._init_lightrag()
        await rag._ensure_lightrag_initialized()
        try:
            result = await rag.aquery(query, mode=mode)
            answer = result if isinstance(result, str) else str(result)
            return {"answer": answer, "sources": [], "source_count": 0, "engine": f"lightrag-{mode}"}
        except Exception as e:
            logger.warning(f"LightRAG query failed: {str(e)[:150]}")
            raise

    def _lightrag_query_sync(self, query: str, mode: str = "hybrid") -> Dict[str, Any] | None:
        """Sync wrapper for Agent tool calls (runs in threaded context)."""
        import asyncio
        try:
            return asyncio.run(self._lightrag_query(query, mode))
        except RuntimeError:
            # Already in event loop, create new one
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, self._lightrag_query(query, mode))
                return future.result(timeout=15)
        except Exception as e:
            logger.warning(f"LightRAG sync query failed: {str(e)[:100]}")
            return None

    # ═══════════════════════════════════════════════════════
    # 统一接口
    # ═══════════════════════════════════════════════════════

    def load_documents(self, content_dir: str = None) -> int:
        if content_dir:
            self.content_dir = Path(content_dir)
        return self._load_faiss_documents()

    def build_index(self, force_rebuild: bool = False):
        self._build_faiss_index(force=force_rebuild)

    async def build_lightrag(self, content_dir: str = None) -> bool:
        return await self._lightrag_insert_documents(content_dir)

    def retrieve(self, query: str, top_k: int = 5, min_score: float = 0.3) -> List[Dict]:
        return self._faiss_retrieve(query, top_k, min_score)

    def answer(self, query: str, top_k: int = 8) -> str:
        return self._faiss_answer(query, top_k)["answer"]

    def answer_with_sources(self, query: str, top_k: int = 8) -> Dict[str, Any]:
        return self._faiss_answer(query, top_k)

    async def aanswer(self, query: str, top_k: int = 8, prefer_lightrag: bool = True) -> Dict[str, Any]:
        if prefer_lightrag and self._lightrag_ready:
            try:
                return await self._lightrag_query(query)
            except Exception:
                logger.warning("LightRAG failed, falling back to FAISS")
        return await asyncio.to_thread(self._faiss_answer, query, top_k)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_chunks": len(self.all_chunks),
            "total_documents": self.doc_count,
            "faiss_index_size": self.faiss_index.ntotal if self.faiss_index else 0,
            "embedding_dim": self._embed_dim,
            "lightrag_ready": self._lightrag_ready,
        }

    def save_index(self, path: str = None):
        if self.faiss_index is None:
            return
        import faiss
        p = Path(path or self.cache_dir / "faiss_index.bin")
        faiss.write_index(self.faiss_index, str(p))
        meta_path = p.with_suffix(".meta.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "chunks": self.all_chunks,
                "sources": self.sources,
                "chunk_meta": self.chunk_meta,
                "doc_count": self.doc_count,
            }, f, ensure_ascii=False)
        logger.info(f"Index saved to {p}")

    def load_index(self, path: str = None) -> bool:
        import faiss
        p = Path(path or self.cache_dir / "faiss_index.bin")
        if not p.exists():
            return False
        self.faiss_index = faiss.read_index(str(p))
        meta_path = p.with_suffix(".meta.json")
        if meta_path.exists():
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            self.all_chunks = meta["chunks"]
            self.sources = meta["sources"]
            self.chunk_meta = meta.get("chunk_meta", [])
            self.doc_count = meta.get("doc_count", 0)
            # Rebuild _seen_hashes from loaded chunks
            self._seen_hashes = set()
            for chunk in self.all_chunks:
                self._seen_hashes.add(hashlib.md5(chunk.encode()).hexdigest())
        logger.info(f"Index loaded: {self.faiss_index.ntotal} vectors, {self.doc_count} docs")
        return True

    # ═══════════════════════════════════════════════════════
    # Remote PDF parsing + incremental indexing (T1)
    # ═══════════════════════════════════════════════════════

    def parse_remote_pdf(self, pdf_path: str) -> Optional[str]:
        """
        SSH to remote Linux, upload PDF, run MinerU, download content_list JSON.

        Uses Existing RemoteMinerUParser class from scripts/remote_parse.py.
        Credentials are read from env vars REMOTE_HOST/REMOTE_PORT/REMOTE_USER/REMOTE_PASSWORD.
        Returns the local path to the downloaded content_list JSON.
        """
        import scripts.remote_parse as rp

        # Apply env var overrides to RemoteMinerUParser's module-level constants
        rp.REMOTE_HOST = os.getenv("REMOTE_HOST", "82.156.142.212")
        rp.REMOTE_PORT = int(os.getenv("REMOTE_PORT", "22"))
        rp.REMOTE_USER = os.getenv("REMOTE_USER", "root")
        rp.REMOTE_PASSWORD = os.getenv("REMOTE_PASSWORD") or ""

        self._upload_state = {
            "state": "connecting",
            "filename": str(pdf_path),
            "error": None,
            "chunks_added": 0,
        }

        remote = rp.RemoteMinerUParser()
        try:
            remote.connect()
            self._upload_state["state"] = "uploading"
            remote.ensure_dirs()

            remote_pdf_path = remote.upload_pdf(str(pdf_path))

            self._upload_state["state"] = "parsing"
            remote_content_list = remote.parse_pdf(remote_pdf_path)
            if not remote_content_list:
                self._upload_state["state"] = "error"
                self._upload_state["error"] = "MinerU parsing failed (no content_list.json found)"
                return None

            self._upload_state["state"] = "downloading"
            local_name = Path(remote_content_list).name
            local_path = self.content_dir / local_name
            self.content_dir.mkdir(parents=True, exist_ok=True)
            remote.sftp.get(remote_content_list, str(local_path))

            self._upload_state["state"] = "done"
            logger.info(f"PDF parsed successfully: {local_path}")
            return str(local_path)

        except Exception as e:
            self._upload_state["state"] = "error"
            self._upload_state["error"] = str(e)[:500]
            logger.error(f"Remote parsing failed: {e}")
            raise

        finally:
            remote.close()

    def add_parsed_document(self, content_list_path: str) -> int:
        """
        Load a content_list JSON, append new text chunks to the FAISS index incrementally.

        Uses self._seen_hashes for O(1) dedup — skips chunks whose MD5 hash is already
        present. New chunks are re-encoded via BGE-M3 and added to the FAISS index.
        Calls save_index() after adding.
        Returns the number of new chunks added.
        """
        content_list_path = Path(content_list_path)
        self._upload_state["state"] = "indexing"
        self._upload_state["error"] = None
        self._upload_state["chunks_added"] = 0

        if not content_list_path.exists():
            raise FileNotFoundError(f"Content list not found: {content_list_path}")

        with open(content_list_path, encoding="utf-8") as fh:
            data = json.load(fh)

        doc_name = content_list_path.name.replace("_content_list.json", "")
        new_chunks: List[str] = []
        new_sources: List[str] = []
        new_meta: List[Dict] = []

        for item in data:
            t = item.get("type", "text")
            if t == "text":
                text = item.get("text", "").strip()
                if text and len(text) > 30:
                    h = hashlib.md5(text.encode()).hexdigest()
                    if h in self._seen_hashes:
                        continue
                    self._seen_hashes.add(h)
                    new_chunks.append(text)
                    new_sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}]")
                    new_meta.append({
                        "type": "text", "page_idx": item.get("page_idx", 0),
                        "doc_name": doc_name,
                    })
            elif t == "image":
                captions = item.get("image_caption", [])
                cap = " ".join(captions) if captions else ""
                if cap and len(cap) > 20:
                    img_path = item.get("img_path", "")
                    vlm_result = None
                    if img_path:
                        vlm_result = self._analyze_chart_image(img_path, cap)
                    if vlm_result:
                        text = f"[图表-VLM分析] 类型:{vlm_result.get('chart_type','?')}\n{vlm_result.get('summary','')}\n{vlm_result.get('description','')}"
                    else:
                        text = f"[图片] {cap}"
                    h = hashlib.md5(text.encode()).hexdigest()
                    if h in self._seen_hashes:
                        continue
                    self._seen_hashes.add(h)
                    new_chunks.append(text)
                    new_sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}, image]")
                    new_meta.append({
                        "type": "image", "page_idx": item.get("page_idx", 0),
                        "doc_name": doc_name, "vlm_analyzed": bool(vlm_result),
                    })
            elif t == "table":
                body = item.get("table_body", "")
                cap = " ".join(item.get("table_caption", []))
                text = f"[表格] {cap}\n{body}" if body else f"[表格] {cap}"
                if len(text) > 30:
                    h = hashlib.md5(text.encode()).hexdigest()
                    if h in self._seen_hashes:
                        continue
                    self._seen_hashes.add(h)
                    new_chunks.append(text)
                    new_sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}, table]")
                    new_meta.append({
                        "type": "table", "page_idx": item.get("page_idx", 0),
                        "doc_name": doc_name,
                    })

        if not new_chunks:
            logger.info(f"No new chunks from {doc_name} (all deduplicated)")
            self._upload_state["state"] = "done"
            return 0

        # Classify sections for text chunks
        for i, meta in enumerate(new_meta):
            if meta.get("type") == "text" and "section_tag" not in meta:
                try:
                    tag = self._chunker.classify_section(new_chunks[i])
                    meta["section_tag"] = tag
                except Exception as e:
                    logger.warning(f"Section classification failed for chunk {i}: {e}")
                    meta["section_tag"] = "unknown"

        # Append to main lists
        self.all_chunks.extend(new_chunks)
        self.sources.extend(new_sources)
        self.chunk_meta.extend(new_meta)

        # Add to FAISS index if it exists
        if self.faiss_index is not None:
            import faiss
            logger.info(f"Encoding {len(new_chunks)} new chunks for incremental index update...")
            new_embeddings = self.encode(new_chunks, show_progress=False)
            self.faiss_index.add(new_embeddings.astype(np.float32))
            logger.info(f"FAISS index: {self.faiss_index.ntotal} vectors (was {self.faiss_index.ntotal - len(new_chunks)})")

        # Update doc count
        self.doc_count = len(set(s.split(" [p.")[0] for s in self.sources))

        self._upload_state["chunks_added"] = len(new_chunks)
        self._upload_state["state"] = "done"
        self._upload_state["filename"] = str(content_list_path)

        # Persist updated index
        self.save_index()

        logger.info(f"Added {len(new_chunks)} chunks from {doc_name}")
        return len(new_chunks)


# ─── CLI Entry ──────────────────────────────────────────

def main():
    pipeline = MedicalRAGPipeline()
    pipeline.load_documents()
    pipeline.build_index()

    stats = pipeline.get_stats()
    print(f"\n知识库状态: {stats}")

    queries = [
        "Stanford B型主动脉夹层的诊断标准是什么？",
        "Stanford B型主动脉夹层如何分型和分期？",
        "TBAD的药物治疗方案有哪些？",
        "主动脉夹层腔内修复术的适应症是什么？",
    ]

    print("\n" + "=" * 60)
    print("MEDICAL RAG Q&A (FAISS + 百度 DeepSeek-V4-Pro)")
    print("=" * 60)

    for q in queries:
        r = pipeline.answer_with_sources(q)
        print(f"\nQ: {q}")
        print(f"A: {r['answer']}")
        print(f"   Engine: {r['engine']}, Sources: {r['source_count']}")
        print("-" * 40)

    pipeline.save_index()


async def main_lightrag():
    pipeline = MedicalRAGPipeline()
    pipeline.load_documents()
    pipeline.build_index()

    print("Building LightRAG knowledge graph (讯飞 GLM-5.1)...")
    ok = await pipeline.build_lightrag()
    print(f"LightRAG ready: {ok}")

    if ok:
        q = "Stanford B型主动脉夹层的诊断标准是什么？"
        r = await pipeline.aanswer(q, prefer_lightrag=True)
        print(f"\nQ: {q}")
        print(f"A: {r['answer'][:600]}")
        print(f"   Engine: {r['engine']}")


if __name__ == "__main__":
    import sys
    if "--lightrag" in sys.argv:
        asyncio.run(main_lightrag())
    else:
        main()
