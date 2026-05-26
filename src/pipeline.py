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
from typing import Dict, List, Any, Optional, Tuple

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

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
    "xunfei": {
        "base_url": os.getenv("XUNFEI_BASE_URL"),
        "api_key": os.getenv("XUNFEI_API_KEY"),
        "model": os.getenv("XUNFEI_MODEL"),
    },
    "baidu_flash": {
        "base_url": os.getenv("BAIDU_BASE_URL"),
        "api_key": os.getenv("BAIDU_API_KEY"),
        "model": os.getenv("BAIDU_FLASH_MODEL"),
    },
    "baidu_pro": {
        "base_url": os.getenv("BAIDU_PRO_BASE_URL"),
        "api_key": os.getenv("BAIDU_PRO_API_KEY"),
        "model": os.getenv("BAIDU_PRO_MODEL"),
    },
    "moonshot_vision": {
        "base_url": os.getenv("MOONSHOT_BASE_URL"),
        "api_key": os.getenv("MOONSHOT_API_KEY"),
        "model": os.getenv("MOONSHOT_MODEL"),
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
        self._chunk_faiss_id: List[int] = []   # chunk_idx → FAISS vector ID
        self._next_faiss_id: int = 0           # monotonically increasing
        self._faiss_id_to_chunk: Dict[int, int] = {}  # reverse lookup for search

        # ─── 医学语义分块器 (LLM精准分类 + 规则兜底) ───
        from src.medical_chunker import MedicalChunker
        self._chunker = MedicalChunker(llm_model_func=self._llm_classify_chunk)

        # ─── LightRAG 引擎 ───
        self._lightrag = None
        self._lightrag_ready = False
        self._lightrag_dirty = False  # set on doc update; triggers incremental rebuild

        # ─── Knowledge Graph ───
        from src.graph import GraphManager
        self.graph_manager = GraphManager()

        # Dedup
        self._seen_hashes: set = set()

        # Document-level tracking: doc_name → list of chunk indices
        self._doc_map: Dict[str, List[int]] = {}

        # Remote upload state
        self._upload_state = {
            "state": "idle",
            "filename": None,
            "error": None,
            "chunks_added": 0,
            "is_update": False,
            "replaced_doc": None,
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
        self._doc_map.clear()
        for f in sorted(self.content_dir.glob("*_content_list.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    data = json.load(fh)
            except Exception as e:
                logger.warning(f"Failed to load {f.name}: {e}")
                continue

            doc_name = f.name.replace("_content_list.json", "")
            _start = len(self.all_chunks)
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
                elif t in ("image", "chart"):
                    captions = item.get("image_caption", [])
                    cap = " ".join(captions) if captions else ""
                    if cap and len(cap) > 20:
                        # Try VLM analysis for clinical charts
                        img_path = item.get("img_path", "")
                        vlm_result = None
                        if img_path:
                            vlm_result = self._analyze_chart_image(img_path, cap)
                        if vlm_result:
                            chart_type = vlm_result.get('chart_type','?')
                            kw_map = {"flowchart":"流程图 图表 图 诊断", "classification_diagram":"分型 分类 示意图 图表 图",
                                      "baseline_table":"基线 表格 表", "outcome_table":"结局 表格 表",
                                      "forest_plot":"森林图 图表 图", "km_curve":"生存曲线 图表 图"}
                            keywords = kw_map.get(chart_type, "图表 图 表格")
                            text = f"[图表-VLM分析] {keywords} 类型:{chart_type}\n{vlm_result.get('summary','')}\n{vlm_result.get('description','')}"
                            # For tables: VLM→structured data→text model serializes→natural language
                            if chart_type in ("baseline_table", "outcome_table") and vlm_result.get("_vlm_analyzed"):
                                text = self._serialize_vlm_table(vlm_result, chart_type, text)
                        else:
                            text = f"[图片] {cap}"
                        h = hashlib.md5(text.encode()).hexdigest()
                        if h in self._seen_hashes:
                            continue
                        self._seen_hashes.add(h)
                        self.all_chunks.append(text)
                        self.sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}, image]")
                        # Store image URL for frontend rendering
                        img_filename = os.path.basename(img_path) if img_path else ""
                        self.chunk_meta.append({
                            "type": "image", "page_idx": item.get("page_idx", 0),
                            "doc_name": doc_name, "vlm_analyzed": bool(vlm_result),
                            "img_path": img_path,
                            "image_url": f"/images/{img_filename}" if img_filename else None,
                        })
                elif t == "table":
                    body = item.get("table_body", "")
                    if not body or not body.strip():
                        continue  # 空表格: 无结构化数据可索引
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

            # Record which chunks belong to this document
            self._doc_map[doc_name] = list(range(_start, len(self.all_chunks)))

        # ─── 医学语义分块: LLM批量分类 + 规则兜底 ───
        text_indices = [i for i, m in enumerate(self.chunk_meta)
                        if m.get("type") == "text" and "section_tag" not in m]
        if text_indices:
            text_batch = [self.all_chunks[i] for i in text_indices]
            try:
                tags = self._chunker.classify_batch_llm(text_batch)
                for idx, tag in zip(text_indices, tags):
                    self.chunk_meta[idx]["section_tag"] = tag
                logger.info(f"LLM classified {len(tags)} chunks")
            except Exception as e:
                logger.warning(f"LLM batch classify failed, falling back to rules: {e}")
                for i in text_indices:
                    try:
                        self.chunk_meta[i]["section_tag"] = self._chunker.classify_section(self.all_chunks[i])
                    except Exception:
                        self.chunk_meta[i]["section_tag"] = "unknown"

        # ─── Global semantic merge: combine adjacent same-section chunks ───
        if len(self.all_chunks) > 1:
            try:
                client = self.clients.get("baidu_pro")
                model = PROVIDERS.get("baidu_pro", {}).get("model", "deepseek-v4-pro")
                if client:
                    new_chunks, new_sources, new_metas = self._chunker.global_merge_chunks(
                        self.all_chunks, self.sources, self.chunk_meta,
                        llm_client=client, llm_model=model,
                    )
                    self.all_chunks = new_chunks
                    self.sources = new_sources
                    self.chunk_meta = new_metas
                    # Rebuild _doc_map and _seen_hashes after merge
                    self._doc_map.clear()
                    self._seen_hashes.clear()
                    for idx, src in enumerate(self.sources):
                        doc = src.split(" [p.")[0]
                        self._doc_map.setdefault(doc, []).append(idx)
                        self._seen_hashes.add(hashlib.md5(self.all_chunks[idx].encode()).hexdigest())
                    logger.info(f"Semantic merge: {self.doc_count} docs merged")
            except Exception as e:
                logger.warning(f"Semantic merge failed, keeping original chunks: {e}")

        self.doc_count = len(set(s.split(" [p.")[0] for s in self.sources))
        logger.info(f"FAISS: loaded {len(self.all_chunks)} chunks from {self.doc_count} docs")
        return len(self.all_chunks)

    def _llm_classify_chunk(self, prompt: str) -> str:
        """LLM分类器 — 用百度Flash做快速章节分类"""
        try:
            client = self.clients.get("baidu_flash", self.clients.get("baidu_pro"))
            if not client:
                return ""
            model = PROVIDERS.get("baidu_flash", PROVIDERS.get("baidu_pro", {})).get("model", "")
            resp = client.chat.completions.create(
                model=model, temperature=0.1, max_tokens=20,
                messages=[{"role": "user", "content": prompt}],
                timeout=10.0,
            )
            return resp.choices[0].message.content
        except Exception:
            return ""

    def _analyze_chart_image(self, img_path: str, caption: str) -> dict | None:
        """用 Moonshot VLM 分析医学图表。Step1:分类 → Step2:专用提示词提取结构化数据。
        集成 medical_vlm.py 的丰富提示词用于基线表和结局指标表。"""
        import base64
        from pathlib import Path
        if not Path(img_path).exists():
            return None
        try:
            b64 = base64.b64encode(Path(img_path).read_bytes()).decode()
        except Exception:
            return None

        client = self.clients.get("moonshot_vision")
        if not client:
            return None
        model = PROVIDERS["moonshot_vision"]["model"]

        # ── Step 1: classify chart type (fast, cheap) ──
        classify_prompt = f"""判断这张医学图表的类型。标题: {caption}
类型选项: baseline_table(基线特征表) / outcome_table(结局指标表) / forest_plot(森林图) / km_curve(生存曲线) / flowchart(流程图) / other
只回复类型名称。"""
        try:
            resp = client.chat.completions.create(
                model=model, temperature=0.1, max_tokens=30,
                messages=[{"role":"user","content":[
                    {"type":"text","text":classify_prompt},
                    {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{b64}"}},
                ]}])
            chart_type = resp.choices[0].message.content.strip().lower()
        except Exception:
            chart_type = "other"

        # ── Step 2: specialized prompt per type (from medical_vlm.py) ──
        from src.medical_vlm import (
            BASELINE_TABLE_PROMPT, OUTCOME_TABLE_PROMPT,
            FOREST_PLOT_PROMPT, KM_CURVE_PROMPT, FLOWCHART_PROMPT,
        )
        prompts = {
            "baseline_table": BASELINE_TABLE_PROMPT,
            "outcome_table": OUTCOME_TABLE_PROMPT,
            "forest_plot": FOREST_PLOT_PROMPT,
            "km_curve": KM_CURVE_PROMPT,
            "flowchart": FLOWCHART_PROMPT,
        }
        detail_prompt = prompts.get(chart_type, f"""分析这张医学图表。标题:{caption}
输出JSON: {{"chart_type":"{chart_type}","key_findings":"","description":"","clinical_significance":""}}""")
        detail_prompt = detail_prompt.replace("{table_content}", f"标题: {caption}")
        detail_prompt = detail_prompt.replace("{image_content}", f"标题: {caption}")

        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role":"user","content":[
                    {"type":"text","text":detail_prompt},
                    {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{b64}"}},
                ]}],
                temperature=0.3, max_tokens=800,
            )
            raw = resp.choices[0].message.content.strip()
            if "```json" in raw:
                raw = raw[raw.find("```json") + 7:]
            if "```" in raw:
                raw = raw[:raw.rfind("```")]
            import json
            result = json.loads(raw.strip())
            result["chart_type"] = result.get("chart_type", chart_type)
            result["_vlm_analyzed"] = True
            return result
        except Exception as e:
            logger.warning(f"VLM detail analysis failed for {img_path}: {e}")
            return {"chart_type": chart_type, "summary": caption, "description": "",
                    "_vlm_analyzed": False, "_error": str(e)[:100]}

    def _serialize_vlm_table(self, vlm_result: dict, chart_type: str, fallback_text: str) -> str:
        """VLM结构化数据 → baidu_pro文本模型 → 自然语言段落。VLM看图,文本模型写。"""
        try:
            client = self.clients.get("baidu_pro")
            model = PROVIDERS.get("baidu_pro", {}).get("model", "deepseek-v4-pro")
            if not client:
                return fallback_text

            # Build structured input for text model
            if chart_type == "baseline_table" and vlm_result.get("characteristics"):
                rows = []
                for c in vlm_result.get("characteristics", [])[:15]:
                    rows.append(f"{c.get('variable','')}: 组1={c.get('group1_value','')}, 组2={c.get('group2_value','')}, p={c.get('p_value','')}")
                data_text = "\n".join(rows)
                prompt = f"""将以下基线特征表数据转化为一段自包含的连贯医学段落。保留所有数值和p值,说明组间均衡性。

研究分组: {vlm_result.get('study_groups',[])}
总患者数: {vlm_result.get('total_patients','?')}
数据:
{data_text}
组间均衡性: {vlm_result.get('balance_assessment','')}

输出纯文本段落:"""
            elif chart_type == "outcome_table" and vlm_result.get("outcomes"):
                rows = []
                for o in vlm_result.get("outcomes", [])[:15]:
                    rows.append(f"{o.get('outcome_name','')}: {o.get('effect_measure','')}={o.get('effect_value','')}, 95%CI {o.get('ci_lower','')}-{o.get('ci_upper','')}, p={o.get('p_value','')}")
                data_text = "\n".join(rows)
                prompt = f"""将以下结局指标表数据转化为一段自包含的连贯医学段落。保留所有效应量和置信区间。

主要终点达成: {vlm_result.get('primary_endpoint_met','?')}
数据:
{data_text}
总结: {vlm_result.get('summary','')}

输出纯文本段落:"""
            else:
                return fallback_text

            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2, max_tokens=500, timeout=30.0,
            )
            serialized = resp.choices[0].message.content.strip()
            return f"[图表解析] {serialized}"
        except Exception as e:
            logger.warning(f"VLM table serialization failed, using fallback: {e}")
            return fallback_text

    def _build_faiss_index(self, force: bool = False):
        if not self.all_chunks:
            self._load_faiss_documents()
        if self.faiss_index is not None and not force:
            return

        import faiss
        logger.info(f"FAISS: embedding {len(self.all_chunks)} chunks...")
        embeddings = self.encode(self.all_chunks, show_progress=True)
        self._embed_dim = embeddings.shape[1]
        base_index = faiss.IndexFlatIP(self._embed_dim)
        self.faiss_index = faiss.IndexIDMap(base_index)
        ids = np.arange(self._next_faiss_id, self._next_faiss_id + len(self.all_chunks), dtype=np.int64)
        self._next_faiss_id += len(self.all_chunks)
        self.faiss_index.add_with_ids(embeddings.astype(np.float32), ids)
        # Build ID mappings
        self._chunk_faiss_id = ids.tolist()
        self._faiss_id_to_chunk = {int(fid): idx for idx, fid in enumerate(self._chunk_faiss_id)}
        logger.info(f"FAISS index: {self.faiss_index.ntotal} vectors, dim={self._embed_dim}, IndexIDMap")

        # Auto-save after successful build
        self.save_index()

    def _faiss_retrieve(self, query: str, top_k: int = 5, min_score: float = 0.3) -> List[Dict]:
        if self.faiss_index is None:
            self._build_faiss_index()
        q_emb = self.encode([query])
        scores, faiss_ids = self.faiss_index.search(q_emb.astype(np.float32), top_k)
        results = []
        for score, fid in zip(scores[0], faiss_ids[0]):
            cid = self._faiss_id_to_chunk.get(int(fid), -1)
            if cid >= 0 and cid < len(self.all_chunks) and score > min_score:
                results.append({
                    "score": float(score), "text": self.all_chunks[cid],
                    "source": self.sources[cid],
                    "meta": self.chunk_meta[cid] if cid < len(self.chunk_meta) else {},
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

        # Build sources with image URLs for frontend rendering
        sources_out = []
        for i, r in enumerate(results):
            meta = r.get("meta", {})
            src = {
                "ref": i + 1,
                "source": r["source"],
                "score": round(r["score"], 3),
                "text_preview": r["text"][:200],
            }
            if meta.get("image_url"):
                src["image_url"] = meta["image_url"]
                src["chart_type"] = meta.get("type", "image")
            sources_out.append(src)

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
            "sources": sources_out,
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
            parser="docling",
            parse_method="auto",
            enable_image_processing=True,
            enable_table_processing=True,
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

        # Neo4j backend if configured, else NetworkX (file-based)
        neo4j_uri = os.getenv("NEO4J_URI")
        if neo4j_uri:
            logger.info(f"LightRAG using Neo4j backend: {neo4j_uri}")
            lightrag_kwargs = {"graph_storage": "Neo4JStorage"}
        else:
            lightrag_kwargs = {}

        self._lightrag = RAGAnything(
            config=config,
            llm_model_func=llm_model_func,
            vision_model_func=vision_model_func,
            embedding_func=embedding_cfg,
            lightrag_kwargs=lightrag_kwargs,
        )
        backend = "Neo4j" if neo4j_uri else "NetworkX"
        logger.info(f"LightRAG engine initialized ({backend} backend, 百度DeepSeek-V4-Pro + 讯飞GLM-5.1兜底)")
        return self._lightrag

    async def _lightrag_reset_and_rebuild(self):
        """Atomic LightRAG rebuild: backup → rebuild → replace on success.
        On failure, restore backup and clear dirty flag."""
        import shutil
        wd = Path(self.lightrag_working_dir)
        backup_dir = wd.parent / f"{wd.name}_backup"
        md5_file = wd / "_doc_md5s.json"
        persisted_md5s = {}
        if md5_file.exists():
            try:
                import json as _json
                persisted_md5s = _json.loads(md5_file.read_text(encoding="utf-8"))
            except Exception:
                persisted_md5s = {}

        # Atomic: move old storage to backup, not delete
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        if wd.exists():
            shutil.move(str(wd), str(backup_dir))
            wd.mkdir(parents=True, exist_ok=True)
            # Restore MD5 file to new dir
            old_md5 = backup_dir / "_doc_md5s.json"
            if old_md5.exists():
                shutil.copy2(str(old_md5), str(md5_file))

        try:
            self._lightrag = None
            self._lightrag_ready = False
            rag = self._init_lightrag()
            await rag._ensure_lightrag_initialized()
            inserted = await self._lightrag_insert_documents(persisted_md5s=persisted_md5s)
            self._lightrag_ready = True
            self._lightrag_dirty = False
            # Persist MD5s
            try:
                import json as _json
                from hashlib import md5 as _md5
                new_md5s = {}
                for f in sorted(Path(self.content_dir).glob("*_content_list.json")):
                    with open(f, encoding="utf-8") as fh:
                        data = _json.load(fh)
                    texts = [it.get("text","").strip() for it in data
                             if it.get("type")=="text" and it.get("text","").strip()]
                    if texts:
                        new_md5s[f.name] = _md5("\n\n".join(texts).encode()).hexdigest()
                md5_file.write_text(_json.dumps(new_md5s, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass
            # Success → remove backup
            if backup_dir.exists():
                shutil.rmtree(backup_dir)
            logger.info(f"LightRAG atomic rebuild done: {inserted} docs inserted")
            return inserted
        except Exception as e:
            # Restore from backup
            logger.error(f"LightRAG rebuild failed, restoring backup: {e}")
            self._lightrag_dirty = False
            self._lightrag_ready = False
            if wd.exists():
                shutil.rmtree(str(wd))
            if backup_dir.exists():
                shutil.move(str(backup_dir), str(wd))
            raise

    async def _lightrag_insert_documents(self, content_dir: str = None,
                                          persisted_md5s: dict = None) -> bool:
        try:
            rag = self._init_lightrag()
            await rag._ensure_lightrag_initialized()  # LightRAG instance is lazily created
            cdir = Path(content_dir or self.content_dir)

            inserted = 0
            lightrag_seen_hashes = set()
            if persisted_md5s:
                lightrag_seen_hashes.update(persisted_md5s.values())
                logger.info(f"LightRAG dedup: loaded {len(persisted_md5s)} persisted doc hashes")
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
        """Sync wrapper for Agent tool calls. Handles both threaded and async contexts."""
        import asyncio
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._lightrag_query(query, mode))
        # Already in event loop — use concurrent.futures in a new thread
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(asyncio.run, self._lightrag_query(query, mode))
            try:
                return future.result(timeout=20)
            except concurrent.futures.TimeoutError:
                logger.warning("LightRAG query timed out after 20s")
                return None
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

    async def aanswer(self, query: str, top_k: int = 8, prefer_lightrag: bool = False) -> Dict[str, Any]:
        # FAISS first — provides sources with image_url for frontend rendering
        result = await asyncio.to_thread(self._faiss_answer, query, top_k)
        # Supplement with LightRAG if available
        if prefer_lightrag and self._lightrag_ready:
            try:
                lr = await self._lightrag_query(query)
                if lr and lr.get("answer"):
                    result["answer"] = lr["answer"] + "\n\n---\n" + result["answer"]
                    result["engine"] = "hybrid"
            except Exception:
                logger.warning("LightRAG supplement failed")
        return result

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
                "doc_map": {k: list(v) for k, v in self._doc_map.items()},
                "chunk_faiss_id": self._chunk_faiss_id,
                "next_faiss_id": self._next_faiss_id,
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
            self._doc_map = meta.get("doc_map", {})
            self._chunk_faiss_id = meta.get("chunk_faiss_id", [])
            self._next_faiss_id = meta.get("next_faiss_id", len(self.all_chunks))
            self._faiss_id_to_chunk = {self._chunk_faiss_id[i]: i for i in range(len(self._chunk_faiss_id))}
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
        Dual-engine PDF parsing: Docling (local primary) → MinerU (remote validator).
        Docling via RAG-Anything built-in parser. MinerU via SSH for cross-validation.
        Post-processing quality layer applied to final output.
        """
        import scripts.remote_parse as rp
        pdf_path_obj = Path(pdf_path)

        self._upload_state = {
            "state": "parsing",
            "filename": str(pdf_path_obj.name),
            "error": None,
            "chunks_added": 0,
            "is_update": False,
            "replaced_doc": None,
        }

        # ── Engine 1+2: Docling local + MinerU remote — concurrent ──
        # Both engines are independent: Docling is CPU-bound (local), MinerU is I/O-bound (SSH).
        # Running them concurrently cuts parsing time to max(Docling, MinerU) instead of sum.
        from concurrent.futures import ThreadPoolExecutor

        def _parse_mineru():
            try:
                rp.REMOTE_HOST = os.getenv("REMOTE_HOST", "")
                rp.REMOTE_PORT = int(os.getenv("REMOTE_PORT", "22"))
                rp.REMOTE_USER = os.getenv("REMOTE_USER", "root")
                rp.REMOTE_PASSWORD = os.getenv("REMOTE_PASSWORD") or ""
                if not rp.REMOTE_HOST:
                    return None
                remote = rp.RemoteMinerUParser()
                remote.connect()
                remote.ensure_dirs()
                remote_pdf = remote.upload_pdf(str(pdf_path_obj))
                self._upload_state["state"] = "parsing"
                remote_cl = remote.parse_pdf(remote_pdf)
                if not remote_cl:
                    return None
                self._upload_state["state"] = "downloading"
                local_name = Path(remote_cl).name
                mineru_path = self.content_dir / f"mineru_{local_name}"
                self.content_dir.mkdir(parents=True, exist_ok=True)
                remote.sftp.get(remote_cl, str(mineru_path))
                logger.info(f"MinerU validator output: {mineru_path}")
                return str(mineru_path)
            except Exception as e:
                logger.warning(f"MinerU remote unavailable, using Docling only: {e}")
                return None

        with ThreadPoolExecutor(max_workers=2) as executor:
            dl_future = executor.submit(self._parse_local_docling, str(pdf_path_obj))
            mu_future = executor.submit(_parse_mineru)
            docling_path = dl_future.result()
            mineru_path = mu_future.result()

        # ── Engine 3: PaddleOCR emergency fallback ──
        paddleocr_path = None
        if not docling_path and not mineru_path:
            try:
                from raganything.parser import Parser
                from raganything.config import RAGAnythingConfig
                config = RAGAnythingConfig(parser="paddleocr", parse_method="auto")
                parser = Parser(config)
                result = parser.parse_pdf(str(pdf_path_obj))
                if result and result.get("content_list"):
                    paddleocr_path = self.content_dir / f"{pdf_path_obj.stem}_content_list.json"
                    with open(paddleocr_path, "w", encoding="utf-8") as f:
                        json.dump(result["content_list"], f, ensure_ascii=False, indent=2)
                    logger.info(f"PaddleOCR fallback: {paddleocr_path}")
            except Exception as e:
                logger.warning(f"PaddleOCR also failed: {e}")

        # ── Decide final output ──
        if docling_path:
            final_path = docling_path
            self._upload_state["engine"] = "docling"
        elif mineru_path:
            final_path = mineru_path
            self._upload_state["engine"] = "mineru"
        elif paddleocr_path:
            final_path = paddleocr_path
            self._upload_state["engine"] = "paddleocr"
        else:
            self._upload_state["state"] = "error"
            self._upload_state["error"] = "All 3 parsers failed (Docling + MinerU + PaddleOCR)"
            return None

        # ── Cross-validation: LLM arbitration on divergence ──
        if docling_path and mineru_path:
            try:
                with open(docling_path) as f: dl = json.load(f)
                with open(mineru_path) as f: mu = json.load(f)
                dl_texts = [i for i in dl if i.get("type") == "text"]
                mu_texts = [i for i in mu if i.get("type") == "text"]
                dl_t = len(dl_texts)
                mu_t = len(mu_texts)
                divergence = abs(dl_t - mu_t) / max(dl_t, 1)
                logger.info(f"Parse diff: Docling={dl_t}text vs MinerU={mu_t}text, divergence={divergence:.1%}")

                if divergence > 0.3:
                    logger.info(f"Divergence >30% — LLM quality scoring")
                    dl_sample = [t.get("text", "")[:200] for t in dl_texts[:8]]
                    mu_sample = [t.get("text", "")[:200] for t in mu_texts[:8]]
                    try:
                        cv_url = os.getenv("CROSS_VALIDATION_BASE_URL")
                        cv_key = os.getenv("CROSS_VALIDATION_API_KEY")
                        cv_model = os.getenv("CROSS_VALIDATION_MODEL")
                        if cv_url and cv_key:
                            from openai import OpenAI as OAI
                            cv_client = OAI(base_url=cv_url, api_key=cv_key)
                            prompt = f"""评估两个PDF解析器的输出质量，分别打分。

解析器A (Docling, {dl_t}文本块):
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(dl_sample))}

解析器B (MinerU, {mu_t}文本块):
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(mu_sample))}

评分标准(1-10分): 文本无截断/段落连贯/表格正文区分准确
回复格式: A=X B=Y (一句话理由)"""
                            resp = cv_client.chat.completions.create(
                                model=cv_model,
                                messages=[{"role": "user", "content": prompt}],
                                temperature=0.1, max_tokens=60, timeout=20.0,
                            )
                            verdict = resp.choices[0].message.content.strip()
                            logger.info(f"LLM quality scores: {verdict}")
                            import re
                            scores = {}
                            for m in re.finditer(r'([AB])\s*=\s*(\d+)', verdict, re.IGNORECASE):
                                scores[m.group(1).upper()] = int(m.group(2))
                            score_a = scores.get("A", 7)
                            score_b = scores.get("B", 7)
                            # Score <7 → involve LLM for quality improvement
                            if score_a < 7 and score_b < 7:
                                logger.warning(f"Both parsers scored low (A={score_a}, B={score_b}) — trying PaddleOCR")
                                try:
                                    from raganything.parser import Parser
                                    from raganything.config import RAGAnythingConfig
                                    config = RAGAnythingConfig(parser="paddleocr", parse_method="auto")
                                    parser = Parser(config)
                                    result = parser.parse_pdf(str(pdf_path_obj))
                                    if result and result.get("content_list"):
                                        paddleocr_path = self.content_dir / f"{pdf_path_obj.stem}_content_list.json"
                                        with open(paddleocr_path, "w", encoding="utf-8") as f:
                                            json.dump(result["content_list"], f, ensure_ascii=False, indent=2)
                                        # Score PaddleOCR too
                                        pd_texts = [i for i in result["content_list"] if i.get("type") == "text"]
                                        pd_sample = [t.get("text", "")[:200] for t in pd_texts[:8]]
                                        pd_prompt = f"""评估此PDF解析器输出质量(1-10分)。
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(pd_sample))}
评分标准: 文本无截断/段落连贯/表格正文区分
回复格式: score=X (一句话)"""
                                        pd_resp = cv_client.chat.completions.create(
                                            model=cv_model,
                                            messages=[{"role": "user", "content": pd_prompt}],
                                            temperature=0.1, max_tokens=40, timeout=20.0,
                                        )
                                        pd_verdict = pd_resp.choices[0].message.content.strip()
                                        pd_score = int(re.search(r'score\s*=\s*(\d+)', pd_verdict, re.IGNORECASE).group(1)) if re.search(r'score\s*=\s*(\d+)', pd_verdict, re.IGNORECASE) else 7
                                        logger.info(f"PaddleOCR score: {pd_score}")
                                        # All three low → LLM reconstruct
                                        if score_a < 7 and score_b < 7 and pd_score < 7:
                                            logger.warning(f"All 3 parsers scored low — LLM reconstruction")
                                            best_sample = dl_sample if score_a >= score_b else mu_sample
                                            reconstruct_prompt = f"""以下PDF解析输出可能包含错误(截断句/段落断裂/结构混乱)。请根据碎片化内容重建正确的医学文档结构。

原始碎片:
{chr(10).join(f'{i+1}. {t}' for i, t in enumerate(best_sample))}

任务:
1. 合并明显被截断的句子
2. 识别并标注章节边界(如Abstract/Introduction/Methods/Results/Discussion)
3. 将连续段落按逻辑顺序重组
4. 删除明显的OCR噪声/乱码

输出格式: 直接输出重建后的完整文本，章节标题用##标记。"""
                                            recon_resp = cv_client.chat.completions.create(
                                                model=cv_model,
                                                messages=[{"role": "user", "content": reconstruct_prompt}],
                                                temperature=0.3, max_tokens=2000, timeout=60.0,
                                            )
                                            reconstructed = recon_resp.choices[0].message.content.strip()
                                            # Replace content_list with reconstructed version
                                            reconstructed_items = [{"type": "text", "text": reconstructed, "page_idx": 0,
                                                "_reconstructed": True, "_source_engines": "docling+mineru+paddleocr",
                                                "_quality_warning": f"三引擎评分均低(A={score_a}/B={score_b}/C={pd_score}), LLM从碎片重建, 建议人工校对"}]
                                            with open(final_path, "w", encoding="utf-8") as f:
                                                json.dump(reconstructed_items, f, ensure_ascii=False, indent=2)
                                            self._upload_state["engine"] = "llm-reconstructed"
                                            self._upload_state["quality_warning"] = f"解析质量存疑: 三引擎评分均低(Docling={score_a}/MinerU={score_b}/PaddleOCR={pd_score}), 已LLM重建但建议人工校对"
                                            logger.warning(f"LLM reconstruction — quality warning set (A={score_a},B={score_b},C={pd_score})")
                                        elif pd_score >= max(score_a, score_b):
                                            final_path = paddleocr_path
                                            self._upload_state["engine"] = "paddleocr"
                                            logger.info("PaddleOCR selected as best of three")
                                except Exception as e:
                                    logger.warning(f"PaddleOCR/LLM reconstruction chain failed: {e}")
                            elif score_b > score_a and mineru_path:
                                logger.info(f"MinerU scored higher (B={score_b} > A={score_a}) — swapping")
                                final_path = mineru_path
                                self._upload_state["engine"] = "mineru"
                    except Exception as e:
                        logger.warning(f"LLM arbitration failed, keeping Docling: {e}")
                else:
                    # ── CJK quality spot-check (even when divergence ≤30%) ──
                    # Docling is known weaker on Chinese. Check for CJK artifacts.
                    dl_sample = [t.get("text", "")[:300] for t in dl_texts[:5]]
                    mu_sample = [t.get("text", "")[:300] for t in mu_texts[:5]]
                    dl_cjk_issues = 0
                    mu_cjk_issues = 0
                    for text in dl_sample:
                        cjk_chars = sum(1 for c in text if '一' <= c <= '鿿')
                        if cjk_chars > 10:
                            # Check for isolated CJK chars (space between each char = Docling artifact)
                            cjk_spaced = sum(1 for i in range(1, len(text)-1)
                                           if '一' <= text[i] <= '鿿'
                                           and text[i-1] == ' ' and text[i+1] == ' ')
                            if cjk_spaced > cjk_chars * 0.3:
                                dl_cjk_issues += 1
                    for text in mu_sample:
                        cjk_chars = sum(1 for c in text if '一' <= c <= '鿿')
                        if cjk_chars > 10:
                            cjk_spaced = sum(1 for i in range(1, len(text)-1)
                                           if '一' <= text[i] <= '鿿'
                                           and text[i-1] == ' ' and text[i+1] == ' ')
                            if cjk_spaced > cjk_chars * 0.3:
                                mu_cjk_issues += 1
                    if dl_cjk_issues > mu_cjk_issues and mineru_path:
                        logger.info(f"CJK quality: Docling has {dl_cjk_issues} artifact samples vs MinerU {mu_cjk_issues} — swapping to MinerU")
                        final_path = mineru_path
                        self._upload_state["engine"] = "mineru"
            except Exception:
                pass

        # ── Post-processing quality layer ──
        try:
            final_path = self._postprocess_content_list(final_path)
        except Exception as e:
            logger.warning(f"Post-processing failed, using raw output: {e}")

        self._upload_state["state"] = "done"
        return final_path

    def _parse_local_docling(self, pdf_path: str) -> str | None:
        """Parse PDF locally using RAG-Anything's built-in Docling parser.
        Returns path to saved content_list.json in content_dir."""
        from raganything.parser import Parser
        from raganything.config import RAGAnythingConfig
        import shutil

        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            logger.error(f"PDF not found: {pdf_path}")
            return None

        doc_name = pdf_path.stem
        out_path = self.content_dir / f"{doc_name}_content_list.json"

        try:
            config = RAGAnythingConfig(parser="docling", parse_method="auto")
            parser = Parser(config)
            result = parser.parse_pdf(str(pdf_path))
            if not result or not result.get("content_list"):
                logger.warning("Docling returned empty content_list")
                return None

            content_list = result["content_list"]
            # Save to content_dir
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(content_list, f, ensure_ascii=False, indent=2)
            logger.info(f"PDF parsed successfully (Docling local): {out_path} ({len(content_list)} items)")
            return str(out_path)
        except Exception as e:
            logger.warning(f"Docling local parse failed: {e}")
            return None

    def _postprocess_content_list(self, content_list_path: str) -> str:
        """Quality post-processing on parsed content_list:
        1. OCR artifact cleanup
        2. Smart element merging (caption+body, short consecutive texts)
        3. HTML table serialization via Baidu Flash LLM
        Returns path to processed content_list (overwrites original)."""
        path = Path(content_list_path)
        with open(path, encoding="utf-8") as f:
            data = json.load(f)

        cleaned = 0
        merged = 0
        serialized = 0

        # ── Layer 1: OCR artifact cleanup (独立 try, 失败不影响后续) ──
        try:
            import re
            ocr_patterns = [
                (r'/zero\.pl\.tnum', '0'), (r'/one\.case', '1'),
                (r'glyph&lt;\d+&gt;', ''), (r'/A\.cap\s*', 'A'),
                (r'\\u[0-9a-fA-F]{4}', ''), (r'\x00', ''), (r'�+', ''),
            ]
            for item in data:
                if item.get("type") == "text" and "text" in item:
                    original = item["text"]
                    for pattern, replacement in ocr_patterns:
                        item["text"] = re.sub(pattern, replacement, item["text"])
                    if item["text"] != original:
                        cleaned += 1
        except Exception as e:
            logger.warning(f"Layer 1 (OCR cleanup) failed, continuing: {e}")

        # ── Layer 2: Smart element merging (独立 try, 失败用原始数据) ──
        try:
            merged_data = []
            i = 0
            while i < len(data):
                item = data[i]
                if (item.get("type") == "text" and "table_caption" not in str(item)
                        and i + 1 < len(data) and data[i + 1].get("type") == "table"
                        and len(item.get("text", "")) < 300):
                    next_item = data[i + 1]
                    merged_item = {
                        "type": "table",
                        "text": f"[表] {item.get('text', '')}\n{next_item.get('table_body', '')}",
                        "page_idx": item.get("page_idx", next_item.get("page_idx", 0)),
                        "table_caption": item.get("text", ""),
                        "table_body": next_item.get("table_body", ""),
                    }
                    merged_data.append(merged_item)
                    i += 2; merged += 1; continue
                if (item.get("type") == "text" and i + 1 < len(data)
                        and data[i + 1].get("type") == "text"
                        and item.get("page_idx") == data[i + 1].get("page_idx")
                        and len(item.get("text", "")) < 80):
                    next_item = data[i + 1]
                    item["text"] = item.get("text", "") + " " + next_item.get("text", "")
                    item["_merged"] = True
                    merged_data.append(item)
                    i += 2; merged += 1; continue
                merged_data.append(item)
                i += 1
            data = merged_data
        except Exception as e:
            logger.warning(f"Layer 2 (element merging) failed, keeping original: {e}")

        # ── Layer 3: HTML table serialization (Baidu Flash) ──
        for item in data:
            if item.get("type") == "table" and item.get("table_body"):
                html = item["table_body"]
                caption = item.get("table_caption", "")
                if len(html) < 50:
                    continue
                try:
                    client = self.clients.get("baidu_pro")
                    model = PROVIDERS.get("baidu_pro", {}).get("model", "deepseek-v4-pro")
                    if client:
                        prompt = f"""将此HTML医学表格转化为自包含的连贯段落。保留所有数值、单位、统计学指标。
说明表头层级关系。合并单元格明确标注跨行/跨列范围。

表格标题: {caption}
HTML表格:
{html[:3000]}

输出纯文本段落（不要markdown格式）:"""
                        resp = client.chat.completions.create(
                            model=model,
                            messages=[{"role": "user", "content": prompt}],
                            temperature=0.2, max_tokens=600, timeout=30.0,
                        )
                        serialized_text = resp.choices[0].message.content.strip()
                        item["text"] = f"[表格序列化] {serialized_text}"
                        item["_serialized"] = True
                        item["_original_html"] = html[:500]
                        serialized += 1
                        logger.info(f"Table serialized: {len(html)} chars HTML → {len(serialized_text)} chars text")
                except Exception as e:
                    logger.warning(f"Table serialization failed, keeping original: {e}")
                    item["text"] = f"[表] {caption}\n{html[:500]}"

        # ── Layer 3b: Image-based table serialization (VLM extraction → Flash) ──
        for item in data:
            is_img_table = (item.get("type") in ("image", "chart")
                            and item.get("_vlm_result")
                            and item["_vlm_result"].get("chart_type") in ("baseline_table", "outcome_table")
                            and item["_vlm_result"].get("_vlm_analyzed"))
            if not is_img_table:
                continue
            try:
                vlm = item["_vlm_result"]
                chart_type = vlm.get("chart_type", "table")
                # Build pseudo-HTML from VLM structured data for Flash
                rows_html = ""
                if chart_type == "baseline_table" and vlm.get("characteristics"):
                    rows_html = "<table><tr><th>变量</th><th>组1</th><th>组2</th><th>p值</th></tr>"
                    for c in vlm.get("characteristics", [])[:20]:
                        rows_html += f"<tr><td>{c.get('variable','')}</td><td>{c.get('group1_value','')}</td><td>{c.get('group2_value','')}</td><td>{c.get('p_value','')}</td></tr>"
                    rows_html += "</table>"
                elif chart_type == "outcome_table" and vlm.get("outcomes"):
                    rows_html = "<table><tr><th>结局</th><th>效应量</th><th>95%CI</th><th>p值</th></tr>"
                    for o in vlm.get("outcomes", [])[:20]:
                        rows_html += f"<tr><td>{o.get('outcome_name','')}</td><td>{o.get('effect_measure','')} {o.get('effect_value','')}</td><td>{o.get('ci_lower','')}-{o.get('ci_upper','')}</td><td>{o.get('p_value','')}</td></tr>"
                    rows_html += "</table>"
                if rows_html:
                    client = self.clients.get("baidu_pro")
                    model = PROVIDERS.get("baidu_pro", {}).get("model", "deepseek-v4-pro")
                    if client:
                        prompt = f"""将此医学表格转化为自包含连贯段落。保留所有数值、单位、统计学指标。

表格来源: VLM从图片提取的{chart_type}
{vlm.get('summary','')}

HTML数据:
{rows_html}

输出纯文本段落:"""
                        resp = client.chat.completions.create(
                            model=model,
                            messages=[{"role": "user", "content": prompt}],
                            temperature=0.2, max_tokens=500, timeout=30.0,
                        )
                        item["text"] = f"[图表序列化] {resp.choices[0].message.content.strip()}"
                        item["_serialized"] = True
                        item["_source"] = "vlm+flash"
                        serialized += 1
                        logger.info(f"Image table serialized: {chart_type} → text")
            except Exception as e:
                logger.warning(f"Image table serialization failed: {e}")

        # Save processed
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        logger.info(f"Post-processed {path.name}: {cleaned} cleaned, {merged} merged, {serialized} tables serialized")
        return str(path)

    def _rebuild_faiss_index(self):
        """Rebuild FAISS index from current all_chunks with fresh ID assignment."""
        import faiss
        if not self.all_chunks:
            self.faiss_index = None
            self._chunk_faiss_id.clear()
            self._faiss_id_to_chunk.clear()
            return
        logger.info(f"Rebuilding FAISS index from {len(self.all_chunks)} chunks...")
        embs = self.encode(self.all_chunks, show_progress=True)
        base_index = faiss.IndexFlatIP(self._embed_dim)
        self.faiss_index = faiss.IndexIDMap(base_index)
        ids = np.arange(self._next_faiss_id, self._next_faiss_id + len(self.all_chunks), dtype=np.int64)
        self._next_faiss_id += len(self.all_chunks)
        self.faiss_index.add_with_ids(embs.astype(np.float32), ids)
        self._chunk_faiss_id = ids.tolist()
        self._faiss_id_to_chunk = {int(fid): idx for idx, fid in enumerate(self._chunk_faiss_id)}
        self.save_index()
        logger.info(f"FAISS index rebuilt: {self.faiss_index.ntotal} vectors")

    def _snapshot_lists(self) -> dict:
        """Snapshot mutable state for rollback on failure."""
        return {
            "all_chunks": list(self.all_chunks),
            "sources": list(self.sources),
            "chunk_meta": list(self.chunk_meta),
            "chunk_faiss_id": list(self._chunk_faiss_id),
            "seen_hashes": set(self._seen_hashes),
            "doc_map": {k: list(v) for k, v in self._doc_map.items()},
            "faiss_id_to_chunk": dict(self._faiss_id_to_chunk),
            "next_faiss_id": self._next_faiss_id,
        }

    def _restore_lists(self, snap: dict):
        """Restore state from snapshot after a failed operation."""
        self.all_chunks = snap["all_chunks"]
        self.sources = snap["sources"]
        self.chunk_meta = snap["chunk_meta"]
        self._chunk_faiss_id = snap["chunk_faiss_id"]
        self._seen_hashes = snap["seen_hashes"]
        self._doc_map = snap["doc_map"]
        self._faiss_id_to_chunk = snap["faiss_id_to_chunk"]
        self._next_faiss_id = snap["next_faiss_id"]

    def _remove_document_chunks(self, doc_name: str) -> int:
        """Remove all chunks belonging to doc_name. Uses FAISS remove_ids (no rebuild).
        Snapshot-based rollback on any failure."""
        if doc_name not in self._doc_map:
            return 0
        old_indices = set(self._doc_map[doc_name])
        if not old_indices:
            return 0

        snap = self._snapshot_lists()
        try:
            removed = len(old_indices)
            stale_faiss_ids = [self._chunk_faiss_id[i] for i in old_indices]
            # FAISS operation first (most likely to fail)
            if self.faiss_index is not None and stale_faiss_ids:
                self.faiss_index.remove_ids(np.array(stale_faiss_ids, dtype=np.int64))
            # Remove from ID mappings
            for fid in stale_faiss_ids:
                self._faiss_id_to_chunk.pop(fid, None)
            # Remove from lists (reverse order for safe deletion)
            for idx in sorted(old_indices, reverse=True):
                h = hashlib.md5(self.all_chunks[idx].encode()).hexdigest()
                self._seen_hashes.discard(h)
                del self.all_chunks[idx]
                del self.sources[idx]
                del self.chunk_meta[idx]
                del self._chunk_faiss_id[idx]
            del self._doc_map[doc_name]
            # Re-index doc_map
            for name, indices in self._doc_map.items():
                new_indices = [i - sum(1 for oi in old_indices if oi < i) for i in indices]
                self._doc_map[name] = new_indices
            # Rebuild reverse mapping
            self._faiss_id_to_chunk = {self._chunk_faiss_id[i]: i for i in range(len(self._chunk_faiss_id))}
            self.doc_count = len(self._doc_map)
            logger.info(f"Removed document '{doc_name}': {removed} chunks via remove_ids, 0 rebuild")
            return removed
        except Exception as e:
            self._restore_lists(snap)
            logger.error(f"Failed to remove document '{doc_name}', rolled back: {e}")
            raise

    def add_parsed_document(self, content_list_path: str, replace_existing: bool = True) -> int:
        """
        Load a content_list JSON, append new chunks to the FAISS index.

        Smart diff on document update: only removes chunks whose content changed.
        If 80/87 chunks are identical, only 7 get removed from FAISS + 7 added.
        Returns the number of genuinely new chunks added.
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
        is_update = doc_name in self._doc_map
        self._upload_state["is_update"] = is_update
        self._upload_state["replaced_doc"] = doc_name if is_update else None

        # ── Phase 1: extract candidate chunks from new content ──
        candidates: List[Tuple[str, str, Dict, str]] = []  # (text, source_fmt, meta, md5)
        new_hashes: set = set()

        for item in data:
            t = item.get("type", "text")
            if t == "text":
                text = item.get("text", "").strip()
                if text and len(text) > 30:
                    h = hashlib.md5(text.encode()).hexdigest()
                    candidates.append((text,
                        f"{doc_name} [p.{item.get('page_idx', '?')}]",
                        {"type": "text", "page_idx": item.get("page_idx", 0), "doc_name": doc_name},
                        h))
                    new_hashes.add(h)
            elif t in ("image", "chart"):
                captions = item.get("image_caption", [])
                cap = " ".join(captions) if captions else ""
                if cap and len(cap) > 20:
                    img_path = item.get("img_path", "")
                    vlm_result = self._analyze_chart_image(img_path, cap) if img_path else None
                    if vlm_result:
                        kw_map = {"flowchart":"流程图 图表 图 诊断", "classification_diagram":"分型 分类 示意图 图表 图",
                                  "baseline_table":"基线 表格 表", "outcome_table":"结局 表格 表",
                                  "forest_plot":"森林图 图表 图", "km_curve":"生存曲线 图表 图"}
                        chart_type = vlm_result.get('chart_type','?')
                        keywords = kw_map.get(chart_type, "图表 图 表格")
                        text = f"[图表-VLM分析] {keywords} 类型:{chart_type}\n{vlm_result.get('summary','')}\n{vlm_result.get('description','')}"
                        if chart_type in ("baseline_table", "outcome_table") and vlm_result.get("_vlm_analyzed"):
                            text = self._serialize_vlm_table(vlm_result, chart_type, text)
                    else:
                        text = f"[图片] {cap}"
                    h = hashlib.md5(text.encode()).hexdigest()
                    candidates.append((text,
                        f"{doc_name} [p.{item.get('page_idx', '?')}, image]",
                        {"type": "image", "page_idx": item.get("page_idx", 0), "doc_name": doc_name,
                         "vlm_analyzed": bool(vlm_result)},
                        h))
                    new_hashes.add(h)
            elif t == "table":
                body = item.get("table_body", "")
                if not body or not body.strip():
                    continue  # 空表格: 无结构化数据可索引
                cap = " ".join(item.get("table_caption", []))
                text = f"[表格] {cap}\n{body}" if body else f"[表格] {cap}"
                if len(text) > 30:
                    h = hashlib.md5(text.encode()).hexdigest()
                    candidates.append((text,
                        f"{doc_name} [p.{item.get('page_idx', '?')}, table]",
                        {"type": "table", "page_idx": item.get("page_idx", 0), "doc_name": doc_name},
                        h))
                    new_hashes.add(h)

        # ── Phase 2: MD5 exact diff (precision 100%, zero pollution) ──
        # MD5 guarantees content integrity: two chunks either are byte-for-byte
        # identical (same MD5 → kept) or they differ (different MD5 → replaced).
        # No heuristic threshold, no false positives, no knowledge pollution.
        stale_removed = 0
        kept_count = 0

        if is_update and replace_existing:
            old_indices = self._doc_map.get(doc_name, [])
            old_hash_to_idx = {}
            for idx in old_indices:
                h = hashlib.md5(self.all_chunks[idx].encode()).hexdigest()
                old_hash_to_idx[h] = idx

            matched_old = set()
            matched_new = set()

            for ci, (c_text, _, _, c_hash) in enumerate(candidates):
                old_idx = old_hash_to_idx.get(c_hash)
                if old_idx is not None and old_idx not in matched_old:
                    matched_old.add(old_idx)
                    matched_new.add(ci)

            kept_count = len(matched_old)
            stale_indices = [idx for idx in old_indices if idx not in matched_old]

            # Remove matched hashes so Phase 3 doesn't re-add identical content
            for ci in matched_new:
                new_hashes.discard(candidates[ci][3])

            if stale_indices:
                snap = self._snapshot_lists()
                try:
                    stale_faiss_ids = [self._chunk_faiss_id[i] for i in stale_indices]
                    if self.faiss_index is not None and stale_faiss_ids:
                        self.faiss_index.remove_ids(np.array(stale_faiss_ids, dtype=np.int64))
                    for fid in stale_faiss_ids:
                        self._faiss_id_to_chunk.pop(fid, None)
                    stale_set = set(stale_indices)
                    for idx in sorted(stale_indices, reverse=True):
                        old_h = hashlib.md5(self.all_chunks[idx].encode()).hexdigest()
                        self._seen_hashes.discard(old_h)
                        del self.all_chunks[idx]
                        del self.sources[idx]
                        del self.chunk_meta[idx]
                        del self._chunk_faiss_id[idx]
                    for name, indices in self._doc_map.items():
                        self._doc_map[name] = [i - sum(1 for si in stale_set if si < i) for i in indices]
                    self._faiss_id_to_chunk = {self._chunk_faiss_id[i]: i for i in range(len(self._chunk_faiss_id))}
                    stale_removed = len(stale_indices)
                    self._lightrag_dirty = True
                    logger.info(f"MD5 update '{doc_name}': {stale_removed} stale via remove_ids, "
                                f"{kept_count} unchanged, 0 FAISS rebuild, LightRAG marked dirty")
                except Exception as e:
                    self._restore_lists(snap)
                    logger.error(f"Stale removal failed for '{doc_name}', rolled back: {e}")
                    raise
            else:
                logger.info(f"MD5 update '{doc_name}': all {kept_count} chunks unchanged, "
                            f"0 FAISS operations")

        # ── Phase 3: add genuinely new chunks ──
        _pre_start = len(self.all_chunks)
        new_chunks: List[str] = []
        new_sources: List[str] = []
        new_meta: List[Dict] = []

        for text, source_fmt, meta, h in candidates:
            if h in self._seen_hashes:
                continue
            # Quality gate: skip garbage chunks
            if len(text) < 30:
                continue
            non_alpha = sum(1 for c in text if c.isascii() and not c.isalnum() and c not in ' .,;:!?()-[]{}%/=<>±')
            if len(text) > 0 and non_alpha / len(text) > 0.5:
                logger.info(f"Skipping garbage chunk ({non_alpha}/{len(text)} noise): {text[:80]}")
                continue
            self._seen_hashes.add(h)
            new_chunks.append(text)
            new_sources.append(source_fmt)
            new_meta.append(meta)

        if not new_chunks:
            # If doc was updated and all chunks unchanged, keep old doc_map entry
            if is_update and replace_existing and stale_removed == 0:
                # All old chunks still valid, doc_map entry stays
                self._upload_state["state"] = "done"
                self._upload_state["chunks_added"] = 0
                return 0
            # If doc was replaced but no new content
            if is_update and replace_existing and stale_removed > 0:
                # Old stale chunks removed, but no new content — doc effectively removed
                if doc_name in self._doc_map:
                    del self._doc_map[doc_name]
                self.doc_count = len(self._doc_map)
                self.save_index()
                self._upload_state["state"] = "done"
                self._upload_state["chunks_added"] = 0
                logger.info(f"Document '{doc_name}' fully removed (old stale, nothing new)")
                return 0
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

        # ─── Global semantic merge on new document ───
        try:
            client = self.clients.get("baidu_pro")
            model = PROVIDERS.get("baidu_pro", {}).get("model", "deepseek-v4-pro")
            if client and len(new_chunks) > 1:
                merged_c, merged_s, merged_m = self._chunker.global_merge_chunks(
                    self.all_chunks, self.sources, self.chunk_meta,
                    llm_client=client, llm_model=model,
                )
                self.all_chunks = merged_c
                self.sources = merged_s
                self.chunk_meta = merged_m
                # Rebuild _doc_map and _seen_hashes after merge
                self._doc_map.clear()
                self._seen_hashes.clear()
                for idx, src in enumerate(self.sources):
                    doc = src.split(" [p.")[0]
                    self._doc_map.setdefault(doc, []).append(idx)
                    self._seen_hashes.add(hashlib.md5(self.all_chunks[idx].encode()).hexdigest())
                self.doc_count = len(self._doc_map)
        except Exception as e:
            logger.warning(f"Semantic merge failed for new doc, continuing: {e}")

        # Record which chunks belong to this document
        if is_update and replace_existing:
            # Merge with any kept indices
            if doc_name in self._doc_map:
                self._doc_map[doc_name].extend(range(_pre_start, len(self.all_chunks)))
            else:
                self._doc_map[doc_name] = list(range(_pre_start, len(self.all_chunks)))
        else:
            self._doc_map[doc_name] = list(range(_pre_start, len(self.all_chunks)))

        # Add to FAISS index incrementally with stable IDs (rollback-protected)
        if self.faiss_index is not None:
            snap3 = self._snapshot_lists()
            try:
                import faiss
                logger.info(f"Encoding {len(new_chunks)} new chunks for incremental add_with_ids...")
                new_embeddings = self.encode(new_chunks, show_progress=False)
                new_ids = np.arange(self._next_faiss_id, self._next_faiss_id + len(new_chunks), dtype=np.int64)
                self._next_faiss_id += len(new_chunks)
                self.faiss_index.add_with_ids(new_embeddings.astype(np.float32), new_ids)
                self._chunk_faiss_id.extend(new_ids.tolist())
                self._faiss_id_to_chunk.update({int(fid): _pre_start + i for i, fid in enumerate(new_ids)})
                logger.info(f"FAISS index: {self.faiss_index.ntotal} vectors (+{len(new_chunks)} via add_with_ids)")
            except Exception as e:
                self._restore_lists(snap3)
                logger.error(f"FAISS add_with_ids failed, rolled back: {e}")
                raise

        self.doc_count = len(self._doc_map)

        self._upload_state["chunks_added"] = len(new_chunks)
        self._upload_state["state"] = "done"
        self._upload_state["filename"] = str(content_list_path)

        # Persist updated index
        self.save_index()

        if is_update:
            logger.info(f"MD5 update '{doc_name}': +{len(new_chunks)} new, "
                        f"-{stale_removed} stale, {kept_count} unchanged")
        else:
            logger.info(f"Added {len(new_chunks)} chunks from {doc_name} (new document)")
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
