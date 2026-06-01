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
    "deepseek_official": {
        "base_url": os.getenv("DEEPSEEK_OFFICIAL_BASE_URL"),
        "api_key": os.getenv("DEEPSEEK_OFFICIAL_API_KEY"),
        "model": os.getenv("DEEPSEEK_OFFICIAL_MODEL", "deepseek-chat"),
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
        self.resilience_deepseek = APIResilience(self.clients["deepseek_official"])

        # ─── 父页面检索缓存 ───
        self._page_texts: Dict[str, Dict[int, str]] = {}  # {doc_name: {page_idx: full_text}}

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
        实体提取专用: DeepSeek官方API 主 → 百度Flash 兜底
        timeout=120s, max_tokens=400
        """
        # 主引擎: DeepSeek官方 API (不限流)
        result = self.resilience_deepseek.call_text_sync(
            prompt, system_prompt, model=PROVIDERS["deepseek_official"]["model"],
            timeout=120.0, max_tokens=400,
        )
        if result.success and result.data and len(result.data.strip()) > 10:
            return result.data
        if not result.success:
            logger.warning(f"DeepSeek官方 entity extract failed: {result.error[:120] if result.error else 'unknown'}")

        # 兜底: 百度 DeepSeek-V4-Flash
        result = self.resilience_baidu_flash.call_text_sync(
            prompt, system_prompt, model=PROVIDERS["baidu_flash"]["model"],
            timeout=90.0, max_tokens=400,
        )
        if result.success and result.data and len(result.data.strip()) > 10:
            return result.data
        logger.error(f"所有实体提取引擎均失败: {result.error[:120] if result.error else 'unknown'}")
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
            # Load page texts for parent-page retrieval (graceful: skip if not found)
            try:
                pages_file = self.content_dir / f'{doc_name}_pages.json'
                if pages_file.exists() and doc_name not in self._page_texts:
                    pages = json.loads(pages_file.read_text(encoding='utf-8'))
                    self._page_texts[doc_name] = {i: t for i, t in enumerate(pages)}
            except Exception:
                pass
            # Cross-engine dedup: skip mineru_* if the original (non-prefixed) exists
            if doc_name.startswith("mineru_"):
                original_name = doc_name.replace("mineru_", "", 1)
                original_file = self.content_dir / f"{original_name}_content_list.json"
                if original_file.exists():
                    logger.info(f"Skipping cross-engine duplicate: {f.name} (original {original_file.name} exists)")
                    continue
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
                        if chart_type in ("baseline_table", "outcome_table") and vlm_result.get("_vlm_analyzed"):
                            text = self._serialize_vlm_table(vlm_result, chart_type, text)
                    elif cap and len(cap) > 10:
                        text = f"[图片] {cap}"
                    else:
                        continue  # 无VLM结果且无有效标题 → 不可检索
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
                    if isinstance(body, dict):
                        body = self._table_dict_to_html(body)
                    if not body or (isinstance(body, str) and not body.strip()):
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
                model=model, temperature=0.1, max_tokens=30, timeout=20.0,
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
                temperature=0.3, max_tokens=800, timeout=30.0,
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

    def _get_doc_list(self) -> List[str]:
        """Extract unique document names from sources."""
        return sorted(set(s.split(" [p.")[0] for s in self.sources if " [p." in s))

    def _classify_query_to_docs(self, query: str) -> List[str]:
        """Use LLM with few-shot examples to classify which documents are relevant."""
        doc_list = self._get_doc_list()
        if len(doc_list) <= 1:
            return doc_list

        doc_names = "\n".join(f"- {d}" for d in doc_list)

        prompt = f"""你是一个医学文献检索分类器。根据用户查询，判断应从哪些文档中检索。
只输出匹配的文档名称（可多个，用分号分隔），不确定则输出 "ALL"。

可用文档：
{doc_names}

Few-shot 示例：
查询：Stanford B型主动脉夹层的治疗
输出：Stanford+B+型主动脉夹层诊断和治疗中国专家共识（2022版）(1)

查询：肠道DIE的印第安头饰征在超声上呈什么形态？为什么DIE很少累及肠黏膜层？
输出：子宫内膜异位症超声评估中国专家共识

查询：子宫内膜异位症的超声评估方法
输出：子宫内膜异位症超声评估中国专家共识

查询：丙酸血症的肝移植治疗
输出：shchelochkov2019;todo1992

查询：尿素循环酶缺陷与肝移植
输出：todo1992

查询：主动脉夹层腔内修复术的适应证
输出：Stanford+B+型主动脉夹层诊断和治疗中国专家共识（2022版）(1)

查询：COVID-19疫苗的免疫原性
输出：covid_vaccine_rct_2023

现在判断以下查询应检索哪些文档：{query}"""

        try:
            result = self.resilience_deepseek.call_text_sync(
                prompt, "你是医学文献检索分类器。只输出文档名称，用分号分隔。",
                model=PROVIDERS["deepseek_official"]["model"],
                timeout=10.0, max_tokens=200,
            )
            if result.success and result.data:
                classified = [d.strip() for d in result.data.strip().split(";")]
                matched = [d for d in classified if d in doc_list]
                if matched:
                    logger.info(f"Query classified to docs: {matched}")
                    return matched
        except Exception as e:
            logger.warning(f"Doc classification failed, falling back to ALL: {e}")

        return []  # empty = use ALL docs, no filtering

    def _doc_aware_retrieve(self, query: str, top_k: int = 10, min_score: float = 0.3) -> List[Dict]:
        """LLM-classified document-aware retrieval with few-shot examples."""
        results = self._faiss_retrieve(query, top_k=max(top_k * 2, 20), min_score=0.2)
        if not results:
            return []

        target_docs = self._classify_query_to_docs(query)

        if target_docs and len(target_docs) > 0:
            for r in results:
                r_doc = r["source"].split(" [p.")[0]
                if any(td in r_doc or r_doc in td for td in target_docs):
                    r["score"] = min(1.0, r["score"] * 1.3)
                else:
                    r["score"] = r["score"] * 0.01  # 99% penalty for non-matching docs
            results.sort(key=lambda x: x["score"], reverse=True)

            # Strict filter: when classification is clear, only keep target docs
            top_doc = results[0]["source"].split(" [p.")[0]
            results = [r for r in results if r["source"].split(" [p.")[0] == top_doc]

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
        async def vision_model_func(prompt, system_prompt=None, history_messages=[],
                                     image_data=None, messages=None, **kwargs):
            client = self.clients["moonshot_vision"]
            model = PROVIDERS["moonshot_vision"]["model"]

            if messages:
                resp = await asyncio.to_thread(
                    lambda: client.chat.completions.create(
                        model=model, messages=messages,
                        temperature=0.3, max_tokens=600, timeout=30.0,
                    )
                )
                return resp.choices[0].message.content

            if image_data:
                resp = await asyncio.to_thread(
                    lambda: client.chat.completions.create(
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
                        temperature=0.3, max_tokens=600, timeout=30.0,
                    )
                )
                return resp.choices[0].message.content

            # 纯文本回退
            return await llm_model_func(prompt, system_prompt, history_messages, **kwargs)

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

    def _load_persisted_md5s(self) -> dict:
        """Load persisted document content hashes for dedup."""
        md5_file = Path(self.lightrag_working_dir) / "_doc_md5s.json"
        if not md5_file.exists():
            return {}
        try:
            import json as _json
            return _json.loads(md5_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_persisted_md5s(self) -> None:
        """Persist current document content hashes for future dedup."""
        import json as _json
        from hashlib import md5 as _md5
        md5_file = Path(self.lightrag_working_dir) / "_doc_md5s.json"
        new_md5s = {}
        for f in sorted(Path(self.content_dir).glob("*_content_list.json")):
            try:
                with open(f, encoding="utf-8") as fh:
                    data = _json.load(fh)
                texts = [it.get("text","").strip() for it in data
                         if it.get("type")=="text" and it.get("text","").strip()]
                if texts:
                    new_md5s[f.name] = _md5("\n\n".join(texts).encode()).hexdigest()
            except Exception:
                pass
        md5_file.parent.mkdir(parents=True, exist_ok=True)
        md5_file.write_text(_json.dumps(new_md5s, ensure_ascii=False), encoding="utf-8")

    async def _lightrag_reset_and_rebuild(self):
        """Atomic LightRAG rebuild: backup → rebuild → replace on success.
        On failure, restore backup and clear dirty flag."""
        import shutil
        wd = Path(self.lightrag_working_dir)
        backup_dir = wd.parent / f"{wd.name}_backup"

        # Atomic: move old storage to backup, not delete
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        if wd.exists():
            shutil.move(str(wd), str(backup_dir))
            wd.mkdir(parents=True, exist_ok=True)
            # Restore MD5 file to new dir so incremental inserts see existing hashes
            old_md5 = backup_dir / "_doc_md5s.json"
            if old_md5.exists():
                shutil.copy2(str(old_md5), str(wd / "_doc_md5s.json"))

        try:
            self._lightrag = None
            self._lightrag_ready = False
            rag = self._init_lightrag()
            await rag._ensure_lightrag_initialized()
            inserted = await self._lightrag_insert_documents()
            self._lightrag_ready = True
            self._lightrag_dirty = False
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

    async def _lightrag_insert_documents(self, content_dir: str = None) -> bool:
        """Insert/re-sync documents into LightRAG. Skips unchanged docs via MD5 dedup.
        Auto-loads persisted hashes from _doc_md5s.json and saves after insert."""
        try:
            rag = self._init_lightrag()
            await rag._ensure_lightrag_initialized()
            cdir = Path(content_dir or self.content_dir)

            # Always load persisted hashes — not just during rebuild
            persisted_md5s = self._load_persisted_md5s()
            lightrag_seen_hashes = set(persisted_md5s.values())
            if lightrag_seen_hashes:
                logger.info(f"LightRAG dedup: loaded {len(persisted_md5s)} persisted doc hashes")

            inserted = 0
            for f in sorted(cdir.glob("*_content_list.json")):
                try:
                    with open(f, encoding="utf-8") as fh:
                        data = json.load(fh)

                    if not data:
                        continue

                    doc_name = f.name.replace("_content_list.json", "")

                    # Dedup: compute MD5 from all text content to skip unchanged docs
                    text_sample = "\n".join(
                        item.get("text", "") or ""
                        for item in data
                        if item.get("type") in ("text", "image", "chart", "table")
                    )
                    h = hashlib.md5(text_sample.encode()).hexdigest()
                    if h in lightrag_seen_hashes:
                        logger.info(f"LightRAG skipping duplicate: {doc_name}")
                        continue
                    lightrag_seen_hashes.add(h)

                    # Collect all content types for LightRAG entity extraction
                    text_entries = []
                    for item in data:
                        t = item.get("type", "text")
                        if t == "text":
                            txt = item.get("text", "").strip()
                            if txt:
                                text_entries.append(txt)
                        elif t in ("image", "chart"):
                            cap = " ".join(item.get("image_caption", [])) if item.get("image_caption") else ""
                            if cap:
                                text_entries.append(f"[图表标注] {cap}")
                        elif t == "table":
                            body = item.get("table_body", "")
                            if isinstance(body, dict):
                                body = self._table_dict_to_html(body)
                            cap = " ".join(item.get("table_caption", [])) if item.get("table_caption") else ""
                            parts = [p for p in [cap, body] if p]
                            if parts:
                                text_entries.append("[表格] " + "\n".join(parts))

                    if not text_entries:
                        continue

                    doc_name = f.name.replace("_content_list.json", "")

                    full_text = "\n\n".join(text_entries)
                    logger.info(f"LightRAG inserting: {doc_name} ({len(text_entries)} entries, {len(full_text)} chars)...")
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
                # Persist updated hashes so subsequent inserts skip processed docs
                self._save_persisted_md5s()
                logger.info(f"LightRAG: {inserted} new docs inserted, MD5s persisted")
                return True
            logger.info(f"LightRAG: all {len(persisted_md5s)} docs unchanged, nothing to insert")
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
        PDF parsing via MinerU 2.5-Pro (local GPU VLM).
        Replaces Docling + remote MinerU SSH. Single engine, SOTA quality.
        """
        pdf_path_obj = Path(pdf_path)

        self._upload_state = {
            "state": "parsing",
            "filename": str(pdf_path_obj.name),
            "error": None,
            "chunks_added": 0,
            "is_update": False,
            "replaced_doc": None,
            "engine": "mineru25pro",
        }

        try:
            from src.mineru25pro_parser import parse_pdf_25pro
            final_path = parse_pdf_25pro(
                str(pdf_path_obj),
                output_dir=str(self.content_dir),
                chunker=self._chunker if hasattr(self, '_chunker') else None,
                doc_name_override=pdf_path_obj.stem
            )

            if not final_path:
                self._upload_state["state"] = "error"
                self._upload_state["error"] = "MinerU 2.5-Pro parsing failed"
                return None

            self._upload_state["state"] = "done"
            return final_path

        except Exception as e:
            logger.error(f"MinerU 2.5-Pro parsing failed: {e}")
            self._upload_state["state"] = "error"
            self._upload_state["error"] = str(e)[:500]
            return None

    @staticmethod
    def _table_dict_to_html(tbl: dict) -> str:
        """Convert Docling structured table dict to HTML for backward compatibility."""
        cells = tbl.get("table_cells", [])
        n_rows = tbl.get("num_rows", 0)
        n_cols = tbl.get("num_cols", 0)
        if not cells or not n_rows:
            return ""
        # Build grid: cell -> (row, col, rowspan, colspan)
        grid = [["" for _ in range(n_cols)] for _ in range(n_rows)]
        for cell in cells:
            r = cell.get("row", 0)
            c = cell.get("col", 0)
            if 0 <= r < n_rows and 0 <= c < n_cols:
                grid[r][c] = cell.get("text", "")
        html = ["<table>"]
        for row in grid:
            html.append("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>")
        html.append("</table>")
        return "\n".join(html)

    def _parse_local_docling(self, pdf_path: str) -> str | None:
        """Parse PDF locally using RAG-Anything's built-in Docling parser.
        Returns path to saved content_list.json in content_dir.
        Persists extracted images to content_dir/images/ for VLM analysis."""
        import shutil, glob as _glob

        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            logger.error(f"PDF not found: {pdf_path}")
            return None

        doc_name = pdf_path.stem
        out_path = self.content_dir / f"{doc_name}_content_list.json"
        images_dir = self.content_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)

        try:
            from raganything.parser import DoclingParser
            parser = DoclingParser()
            # Pass output_dir so Docling saves images to a persistent location
            content_list = parser.parse_pdf(str(pdf_path), output_dir=str(self.content_dir))
            if not content_list:
                logger.warning("Docling returned empty content_list")
                return None
            images_copied = 0

            # Copy extracted images to persistent images/ directory
            for item in content_list:
                img_path = item.get("img_path", "")
                if img_path and os.path.isfile(img_path):
                    img_name = os.path.basename(img_path)
                    dest = images_dir / img_name
                    if not dest.exists():
                        shutil.copy2(img_path, dest)
                        images_copied += 1
                    # Update to relative path from content_dir
                    item["img_path"] = str(dest)

            # Also scan Docling output dir for any images not referenced in content_list
            try:
                scan_dir = self.content_dir / f"{doc_name}_"
                for candidate in self.content_dir.iterdir():
                    if candidate.is_dir() and candidate.name.startswith(f"{doc_name}_"):
                        for img_file in candidate.rglob("*"):
                            if img_file.suffix.lower() in (".png", ".jpg", ".jpeg", ".bmp") and img_file.is_file():
                                dest = images_dir / img_file.name
                                if not dest.exists():
                                    shutil.copy2(img_file, dest)
                                    images_copied += 1
                        break
            except Exception:
                pass

            if images_copied:
                logger.info(f"Docling: copied {images_copied} images to {images_dir}")

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

    def get_page_text(self, doc_name: str, page_idx: int) -> str | None:
        """返回完整页面文本用于父页面检索。旧文档无 _pages.json 时返回 None。"""
        doc_pages = self._page_texts.get(doc_name, {})
        return doc_pages.get(page_idx)

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
        # Load page texts for parent-page retrieval
        try:
            pages_file = content_list_path.parent / f'{doc_name}_pages.json'
            if pages_file.exists() and doc_name not in self._page_texts:
                pages = json.loads(pages_file.read_text(encoding='utf-8'))
                self._page_texts[doc_name] = {i: t for i, t in enumerate(pages)}
        except Exception:
            pass
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
                elif cap and len(cap) > 10:
                    text = f"[图片] {cap}"
                else:
                    continue  # 无VLM结果且无有效标题 → 不可检索
                h = hashlib.md5(text.encode()).hexdigest()
                candidates.append((text,
                    f"{doc_name} [p.{item.get('page_idx', '?')}, image]",
                    {"type": "image", "page_idx": item.get("page_idx", 0), "doc_name": doc_name,
                     "vlm_analyzed": bool(vlm_result),
                     "img_path": img_path,
                     "image_url": f"/images/{os.path.basename(img_path)}" if img_path else None},
                    h))
                new_hashes.add(h)
            elif t == "table":
                body = item.get("table_body", "")
                if isinstance(body, dict):
                    body = self._table_dict_to_html(body)
                if not body or (isinstance(body, str) and not body.strip()):
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

        # ── Track image stats for upload task reporting ──
        img_candidates = [m for _, _, m, _ in candidates if m.get("type") == "image"]
        self._upload_state["images_total"] = len(img_candidates)
        self._upload_state["images_vlm"] = sum(1 for m in img_candidates if m.get("vlm_analyzed"))

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
            # ── Repetition filter: detect VLM generation loops ──
            words = text.lower().split()
            if len(words) > 30:
                from collections import Counter as _Counter
                wc = _Counter(words)
                top_word, top_count = wc.most_common(1)[0]
                # If a single word appears >30% of total words and >30 times = hallucination loop
                if top_count > 30 and top_count / len(words) > 0.3:
                    logger.warning(f"Repetition loop detected: word='{top_word}' count={top_count}/{len(words)}, skipping chunk")
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
        _merged = False
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
                _merged = True
        except Exception as e:
            logger.warning(f"Semantic merge failed for new doc, continuing: {e}")

        # Record which chunks belong to this document.
        # If merge ran, _doc_map was already rebuilt correctly → skip stale _pre_start logic.
        if not _merged:
            if is_update and replace_existing:
                if doc_name in self._doc_map:
                    self._doc_map[doc_name].extend(range(_pre_start, len(self.all_chunks)))
                else:
                    self._doc_map[doc_name] = list(range(_pre_start, len(self.all_chunks)))
            else:
                self._doc_map[doc_name] = list(range(_pre_start, len(self.all_chunks)))
        else:
            # After merge, _pre_start is stale. Recalculate for FAISS ID mapping.
            doc_indices = self._doc_map.get(doc_name, [])
            _pre_start = min(doc_indices) if doc_indices else len(self.all_chunks)

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
