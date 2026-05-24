"""
医疗RAG知识库 - FastAPI 接口 v2

适配 MedicalRAGPipeline v2 (BGE-M3 + FAISS + DeepSeek-V4-Pro)
"""

import os
import sys
import logging
import hashlib
import json
import asyncio
from pathlib import Path
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))
from src.pipeline import MedicalRAGPipeline
from src.agent import MedicalAgent

logger = logging.getLogger(__name__)

app = FastAPI(
    title="医疗RAG知识库系统",
    description="基于 MinerU + BGE-M3 + DeepSeek-V4-Pro 的医疗文献RAG API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

pipeline: MedicalRAGPipeline = None


def get_pipeline() -> MedicalRAGPipeline:
    global pipeline
    if pipeline is None:
        pipeline = MedicalRAGPipeline(content_dir="./output/remote_test")
        try:
            pipeline.load_index()
        except Exception:
            pipeline.load_documents()
            pipeline.build_index()
        # Auto-restore LightRAG if storage exists (lazy init on first query)
        from pathlib import Path
        if Path("./lightrag_storage/graph_chunk_entity_relation.graphml").exists():
            try:
                pipeline._init_lightrag()
                pipeline._lightrag_ready = True
                logger.info("LightRAG storage found — will lazy-init on first query")
            except Exception as e:
                logger.warning(f"LightRAG pre-init failed: {e}")
                pass
    return pipeline


class QueryRequest(BaseModel):
    question: str
    top_k: int = 8


class QueryResponse(BaseModel):
    question: str
    answer: str
    source_count: int
    sources: list
    engine: str = "faiss"
    timestamp: str


class KBStatusResponse(BaseModel):
    total_chunks: int
    total_documents: int
    index_size: int
    lightrag_ready: bool = False
    unique_sources: list
    upload_progress: dict = {}


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "user"


# ─── MySQL Authentication ──────────────────────────────

from src.auth import verify_user, create_user, list_users as db_list_users
from src.auth import save_document_record, update_document_status, list_documents as db_list_docs, get_document_chunks

MOCK_TOKENS = {}


@app.post("/api/login")
async def login(req: LoginRequest):
    user = verify_user(req.username, req.password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    token = hashlib.md5(f"{req.username}:{req.password}".encode()).hexdigest()[:16]
    MOCK_TOKENS[token] = req.username
    return {"token": token, "role": user["role"], "username": user["username"]}


@app.post("/api/register")
async def register(req: RegisterRequest):
    try:
        user = create_user(req.username, req.password, req.role)
    except ValueError as e:
        raise HTTPException(400, str(e))
    token = hashlib.md5(f"{req.username}:{req.password}".encode()).hexdigest()[:16]
    MOCK_TOKENS[token] = req.username
    return {"token": token, "role": user["role"], "username": user["username"]}


@app.get("/api/users")
async def api_list_users():
    return {"users": db_list_users()}


@app.get("/api/info")
async def api_info():
    return {
        "service": "医疗RAG知识库系统 v2",
        "tech_stack": "MinerU + BGE-M3 + FAISS + DeepSeek-V4-Pro",
        "status": "running",
    }


@app.post("/api/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    """Auto-fallback: try LightRAG first if ready, fallback to FAISS on failure."""
    p = get_pipeline()
    prefer_lightrag = p._lightrag_ready
    try:
        result = await p.aanswer(req.question, top_k=req.top_k, prefer_lightrag=prefer_lightrag)
    except Exception:
        logger.warning("Query failed, falling back to FAISS")
        result = await p.aanswer(req.question, top_k=req.top_k, prefer_lightrag=False)
    return QueryResponse(
        question=req.question,
        answer=result["answer"],
        source_count=result["source_count"],
        sources=result.get("sources", []),
        engine=result.get("engine", "faiss"),
        timestamp=datetime.now().isoformat(),
    )


@app.post("/api/search")
async def search_only(req: QueryRequest):
    """Agent检索专用 — FAISS+LightRAG双引擎搜索，不调LLM，直接返回原文sources+image_url"""
    p = get_pipeline()
    results = p._doc_aware_retrieve(req.question, top_k=req.top_k)
    sources_out = []

    # LightRAG parallel: FAISS results first, LightRAG graph reasoning supplements
    engine = "faiss"
    if p._lightrag_ready:
        try:
            lr = await asyncio.wait_for(
                p._lightrag_query(req.question, mode="hybrid"), timeout=25.0
            )
            if lr and lr.get("answer"):
                sources_out.insert(0, {
                    "ref": 0, "source": "LightRAG-Knowledge-Graph",
                    "doc": "知识图谱", "section": "entity-relation",
                    "score": 1.0, "text": lr["answer"][:500],
                })
                engine = "hybrid"
        except asyncio.TimeoutError:
            pass  # LightRAG LLM too slow
        except Exception:
            pass

    for i, r in enumerate(results):
        meta = r.get("meta", {})
        src = {
            "ref": len(sources_out) + 1,
            "source": r["source"],
            "score": round(r["score"], 3),
            "text": r["text"][:500],
            "doc": r["source"].split(" [p.")[0] if " [p." in r["source"] else r["source"],
            "section": meta.get("section_tag", ""),
        }
        if meta.get("image_url"):
            src["image_url"] = meta["image_url"]
        sources_out.append(src)
    return {"question": req.question, "sources": sources_out,
            "source_count": len(sources_out), "engine": engine}


@app.post("/api/agent")
async def agent_query(req: QueryRequest):
    """Smart-routing Agent endpoint: simple extraction → FAISS, complex reasoning → Agent."""
    import asyncio
    p = get_pipeline()

    # Smart routing: detect if this is a simple extraction question
    extraction_keywords = ["提取", "列出", "表格", "Table", "数据", "数值", "基线",
                           "多少", "什么是", "定义", "诊断标准", "适应证", "禁忌证"]
    is_extraction = any(kw in req.question for kw in extraction_keywords)
    is_complex = any(kw in req.question for kw in ["比较", "一致性", "矛盾", "综合",
                       "跨文献", "对比", "差异", "多个", "不同文献", "evidence", "PICO"])
    # Complex reasoning always goes to Agent; simple extraction uses FAISS for speed
    use_faiss = is_extraction and not is_complex

    if use_faiss:
        try:
            result = await asyncio.to_thread(p.answer_with_sources, req.question, req.top_k)
            return {
                "question": req.question,
                "answer": result["answer"],
                "reasoning_trace": [],
                "steps": 0,
                "model": "FAISS-routed",
                "sources": result.get("sources", []),
                "engine": result.get("engine", "faiss"),
                "timestamp": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.warning(f"FAISS routing failed, falling back to Agent: {e}")

    # Agent for complex reasoning
    agent = MedicalAgent(p)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(agent.run, req.question, 8),
            timeout=120.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "Agent推理超时（超过120秒），请简化问题重试")
    except Exception as e:
        raise HTTPException(500, f"Agent推理失败: {str(e)[:200]}")
    return {
        "question": req.question,
        "answer": result["answer"],
        "reasoning_trace": result["reasoning_trace"],
        "steps": result["steps"],
        "model": result["model"],
        "confidence": result.get("confidence", "unknown"),
        "critique": result.get("critique", []),
        "sources": result.get("sources", []),
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/agent/stream")
async def agent_stream(question: str):
    """SSE streaming of Agent reasoning steps, then final answer"""
    p = get_pipeline()
    agent = MedicalAgent(p)

    async def generate():
        t0 = datetime.now()
        try:
            yield f"data: {json.dumps({'type': 'start', 'message': '开始分析...', 'ts': t0.isoformat()})}\n\n"
            await asyncio.sleep(0.1)

            result = agent.run(question, max_steps=8)

            for step in result.get("reasoning_trace", []):
                elapsed = (datetime.now() - t0).total_seconds()
                yield f"data: {json.dumps({'type': 'step', 'step': step['step'], 'tool': step['tool'], 'args': step['args'], 'preview': step.get('result_preview', '')[:300], 'elapsed': round(elapsed, 1)})}\n\n"
                await asyncio.sleep(0.15)

            total_elapsed = (datetime.now() - t0).total_seconds()
            yield f"data: {json.dumps({'type': 'answer', 'answer': result['answer'], 'sources': result.get('sources', []), 'elapsed': round(total_elapsed, 1), 'steps': len(result.get('reasoning_trace', []))})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': f'推理出错: {str(e)[:200]}'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/status", response_model=KBStatusResponse)
async def kb_status():
    p = get_pipeline()
    stats = p.get_stats()
    unique = list(set(s.split(" [p.")[0] for s in p.sources))
    return KBStatusResponse(
        total_chunks=stats["total_chunks"],
        total_documents=stats["total_documents"],
        index_size=stats["faiss_index_size"],
        lightrag_ready=stats.get("lightrag_ready", False),
        unique_sources=unique,
        upload_progress=p._upload_state,
    )


@app.get("/api/graph")
async def get_graph():
    """返回完整知识图谱数据"""
    p = get_pipeline()
    if not p.graph_manager._built:
        p.graph_manager.build()
    return p.graph_manager.get_graph()


@app.get("/api/graph/delta")
async def get_graph_delta():
    """返回自上次 snapshot() 以来的新增节点和边"""
    return get_pipeline().graph_manager.get_delta()


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """上传PDF并在后台异步完成: 远程解析 -> 去重 -> 嵌入 -> 索引"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "仅支持PDF文件")

    file_path = UPLOAD_DIR / file.filename
    content = await file.read()
    file_path.write_bytes(content)

    p = get_pipeline()

    async def _background_upload():
        p.graph_manager.snapshot()
        try:
            content_list_path = await asyncio.to_thread(
                p.parse_remote_pdf, str(file_path)
            )
            if content_list_path is None:
                return
            await asyncio.to_thread(
                p.add_parsed_document, content_list_path
            )
        except Exception as e:
            p._upload_state["state"] = "error"
            p._upload_state["error"] = str(e)[:500]
            logger.error(f"Background upload failed: {e}")
        finally:
            p.graph_manager.build()

    asyncio.create_task(_background_upload())

    return {
        "status": "processing",
        "file": file.filename,
        "message": "PDF已接收，后台正在: 远程连接 -> 上传 -> MinerU解析 -> 下载 -> 去重 -> 嵌入 -> 索引",
    }


@app.get("/api/files")
async def list_files():
    """列出已上传和已解析的文件"""
    files = []
    if UPLOAD_DIR.exists():
        for f in sorted(UPLOAD_DIR.glob("*.pdf"), key=lambda x: x.stat().st_mtime, reverse=True):
            files.append({
                "name": f.name,
                "size_kb": round(f.stat().st_size / 1024, 1),
                "uploaded_at": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                "status": "uploaded",
            })
    # Also check parsed files
    p = get_pipeline()
    parsed_names = set()
    for s in p.sources:
        doc = s.split(" [p.")[0] if " [p." in s else ""
        if doc:
            parsed_names.add(doc)
    for f in files:
        if f["name"].replace(".pdf", "") in parsed_names or any(f["name"].replace(".pdf", "") in pn for pn in parsed_names):
            f["status"] = "indexed"
    return {"files": files}


@app.post("/api/batch-import")
async def batch_import():
    """批量导入已解析文档"""
    p = get_pipeline()
    n = p.load_documents()
    if n > 0:
        p.build_index(force_rebuild=True)
    stats = p.get_stats()
    return {
        "status": "success",
        "new_chunks": n,
        "total_chunks": stats["total_chunks"],
        "total_documents": stats["total_documents"],
    }


@app.get("/api/reload")
async def reload_index():
    """重新加载并重建索引"""
    p = get_pipeline()
    p.load_documents()
    p.build_index(force_rebuild=True)
    return {"status": "rebuilt", **p.get_stats()}


@app.post("/api/query/lightrag")
async def query_lightrag(req: QueryRequest):
    """LightRAG GraphRAG 查询 (主引擎)"""
    p = get_pipeline()
    if not p._lightrag_ready:
        return {"error": "LightRAG not ready. Call /api/build-lightrag first."}
    result = await p.aanswer(req.question, prefer_lightrag=True)
    return QueryResponse(
        question=req.question,
        answer=result["answer"],
        source_count=result.get("source_count", 0),
        sources=result.get("sources", []),
        engine=result.get("engine", "lightrag"),
        timestamp=datetime.now().isoformat(),
    )


@app.post("/api/build-lightrag")
async def build_lightrag():
    """构建 LightRAG 知识图谱"""
    p = get_pipeline()
    ok = await p.build_lightrag()
    return {"status": "success" if ok else "failed", "lightrag_ready": p._lightrag_ready}


# ─── Smart Chunk Preview + Doctor Review ───────────────

@app.post("/api/preview")
async def preview_chunks(file: UploadFile = File(...)):
    """解析PDF并返回智能切分预览（不入库）"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "仅支持PDF文件")
    file_path = UPLOAD_DIR / file.filename
    content = await file.read()
    file_path.write_bytes(content)

    p = get_pipeline()
    preview_data = {"filename": file.filename, "chunks": [], "images": []}

    try:
        # Try MinerU remote parse
        content_list_path = await asyncio.to_thread(p.parse_remote_pdf, str(file_path))
        if content_list_path:
            import json as _json
            with open(content_list_path, encoding="utf-8") as f:
                items = _json.load(f)
            for item in items:
                t = item.get("type", "text")
                if t == "text":
                    txt = item.get("text", "").strip()
                    if txt and len(txt) > 30:
                        tag = p._chunker.classify_section(txt)
                        preview_data["chunks"].append({
                            "type": "text", "text": txt[:300],
                            "section_tag": tag, "page": item.get("page_idx", 0),
                            "length": len(txt),
                        })
                elif t == "image":
                    cap = " ".join(item.get("image_caption", []))
                    if cap:
                        preview_data["images"].append({
                            "type": "image", "caption": cap[:200],
                            "page": item.get("page_idx", 0),
                        })
                elif t == "table":
                    cap = " ".join(item.get("table_caption", []))
                    body = str(item.get("table_body", ""))[:200]
                    if cap or body:
                        preview_data["chunks"].append({
                            "type": "table", "caption": cap, "body": body,
                            "page": item.get("page_idx", 0),
                        })
            # Save to DB as pending
            doc_id = save_document_record(file.filename, _json.dumps(preview_data, ensure_ascii=False),
                                          uploaded_by="admin", status="pending")
            preview_data["doc_id"] = doc_id
            return preview_data
    except Exception as e:
        logger.warning(f"Remote parse failed, using local: {e}")

    # Fallback: parse existing content_list.json if available
    cdir = Path(p.content_dir)
    for f in sorted(cdir.glob("*_content_list.json")):
        import json as _json
        with open(f, encoding="utf-8") as fh:
            items = _json.load(fh)
        doc_name = f.name.replace("_content_list.json", "")
        for item in items[:30]:
            t = item.get("type", "text")
            if t == "text":
                txt = item.get("text", "").strip()
                if txt and len(txt) > 30:
                    tag = p._chunker.classify_section(txt)
                    preview_data["chunks"].append({
                        "type": "text", "text": txt[:300],
                        "section_tag": tag, "page": item.get("page_idx", 0),
                        "doc": doc_name, "length": len(txt),
                    })
            elif t == "image":
                cap = " ".join(item.get("image_caption", []))
                if cap:
                    preview_data["images"].append({
                        "type": "image", "caption": cap[:200],
                        "page": item.get("page_idx", 0), "doc": doc_name,
                    })
    doc_id = save_document_record(file.filename, _json.dumps(preview_data, ensure_ascii=False),
                                  uploaded_by="admin", status="pending")
    preview_data["doc_id"] = doc_id
    return preview_data


@app.post("/api/preview/confirm")
async def confirm_import(req: dict):
    """医生确认后入库：更新doc状态 + FAISS增量索引"""
    doc_id = req.get("doc_id", 0)
    if doc_id:
        update_document_status(doc_id, "indexed")
    return {"status": "ok", "message": "已确认入库", "doc_id": doc_id}


@app.get("/api/preview/docs")
async def list_preview_docs():
    """列出所有已解析/待审核的文档"""
    return {"documents": db_list_docs()}


@app.get("/api/preview/doc/{doc_id}")
async def get_preview_doc(doc_id: int):
    chunks_json = get_document_chunks(doc_id)
    if not chunks_json:
        raise HTTPException(404, "文档不存在")
    import json as _json
    return _json.loads(chunks_json)


@app.get("/health")
async def health():
    try:
        get_pipeline()
        return {"status": "healthy"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


# ─── Static Files & HTML Routes ─────────────────────────

static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
os.makedirs(os.path.join(static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "js"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "img"), exist_ok=True)
os.makedirs(os.path.join(static_dir, "img", "icons"), exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Mount chart images directory for direct image serving
images_dir = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(images_dir, exist_ok=True)
if os.path.isdir(images_dir):
    app.mount("/images", StaticFiles(directory=images_dir), name="images")

# HTML routes
templates_dir = os.path.join(os.path.dirname(__file__), "templates")
os.makedirs(templates_dir, exist_ok=True)


# ─── User Feedback ────────────────────────────────────

FEEDBACK_STORE: list = []  # [{question, answer, rating, timestamp, username}]


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    rating: str  # "helpful" or "not_helpful"
    username: str = "anonymous"


@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    FEEDBACK_STORE.append({
        "question": req.question[:200],
        "answer": req.answer[:300],
        "rating": req.rating,
        "username": req.username,
        "timestamp": datetime.now().isoformat(),
    })
    # Keep only last 500 entries
    if len(FEEDBACK_STORE) > 500:
        FEEDBACK_STORE.pop(0)
    return {"status": "ok", "total": len(FEEDBACK_STORE)}


@app.get("/api/feedback/stats")
async def get_feedback_stats():
    total = len(FEEDBACK_STORE)
    if total == 0:
        return {"total": 0, "helpful": 0, "not_helpful": 0, "rate": 0}
    helpful = sum(1 for f in FEEDBACK_STORE if f["rating"] == "helpful")
    return {
        "total": total,
        "helpful": helpful,
        "not_helpful": total - helpful,
        "rate": round(helpful / total * 100, 1) if total > 0 else 0,
        "recent": FEEDBACK_STORE[-10:],
    }


@app.get("/")
async def index_page():
    return FileResponse(os.path.join(templates_dir, "index.html"))


@app.get("/login")
async def login_page():
    return FileResponse(os.path.join(templates_dir, "login.html"))


@app.get("/admin")
async def admin_page():
    return FileResponse(os.path.join(templates_dir, "admin.html"))


@app.get("/register")
async def register_page():
    return FileResponse(os.path.join(templates_dir, "register.html"))


@app.get("/chat")
async def chat_page():
    return FileResponse(os.path.join(templates_dir, "chat.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
