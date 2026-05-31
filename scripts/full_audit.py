"""MedRAG Full-System Audit — tests all endpoints, data consistency, state machine, frontend pages."""
import sys, json, time, os, urllib.request, urllib.error
sys.path.insert(0, '.')

from src.audit_logger import audit_startup, audit_health, audit_login, audit_api, tail_audit_text

BASE = "http://localhost:8000"
results = {"pass": 0, "fail": 0, "warn": 0}

def log_result(category, test, status, detail=""):
    if status == "PASS": results["pass"] += 1
    elif status == "FAIL": results["fail"] += 1
    else: results["warn"] += 1
    icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"  {icon} [{category}] {test}: {detail}")

def api(method, path, body=None, auth=None, expect_status=None):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if auth: req.add_header("Authorization", f"Bearer {auth}")
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        dt = int((time.time()-t0)*1000)
        audit_api(method, path, resp.status, dt)
        body_data = json.loads(resp.read())
        return resp.status, body_data, dt
    except urllib.error.HTTPError as e:
        dt = int((time.time()-t0)*1000)
        audit_api(method, path, e.code, dt)
        try: body_data = json.loads(e.read())
        except: body_data = {}
        return e.code, body_data, dt
    except Exception as e:
        dt = int((time.time()-t0)*1000)
        audit_api(method, path, 0, dt)
        return 0, {"error": str(e)}, dt

audit_startup()
audit_health()

# ==========================================
# PHASE 1: AUTH SECURITY
# ==========================================
print("\n=== PHASE 1: AUTH SECURITY ===")

s, d, dt = api("POST", "/api/auth/login", {"username":"admin","password":"admin123"})
token = d.get("token","")
log_result("AUTH", "TC-001 Login valid", "PASS" if s==200 and token else "FAIL",
           f"{d.get('user',{}).get('role','?')} | {dt}ms")
audit_login("admin", s==200, "127.0.0.1")

s, d, dt = api("POST", "/api/auth/login", {"username":"admin","password":"wrong"})
log_result("AUTH", "TC-002 Login wrong pw", "PASS" if s==401 else "FAIL", f"status={s}")

s, d, dt = api("POST", "/api/auth/login", {"username":"nonexistent_zzz","password":"x"})
log_result("AUTH", "TC-003 Login nonexistent", "PASS" if s==401 else "FAIL", f"status={s}")

s, d, dt = api("GET", "/api/auth/me", auth=token)
log_result("AUTH", "TC-004 Auth/me valid", "PASS" if d.get("user") and d["user"].get("role") else "FAIL",
           f"user={d.get('user',{}).get('username','?')}")

s, d, dt = api("GET", "/api/auth/me")
log_result("AUTH", "TC-005 Auth/me no token", "PASS" if d.get("user") is None else "FAIL")

s, d, dt = api("POST", "/api/articles", {"title":"hack"})
log_result("AUTH", "TC-006 No-auth write protect", "PASS" if s==401 else "FAIL", f"status={s}")

s, d, dt = api("DELETE", "/api/articles/1")
log_result("AUTH", "TC-007 No-auth delete protect", "PASS" if s==401 else "FAIL", f"status={s}")

s, d, dt = api("GET", "/api/articles", auth="invalidtoken12345")
log_result("AUTH", "TC-008 Bad token", "WARN" if s==200 else "PASS", f"status={s}")

# Register
s, d, dt = api("POST", "/api/auth/register", {"username":"audit_test","password":"test123","confirmPassword":"wrong","role":"user","email":"bad-email"})
log_result("AUTH", "TC-009 Register pw mismatch", "PASS" if s==400 else "FAIL")

s, d, dt = api("POST", "/api/auth/register", {"username":"audit_test","password":"test123","confirmPassword":"test123","role":"user","email":"bad-email"})
log_result("AUTH", "TC-010 Register bad email", "PASS" if s==400 else "FAIL")

# ==========================================
# PHASE 2: API ENDPOINTS
# ==========================================
print("\n=== PHASE 2: API ENDPOINTS ===")

endpoints = [
    ("GET", "/api/articles", 200),
    ("GET", "/api/articles/stats", 200),
    ("GET", "/api/articles/1", 200),
    ("GET", "/api/articles/999", 404),
    ("GET", "/api/graph", 200),
    ("GET", "/api/graph/stats", 200),
    ("GET", "/api/graph/nodes/search?query=blood", 200),
    ("GET", "/api/stats/system", 200),
    ("GET", "/api/chat/sessions", 200),
    ("GET", "/api/upload/history", 200),
    ("POST", "/api/auth/logout", 200),
]

for method, path, expected in endpoints:
    s, d, dt = api(method, path, auth=token)
    name = path.split("?")[0].replace("/api/","")
    log_result("API", f"{method} {name}", "PASS" if s==expected else "FAIL",
               f"status={s} (expected {expected}) | {dt}ms")

# ==========================================
# PHASE 3: DATA CONSISTENCY
# ==========================================
print("\n=== PHASE 3: DATA CONSISTENCY ===")

s, articles, _ = api("GET", "/api/articles", auth=token)
s, articles_stats, _ = api("GET", "/api/articles/stats", auth=token)
s, system_stats, _ = api("GET", "/api/stats/system", auth=token)
s, graph_stats, _ = api("GET", "/api/graph/stats", auth=token)

article_count = len(articles) if isinstance(articles, list) else 0
faiss_docs = system_stats.get("totalDocuments", 0)
graph_nodes = graph_stats.get("totalNodes", 0)
graph_edges = graph_stats.get("totalEdges", 0)
stats_total = articles_stats.get("total", 0)
faiss_vectors = system_stats.get("faissVectors", 0)

log_result("DATA", "Articles count", "PASS" if article_count > 0 else "FAIL", f"{article_count} articles")
log_result("DATA", "FAISS documents", "PASS" if faiss_docs > 0 else "FAIL", f"{faiss_docs} docs")
log_result("DATA", "MySQL vs FAISS", "PASS" if stats_total == faiss_docs else "FAIL", f"MySQL={stats_total} FAISS={faiss_docs}")
log_result("DATA", "Graph nodes", "PASS" if graph_nodes > 0 else "FAIL", f"{graph_nodes} nodes")
log_result("DATA", "Graph edges", "PASS" if graph_edges > 0 else "FAIL", f"{graph_edges} edges")
log_result("DATA", "FAISS vectors", "PASS" if faiss_vectors >= article_count else "FAIL", f"{faiss_vectors} vectors")

statuses = {}
for a in (articles if isinstance(articles, list) else []):
    st = a.get("status","?")
    statuses[st] = statuses.get(st,0)+1
log_result("DATA", "Article statuses", "PASS", str(statuses))

# Check individual articles have key fields
key_fields = ["id","title","status","fileName","articleType"]
missing_fields = 0
for a in (articles if isinstance(articles, list) else []):
    for f in key_fields:
        if f not in a:
            missing_fields += 1
log_result("DATA", "Article field completeness", "PASS" if missing_fields==0 else "FAIL", f"{missing_fields} missing")

# ==========================================
# PHASE 4: UPLOAD STATE MACHINE
# ==========================================
print("\n=== PHASE 4: STATE MACHINE ===")

s, history, _ = api("GET", "/api/upload/history", auth=token)
tasks = history.get("tasks", []) if isinstance(history, dict) else []
log_result("STATE", "Upload history count", "PASS" if len(tasks) > 0 else "FAIL", f"{len(tasks)} tasks")

states = {}
for t in tasks:
    st = t.get("status","?")
    states[st] = states.get(st,0)+1
log_result("STATE", "Task state distribution", "PASS", str(states))

# Check stuck tasks
stuck_sum = states.get("received",0) + states.get("parsing",0)
log_result("STATE", "Stuck tasks check", "WARN" if stuck_sum > 0 else "PASS", f"{stuck_sum} stuck")

# Check ENUM in DB
from src.auth import get_conn
conn = get_conn(); cursor = conn.cursor()
cursor.execute("SHOW COLUMNS FROM upload_tasks LIKE 'status'")
row = cursor.fetchone()
enum_str = str(row[1])
has_chunking = "chunking" in enum_str
has_indexing = "indexing" in enum_str
log_result("STATE", "DB ENUM has chunking/indexing", "PASS" if has_chunking and has_indexing else "FAIL",
           f"chunking={'YES' if has_chunking else 'NO'}, indexing={'YES' if has_indexing else 'NO'}")
cursor.close(); conn.close()

# Check task field completeness
task_fields = ["task_uuid","filename","status","parsing_duration_ms","faiss_status","lightrag_status"]
task_missing = 0
for t in tasks:
    for f in task_fields:
        if f not in t: task_missing += 1
log_result("STATE", "Task field completeness", "PASS" if task_missing==0 else "FAIL", f"{task_missing} missing fields")

# ==========================================
# PHASE 5: AGENT RETRIEVAL
# ==========================================
print("\n=== PHASE 5: AGENT RETRIEVAL ===")

import urllib.parse
q = "What medical conditions are studied in the knowledge base?"
encoded_q = urllib.parse.quote(q)
try:
    req = urllib.request.Request(f"{BASE}/api/agent/stream?question={encoded_q}")
    req.add_header("Authorization", f"Bearer {token}")
    t0 = time.time()
    resp = urllib.request.urlopen(req, timeout=90)

    steps = 0; has_answer = False; citations = 0
    for line in resp:
        line = line.decode().strip()
        if line.startswith("data: "):
            try:
                d = json.loads(line[6:])
                if d.get("type") == "step": steps += 1
                elif d.get("type") == "answer":
                    has_answer = True
                    citations = len(d.get("sources", []))
            except: pass
    dt = int((time.time()-t0)*1000)
    log_result("AGENT", "SSE streaming Q&A", "PASS" if has_answer else "FAIL",
               f"{steps} steps | {'has answer' if has_answer else 'no answer'} | {citations} cites | {dt}ms")
except Exception as e:
    log_result("AGENT", "SSE streaming Q&A", "FAIL", str(e)[:100])

# Also test a specific clinical question
q2 = "What does seyfarth2008 study about cardiogenic shock?"
try:
    req2 = urllib.request.Request(f"{BASE}/api/agent/stream?question={urllib.parse.quote(q2)}")
    req2.add_header("Authorization", f"Bearer {token}")
    resp2 = urllib.request.urlopen(req2, timeout=90)
    for line in resp2:
        line = line.decode().strip()
        if line.startswith("data: "):
            try:
                d = json.loads(line[6:])
                if d.get("type") == "answer" and d.get("answer"):
                    has_seyfarth = "Impella" in d["answer"] or "cardiogenic" in d["answer"].lower()
                    log_result("AGENT", "Clinical QA (seyfarth2008)", "PASS" if has_seyfarth else "WARN",
                               f"answer length={len(d['answer'])} chars")
                    break
            except: pass
except Exception as e:
    log_result("AGENT", "Clinical QA (seyfarth2008)", "FAIL", str(e)[:100])

# ==========================================
# PHASE 6: MYSQL SCHEMA
# ==========================================
print("\n=== PHASE 6: MYSQL SCHEMA ===")

conn2 = get_conn(); cursor2 = conn2.cursor(dictionary=True)
tables = ["users","articles","text_segments","extracted_figures","chat_sessions","chat_messages","upload_tasks","operation_logs"]
for tbl in tables:
    cursor2.execute(f"SELECT COUNT(*) as cnt FROM {tbl}")
    cnt = cursor2.fetchone()["cnt"]
    log_result("SCHEMA", f"Table {tbl}", "PASS", f"{cnt} rows")

cursor2.execute("SELECT COUNT(*) as cnt FROM text_segments WHERE article_id NOT IN (SELECT id FROM articles)")
orphans = cursor2.fetchone()["cnt"]
log_result("SCHEMA", "Orphaned text_segments", "PASS" if orphans==0 else "FAIL", f"{orphans} orphans")

cursor2.execute("SELECT COUNT(*) as cnt FROM extracted_figures WHERE article_id NOT IN (SELECT id FROM articles)")
orphans2 = cursor2.fetchone()["cnt"]
log_result("SCHEMA", "Orphaned extracted_figures", "PASS" if orphans2==0 else "FAIL", f"{orphans2} orphans")

# Check auth_token column exists
cursor2.execute("SHOW COLUMNS FROM users LIKE 'auth_token'")
has_auth_col = cursor2.fetchone() is not None
log_result("SCHEMA", "users.auth_token column", "PASS" if has_auth_col else "FAIL")

cursor2.close(); conn2.close()

# ==========================================
# PHASE 7: FRONTEND PAGES (via WebBridge)
# ==========================================
print("\n=== PHASE 7: FRONTEND PAGES ===")

import subprocess
def wb(action, args="{}"):
    cmd = f'curl -s -X POST http://127.0.0.1:10086/command -H "Content-Type: application/json" -d \'{{"action":"{action}","args":{args},"session":"audit"}}\''
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    try: return json.loads(result.stdout)
    except: return {"ok":False}

# Check WebBridge
wb_check = wb("navigate", '{"url":"http://localhost:5173","newTab":true}')
wb_ok = wb_check.get("ok", False)
log_result("FRONTEND", "WebBridge available", "PASS" if wb_ok else "WARN", "running" if wb_ok else "not available")

if wb_ok:
    pages = [
        ("/#/login", "#/login"),
        ("/#/admin", "#/admin"),
        ("/#/admin/library", "#/admin/library"),
        ("/#/admin/parsing", "#/admin/parsing"),
        ("/#/admin/graph", "#/admin/graph"),
        ("/#/admin/chat", "#/admin/chat"),
        ("/#/chat", "#/chat"),
        ("/#/nonexistent", "#/404"),
    ]

    for full_url, short_name in pages:
        time.sleep(2)
        # Navigate
        subprocess.run(f'curl -s -X POST http://127.0.0.1:10086/command -H "Content-Type: application/json" -d \'{{"action":"evaluate","args":{{"code":"window.location.hash=\\"{short_name}\\""}},"session":"audit"}}\'', shell=True, capture_output=True)
        time.sleep(3)

        # Snapshot and check
        snap_result = wb("snapshot")
        if snap_result.get("ok"):
            url = snap_result.get("data",{}).get("url","?")
            tree_str = str(snap_result)
            has_content = len(tree_str) > 300
            has_heading = '"role":"heading"' in tree_str
            has_nav = '"role":"navigation"' in tree_str or '"role":"link"' in tree_str
            status = "PASS" if has_content and (has_heading or has_nav) else "WARN"
            log_result("FRONTEND", f"Page {short_name}", status,
                       f"url={url} | render={'OK' if has_content else 'EMPTY'}")
        else:
            log_result("FRONTEND", f"Page {short_name}", "WARN", "snapshot failed")

    # JS Errors check
    time.sleep(2)
    subprocess.run('curl -s -X POST http://127.0.0.1:10086/command -H "Content-Type: application/json" -d \'{"action":"evaluate","args":{"code":"window.__consoleErrors = window.__consoleErrors || []; window.onerror = function(m,s,l,c,e){window.__consoleErrors.push({msg:String(m).substring(0,200),line:l})}; JSON.stringify(window.__consoleErrors.slice(-10))"},"session":"audit"}\'', shell=True, capture_output=True)
    log_result("FRONTEND", "JS error monitor", "PASS", "installed (check console for existing errors)")

    # Close
    subprocess.run('curl -s -X POST http://127.0.0.1:10086/command -H "Content-Type: application/json" -d \'{"action":"close_session","args":{},"session":"audit"}\'', shell=True, capture_output=True)
else:
    for _, short_name in pages:
        log_result("FRONTEND", f"Page {short_name}", "WARN", "WebBridge unavailable")

# ==========================================
# FINAL REPORT
# ==========================================
print("\n" + "="*60)
print(f"  AUDIT COMPLETE")
print(f"  PASS: {results['pass']}  |  FAIL: {results['fail']}  |  WARN: {results['warn']}")
print(f"  Total checks: {sum(results.values())}")
print("="*60)

# Save audit trail
trail = tail_audit_text(100)
with open("audit_trail.txt", "w", encoding="utf-8") as f:
    f.write(trail)
print("\nAudit trail saved to audit_trail.txt")
print("\n=== Audit Trail (last 30 events) ===")
print(trail[-2000:])
