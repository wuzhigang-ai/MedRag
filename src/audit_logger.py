"""
Unified audit logging — captures every pipeline event for full-chain traceability.
Writes structured JSON lines to audit.log for real-time monitoring.
"""
import json, logging, time, os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

_AUDIT_FILE = Path(__file__).parent.parent / "audit.log"
_lock = Lock()

def _write(event_type: str, data: dict):
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        **data,
    }
    try:
        with _lock:
            with open(_AUDIT_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ── Pipeline Events ──

def audit_upload(task_uuid: str, filename: str, size: int, md5: str):
    _write("upload", {"uuid": task_uuid[:12], "filename": filename, "size": size, "md5": md5})

def audit_parse_start(task_uuid: str, filename: str):
    _write("parse_start", {"uuid": task_uuid[:12], "filename": filename, "engine": "mineru25pro"})

def audit_parse_page(task_uuid: str, page: int, chars: int, duration_ms: int):
    _write("parse_page", {"uuid": task_uuid[:12], "page": page, "chars": chars, "duration_ms": duration_ms})

def audit_parse_done(task_uuid: str, chunks: int, hallucinated: int, duration_ms: int, pico_types: dict):
    _write("parse_done", {"uuid": task_uuid[:12], "chunks": chunks, "hallucinated": hallucinated,
                          "duration_ms": duration_ms, "pico_types": pico_types})

def audit_pico_classify(task_uuid: str, chunks: int, api: str):
    _write("pico_classify", {"uuid": task_uuid[:12], "chunks": chunks, "api": api})

def audit_docling_images(task_uuid: str, images: int, duration_ms: int):
    _write("docling_images", {"uuid": task_uuid[:12], "images": images, "duration_ms": duration_ms})

def audit_faiss_start(task_uuid: str, vectors_before: int):
    _write("faiss_start", {"uuid": task_uuid[:12], "vectors_before": vectors_before})

def audit_faiss_done(task_uuid: str, vectors_added: int, vectors_after: int, duration_ms: int):
    _write("faiss_done", {"uuid": task_uuid[:12], "vectors_added": vectors_added,
                          "vectors_after": vectors_after, "duration_ms": duration_ms})

def audit_faiss_encode(chunks: int, duration_ms: int, device: str):
    _write("faiss_encode", {"chunks": chunks, "duration_ms": duration_ms, "device": device})

def audit_mysql_sync(task_uuid: str, article_id: int, segments: int, figures: int):
    _write("mysql_sync", {"uuid": task_uuid[:12], "article_id": article_id, "segments": segments, "figures": figures})

def audit_lightrag_start(task_uuid: str, mode: str):
    _write("lightrag_start", {"uuid": task_uuid[:12], "mode": mode})

def audit_lightrag_done(task_uuid: str, entities: int, relations: int, duration_ms: int):
    _write("lightrag_done", {"uuid": task_uuid[:12], "entities": entities,
                             "relations": relations, "duration_ms": duration_ms})

def audit_graph_build(nodes: int, edges: int):
    _write("graph_build", {"nodes": nodes, "edges": edges})


# ── Agent Events ──

def audit_agent_query(question: str, model: str):
    _write("agent_query", {"question": question[:120], "model": model})

def audit_agent_step(step: int, tool: str, elapsed: float, preview: str = ""):
    _write("agent_step", {"step": step, "tool": tool, "elapsed": elapsed, "preview": preview[:200]})

def audit_agent_answer(steps: int, elapsed: float, citations: int, model: str):
    _write("agent_answer", {"steps": steps, "elapsed": elapsed, "citations": citations, "model": model})

def audit_agent_fallback(reason: str):
    _write("agent_fallback", {"reason": reason[:200]})

def audit_agent_error(error: str, step: int = 0):
    _write("agent_error", {"error": error[:300], "step": step})


# ── Auth Events ──

def audit_login(username: str, success: bool, ip: str):
    _write("login", {"username": username, "success": success, "ip": ip})

def audit_logout(username: str):
    _write("logout", {"username": username})


# ── UI / API Events ──

def audit_api(method: str, path: str, status: int, duration_ms: int):
    _write("api", {"method": method, "path": path, "status": status, "duration_ms": duration_ms})

def audit_error(component: str, error: str, context: dict = None):
    _write("error", {"component": component, "error": error[:500], "context": context or {}})


# ── System Events ──

def audit_startup():
    _write("system_startup", {"pid": os.getpid()})

def audit_shutdown():
    _write("system_shutdown", {})

def audit_health():
    _write("system_health", {})


# ── Query functions ──

def tail_audit(n: int = 50, event_type: str = None) -> list:
    """Read last N audit entries, optionally filtered by type."""
    if not _AUDIT_FILE.exists():
        return []
    entries = []
    with open(_AUDIT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                if event_type and e.get("type") != event_type:
                    continue
                entries.append(e)
            except json.JSONDecodeError:
                continue
    return entries[-n:]

def tail_audit_text(n: int = 30) -> str:
    """Return human-readable audit trail."""
    entries = tail_audit(n)
    lines = []
    for e in entries:
        t = e.get("type", "?")
        ts = e.get("ts", "")[11:19]  # HH:MM:SS
        uuid = e.get("uuid", "")
        if t == "upload":
            lines.append(f"[{ts}] 📤 UPLOAD {uuid} | {e.get('filename','?')} ({e.get('size',0)}B)")
        elif t == "parse_start":
            lines.append(f"[{ts}] 🔍 PARSE-START {uuid} | {e.get('filename','?')}")
        elif t == "parse_page":
            lines.append(f"[{ts}]   📄 page={e.get('page')} | {e.get('chars')} chars | {e.get('duration_ms',0)//1000}s")
        elif t == "parse_done":
            lines.append(f"[{ts}] ✅ PARSE-DONE {uuid} | {e.get('chunks')} chunks | {e.get('hallucinated')} filtered | {e.get('duration_ms',0)//1000}s")
        elif t == "pico_classify":
            lines.append(f"[{ts}] 🏷️ PICO {uuid} | {e.get('chunks')} chunks via {e.get('api')}")
        elif t == "faiss_start":
            lines.append(f"[{ts}] 📊 FAISS-START {uuid} | before={e.get('vectors_before')}")
        elif t == "faiss_done":
            lines.append(f"[{ts}] ✅ FAISS-DONE {uuid} | +{e.get('vectors_added')} vectors | {e.get('duration_ms',0)//1000}s")
        elif t == "mysql_sync":
            lines.append(f"[{ts}] 🗄️ MYSQL {uuid} | article #{e.get('article_id')} | {e.get('segments')} seg + {e.get('figures')} fig")
        elif t == "lightrag_start":
            lines.append(f"[{ts}] 🕸️ LIGHTRAG-START {uuid} | mode={e.get('mode')}")
        elif t == "lightrag_done":
            lines.append(f"[{ts}] ✅ LIGHTRAG-DONE {uuid} | {e.get('entities')} entities, {e.get('relations')} relations | {e.get('duration_ms',0)//1000}s")
        elif t == "agent_query":
            lines.append(f"[{ts}] 🤖 AGENT-Q | {e.get('question','')[:80]}")
        elif t == "agent_step":
            lines.append(f"[{ts}]   🔧 step={e.get('step')} | {e.get('tool')} | {e.get('elapsed')}s")
        elif t == "agent_answer":
            lines.append(f"[{ts}] ✅ AGENT-ANSWER | {e.get('steps')} steps | {e.get('citations')} citations | {e.get('elapsed')}s")
        elif t == "agent_fallback":
            lines.append(f"[{ts}] ⚠️ AGENT-FALLBACK | {e.get('reason','')[:100]}")
        elif t == "agent_error":
            lines.append(f"[{ts}] ❌ AGENT-ERROR | {e.get('error','')[:120]}")
        elif t == "login":
            lines.append(f"[{ts}] 🔑 LOGIN {e.get('username')} | {'SUCCESS' if e.get('success') else 'FAIL'}")
        elif t == "system_startup":
            lines.append(f"[{ts}] 🚀 SYSTEM-START | pid={e.get('pid')}")
        elif t == "error":
            lines.append(f"[{ts}] ❌ {e.get('component','?')} | {e.get('error','')[:150]}")
        else:
            lines.append(f"[{ts}] {t}: {json.dumps({k:v for k,v in e.items() if k not in ('ts','type')}, ensure_ascii=False)[:150]}")
    return "\n".join(lines)
