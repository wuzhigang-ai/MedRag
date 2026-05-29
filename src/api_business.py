"""
MedRAG Business REST API Router — 对接新前端 (React 19 + shadcn/ui)
提供 REST JSON 端点，替代前端 tRPC 调用。
"""
import json, logging, asyncio, hashlib, os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["business"])

# ── Helpers ──────────────────────────────────────

def _get_pipeline():
    from api import get_pipeline
    return get_pipeline()

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def _dict_row(row, int_fields=None):
    """Ensure JSON serializable."""
    if row is None: return None
    for f in (int_fields or []):
        if f in row and row[f] is not None:
            row[f] = int(row[f])
    for f in list(row.keys()):
        if hasattr(row[f], 'isoformat'):
            row[f] = row[f].isoformat()
    return row


# ═══════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    confirmPassword: str = ""
    role: str = "user"
    email: str = ""

@router.post("/auth/login")
def auth_login(req: LoginRequest):
    from src.auth import verify_user, log_operation
    user = verify_user(req.username, req.password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    token = hashlib.sha256(f"{user['id']}:{req.username}:{os.urandom(16).hex()}".encode()).hexdigest()
    log_operation(user['id'], req.username, "login", ip_address="127.0.0.1")
    return {"token": token, "user": {"id": user['id'], "username": user['username'], "role": user['role']}}

@router.post("/auth/register")
def auth_register(req: RegisterRequest):
    from src.auth import create_user
    if req.password != req.confirmPassword:
        raise HTTPException(400, "两次密码不一致")
    try:
        user = create_user(req.username, req.password, req.role or "user", email=req.email or "")
        return {"success": True, "user": user}
    except ValueError as e:
        raise HTTPException(400, str(e))

@router.get("/auth/me")
def auth_me():
    return {"user": None}

@router.post("/auth/logout")
def auth_logout():
    return {"success": True}


# ═══════════════════════════════════════════════════════
# Articles
# ═══════════════════════════════════════════════════════

@router.get("/articles")
def articles_list(status: str = None, search: str = None,
                  articleType: str = None, department: str = None):
    from src.auth import list_articles
    rows = list_articles(status=status, search=search, article_type=articleType, department=department)
    return rows

@router.get("/articles/stats")
def articles_stats():
    from src.auth import get_article_stats
    return get_article_stats()

@router.get("/articles/{article_id}")
def articles_get(article_id: int):
    from src.auth import get_article
    a = get_article(article_id)
    if not a: raise HTTPException(404, "文献不存在")
    return a

class CreateArticleReq(BaseModel):
    title: str = ""
    fileName: str = ""
    fileSize: int = 0
    articleType: str = ""
    department: str = ""
    authors: list = []
    journal: str = ""
    publishDate: str = ""
    doi: str = ""
    keywords: list = []

@router.post("/articles")
def articles_create(req: CreateArticleReq, user_id: int = 1):
    from src.auth import create_article, log_operation
    aid = create_article(user_id, req.title, req.fileName, req.fileSize,
                         req.articleType, req.department, req.authors,
                         req.journal, req.publishDate, req.doi, req.keywords)
    log_operation(user_id, "admin", "create_article", "article", aid)
    return {"id": aid}

class UpdateStatusReq(BaseModel):
    status: str

@router.patch("/articles/{article_id}/status")
def articles_update_status(article_id: int, req: UpdateStatusReq):
    from src.auth import update_article_status
    update_article_status(article_id, req.status)
    return {"success": True}

@router.post("/articles/{article_id}/approve")
def articles_approve(article_id: int):
    from src.auth import update_article_status, log_operation
    update_article_status(article_id, "approved")
    log_operation(1, "admin", "approve_article", "article", article_id)
    return {"success": True}

@router.delete("/articles/{article_id}")
def articles_delete(article_id: int):
    from src.auth import delete_article
    delete_article(article_id)
    return {"success": True}

class SegmentsReq(BaseModel):
    segments: list = []

@router.post("/articles/{article_id}/segments")
def articles_add_segments(article_id: int, req: SegmentsReq):
    from src.auth import add_segments, update_article_status
    count = add_segments(article_id, req.segments)
    update_article_status(article_id, "parsed")
    return {"count": count}

class FiguresReq(BaseModel):
    figures: list = []

@router.post("/articles/{article_id}/figures")
def articles_add_figures(article_id: int, req: FiguresReq):
    from src.auth import add_figures
    count = add_figures(article_id, req.figures)
    return {"count": count}


# ═══════════════════════════════════════════════════════
# Chat
# ═══════════════════════════════════════════════════════

class CreateSessionReq(BaseModel):
    title: str = "新对话"
    scopeArticles: list = []
    scopeCategories: list = []

@router.get("/chat/sessions")
def chat_list_sessions(user_id: int = None):
    from src.auth import list_chat_sessions
    return list_chat_sessions(user_id)

@router.post("/chat/sessions")
def chat_create_session(req: CreateSessionReq, user_id: int = 1):
    from src.auth import create_chat_session
    sid = create_chat_session(user_id, req.title, req.scopeArticles, req.scopeCategories)
    return {"id": sid}

@router.get("/chat/sessions/{session_id}")
def chat_get_session(session_id: int):
    from src.auth import get_chat_session
    s = get_chat_session(session_id)
    if not s: raise HTTPException(404, "会话不存在")
    return s

class AddMessageReq(BaseModel):
    role: str = "user"
    content: str = ""
    contentType: str = "text"
    attachments: list = []
    ragTrace: dict = None
    citations: list = None
    tokenCount: int = 0

@router.post("/chat/sessions/{session_id}/messages")
async def chat_add_message(session_id: int, req: AddMessageReq):
    """Add user message, then call Agent, save AI response."""
    from src.auth import add_chat_message
    # Save user message
    add_chat_message(session_id, "user", req.content, req.contentType,
                     req.attachments, None, req.citations, req.tokenCount)

    # Call Agent for AI response
    try:
        p = _get_pipeline()
        from src.agent import MedicalAgent
        agent = MedicalAgent(p)
        result = await asyncio.wait_for(
            asyncio.to_thread(agent.run, req.content, 20),
            timeout=180.0
        )
        answer = result.get("answer", "")
        trace = result.get("reasoning_trace", [])
        sources = result.get("sources", [])
    except Exception as e:
        logger.warning(f"Agent failed, using FAISS fallback: {e}")
        try:
            r = await asyncio.to_thread(p.answer_with_sources, req.content, 8)
            answer = r.get("answer", "抱歉，无法处理请求")
            trace = []
            sources = r.get("sources", [])
        except Exception as e2:
            answer = f"处理失败: {str(e2)[:200]}"
            trace = []; sources = []

    # Save AI message
    ai_mid = add_chat_message(session_id, "assistant", answer, "text",
                              rag_trace={"steps": [{"tool": s.get("tool",""), "args": s.get("args","")} for s in trace]},
                              citations=sources,
                              token_count=len(answer))

    return {"id": ai_mid, "answer": answer, "ragTrace": trace, "citations": sources,
            "sources": sources, "reasoning_trace": trace}

@router.delete("/chat/sessions/{session_id}")
def chat_delete_session(session_id: int):
    from src.auth import delete_chat_session
    delete_chat_session(session_id)
    return {"success": True}

class RateMessageReq(BaseModel):
    rating: int = 0
    feedback: str = ""

@router.post("/chat/messages/{message_id}/rate")
def chat_rate_message(message_id: int, req: RateMessageReq):
    from src.auth import rate_chat_message
    rate_chat_message(message_id, req.rating, req.feedback)
    return {"success": True}


# ═══════════════════════════════════════════════════════
# Stats
# ═══════════════════════════════════════════════════════

@router.get("/stats/system")
def stats_system():
    from src.auth import get_system_stats
    s = get_system_stats()
    p = _get_pipeline()
    gs = p.get_stats()
    return {
        "totalArticles": s["totalArticles"],
        "parsedArticles": s.get("parsedArticles", 0),
        "knowledgeBaseArticles": s.get("knowledgeBaseArticles", 0),
        "totalNodes": gs.get("total_nodes", 0),
        "totalEdges": gs.get("total_edges", 0),
        "totalChatSessions": s.get("totalChatSessions", 0),
        "totalChatMessages": s.get("totalChatMessages", 0),
        "faissVectors": gs.get("index_size", 0),
        "totalDocuments": gs.get("total_documents", 0),
    }

@router.get("/stats/trends")
def stats_trends():
    """Simulated monthly trends (6 months)."""
    import random
    months = []
    for i in range(5, -1, -1):
        m = (datetime.now().month - i - 1) % 12 + 1
        y = datetime.now().year - (1 if i >= datetime.now().month else 0)
        months.append({
            "month": f"{y}-{m:02d}",
            "uploads": random.randint(3, 25),
            "parsed": random.randint(2, 20),
            "approved": random.randint(1, 15),
            "chats": random.randint(10, 80),
        })
    return months

@router.get("/stats/department-dist")
def stats_department():
    return [
        {"name": "Cardiology", "value": 12, "color": "#ef4444"},
        {"name": "Oncology", "value": 8, "color": "#3b82f6"},
        {"name": "Neurology", "value": 6, "color": "#8b5cf6"},
        {"name": "Endocrinology", "value": 5, "color": "#f59e0b"},
        {"name": "Pediatrics", "value": 4, "color": "#10b981"},
        {"name": "Other", "value": 7, "color": "#6b7280"},
    ]


# ═══════════════════════════════════════════════════════
# Knowledge Graph
# ═══════════════════════════════════════════════════════

@router.get("/graph")
def graph_data():
    """Reuse existing GraphManager."""
    p = _get_pipeline()
    from src.graph import GraphManager
    gm = GraphManager()
    return gm.build()

@router.get("/graph/stats")
def graph_stats():
    """Real graph stats from LightRAG via GraphManager."""
    from src.graph import GraphManager
    from collections import Counter
    gm = GraphManager()
    data = gm.build()
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    node_types = Counter(n.get("group", "其他") for n in nodes if n.get("group"))
    return {
        "totalNodes": data.get("stats", {}).get("total_nodes", len(nodes)),
        "totalEdges": data.get("stats", {}).get("total_edges", len(edges)),
        "nodeTypes": dict(node_types),
    }

@router.get("/graph/nodes/search")
def graph_search(query: str = ""):
    """Search nodes by label."""
    p = _get_pipeline()
    from src.graph import GraphManager
    gm = GraphManager()
    data = gm.build()
    nodes = data.get("nodes", [])
    results = [n for n in nodes if query.lower() in n.get("label","").lower()][:20]
    return results
