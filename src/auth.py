"""MySQL-based authentication module for MedASR."""

import bcrypt
import mysql.connector
from mysql.connector import pooling
import logging

logger = logging.getLogger(__name__)

DB_CONFIG = {
    "host": "localhost", "port": 3306,
    "user": "root", "password": "12345678",
    "database": "medasr_db", "charset": "utf8mb4",
}

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(pool_name="medasr", pool_size=5, **DB_CONFIG)
    return _pool


def get_conn():
    return get_pool().get_connection()


def create_user(username: str, password: str, role: str = "user") -> dict:
    """Register a new user. Returns user info or raises."""
    try:
        conn = get_conn()
        cursor = conn.cursor()
        h = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)",
            (username, h, role),
        )
        conn.commit()
        uid = cursor.lastrowid
        cursor.close(); conn.close()
        return {"id": uid, "username": username, "role": role}
    except mysql.connector.IntegrityError:
        raise ValueError("用户名已存在")
    except Exception as e:
        logger.error(f"Create user failed: {e}")
        raise


def verify_user(username: str, password: str) -> dict | None:
    """Verify credentials. Returns user dict or None."""
    try:
        conn = get_conn()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, username, password_hash, role FROM users WHERE username = %s", (username,))
        row = cursor.fetchone()
        cursor.close(); conn.close()
        if row and bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
            return {"id": row["id"], "username": row["username"], "role": row["role"]}
    except Exception as e:
        logger.error(f"Verify user failed: {e}")
    return None


def list_users() -> list:
    """List all users (admin only)."""
    try:
        conn = get_conn()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id, username, role, created_at FROM users ORDER BY id")
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        return rows
    except Exception as e:
        logger.error(f"List users failed: {e}")
        return []


# ─── Document tracking ───────────────────────────────


def save_document_record(filename: str, chunks_json: str, uploaded_by: str = "admin", status: str = "pending") -> int:
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO documents (filename, chunks_json, status, uploaded_by) VALUES (%s, %s, %s, %s)",
        (filename, chunks_json, status, uploaded_by),
    )
    conn.commit()
    doc_id = cursor.lastrowid
    cursor.close(); conn.close()
    return doc_id


def update_document_status(doc_id: int, status: str) -> None:
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("UPDATE documents SET status = %s WHERE id = %s", (status, doc_id))
    conn.commit()
    cursor.close(); conn.close()


def list_documents() -> list:
    conn = get_conn()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT id, filename, status, uploaded_by, created_at FROM documents ORDER BY id DESC")
    rows = cursor.fetchall()
    cursor.close(); conn.close()
    return rows


def get_document_chunks(doc_id: int) -> str | None:
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT chunks_json FROM documents WHERE id = %s", (doc_id,))
    row = cursor.fetchone()
    cursor.close(); conn.close()
    return row[0] if row else None


# ─── Upload task tracking ──────────────────────────────


def ensure_upload_tasks_table() -> None:
    """Create upload_tasks table if it doesn't exist."""
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS upload_tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_uuid CHAR(36) NOT NULL UNIQUE,
            filename VARCHAR(255) NOT NULL,
            original_pdf_path VARCHAR(500),
            uploaded_by VARCHAR(50) NOT NULL,
            file_md5 CHAR(32),
            file_size_bytes BIGINT,
            engine_selected VARCHAR(20),
            engine_reason TEXT,
            cross_validation_scores JSON,
            cjk_issues_detected BOOLEAN DEFAULT FALSE,
            parsing_started_at TIMESTAMP NULL,
            parsing_duration_ms INT DEFAULT 0,
            docling_items INT DEFAULT 0,
            mineru_items INT DEFAULT 0,
            paddleocr_items INT DEFAULT 0,
            cross_validation_duration_ms INT DEFAULT 0,
            postprocessing_duration_ms INT DEFAULT 0,
            postprocess_cleaned INT DEFAULT 0,
            postprocess_merged INT DEFAULT 0,
            postprocess_tables_serialized INT DEFAULT 0,
            faiss_status ENUM('pending','processing','success','failed') DEFAULT 'pending',
            faiss_started_at TIMESTAMP NULL,
            faiss_duration_ms INT DEFAULT 0,
            faiss_chunks_before INT DEFAULT 0,
            faiss_chunks_added INT DEFAULT 0,
            faiss_chunks_removed INT DEFAULT 0,
            faiss_chunks_kept INT DEFAULT 0,
            faiss_is_update BOOLEAN DEFAULT FALSE,
            faiss_images_total INT DEFAULT 0,
            faiss_images_vlm INT DEFAULT 0,
            faiss_error TEXT,
            lightrag_status ENUM('pending','processing','success','failed','skipped') DEFAULT 'pending',
            lightrag_started_at TIMESTAMP NULL,
            lightrag_duration_ms INT DEFAULT 0,
            lightrag_mode VARCHAR(20),
            lightrag_docs_inserted INT DEFAULT 0,
            lightrag_docs_skipped INT DEFAULT 0,
            lightrag_entities INT DEFAULT 0,
            lightrag_relations INT DEFAULT 0,
            lightrag_error TEXT,
            status ENUM('received','parsing','cross_validating','postprocessing',
                        'indexing_faiss','indexing_lightrag','done','failed','partial')
                        DEFAULT 'received',
            error_message TEXT,
            quality_warning TEXT,
            retry_count INT DEFAULT 0,
            max_retries INT DEFAULT 3,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            completed_at TIMESTAMP NULL,
            INDEX idx_status (status),
            INDEX idx_uploaded_by (uploaded_by),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)
    conn.commit()
    cursor.close(); conn.close()
    logger.info("upload_tasks table ready")


def create_upload_task(task_uuid: str, filename: str, uploaded_by: str,
                       pdf_path: str = None, file_md5: str = None,
                       file_size: int = None) -> int:
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO upload_tasks (task_uuid, filename, original_pdf_path,
                                  uploaded_by, file_md5, file_size_bytes, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'received')
    """, (task_uuid, filename, pdf_path, uploaded_by, file_md5, file_size))
    conn.commit()
    tid = cursor.lastrowid
    cursor.close(); conn.close()
    return tid


def update_task_status(task_uuid: str, status: str, **kwargs) -> None:
    """Update task status and any additional fields passed as kwargs.
    Each kwarg key maps to the column name."""
    if not kwargs:
        conn = get_conn(); cursor = conn.cursor()
        cursor.execute("UPDATE upload_tasks SET status=%s WHERE task_uuid=%s",
                       (status, task_uuid))
        conn.commit(); cursor.close(); conn.close()
        return
    set_clause = ", ".join(f"{k}=%s" for k in kwargs.keys())
    values = list(kwargs.values()) + [status, task_uuid]
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute(f"UPDATE upload_tasks SET {set_clause}, status=%s, updated_at=NOW() WHERE task_uuid=%s",
                   values)
    conn.commit(); cursor.close(); conn.close()


def get_task(task_uuid: str) -> dict | None:
    conn = get_conn()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM upload_tasks WHERE task_uuid=%s", (task_uuid,))
    row = cursor.fetchone()
    cursor.close(); conn.close()
    return row


def list_tasks(limit: int = 50, status_filter: str = None,
               uploaded_by: str = None) -> list:
    conn = get_conn()
    cursor = conn.cursor(dictionary=True)
    clauses = []
    params = []
    if status_filter:
        clauses.append("status=%s")
        params.append(status_filter)
    if uploaded_by:
        clauses.append("uploaded_by=%s")
        params.append(uploaded_by)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    cursor.execute(f"SELECT * FROM upload_tasks{where} ORDER BY created_at DESC LIMIT %s",
                   params + [limit])
    rows = cursor.fetchall()
    cursor.close(); conn.close()
    return rows


def get_pending_tasks() -> list:
    """Tasks that were interrupted (server crash mid-processing)."""
    conn = get_conn()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT * FROM upload_tasks
        WHERE status IN ('received','parsing','cross_validating','postprocessing',
                          'indexing_faiss','indexing_lightrag')
        ORDER BY created_at ASC
    """)
    rows = cursor.fetchall()
    cursor.close(); conn.close()
    return rows


def mark_task_completed(task_uuid: str) -> None:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("UPDATE upload_tasks SET status='done', completed_at=NOW() WHERE task_uuid=%s",
                   (task_uuid,))
    conn.commit(); cursor.close(); conn.close()


def mark_task_failed(task_uuid: str, error: str) -> None:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("UPDATE upload_tasks SET status='failed', error_message=%s WHERE task_uuid=%s",
                   (error[:1000], task_uuid))
    conn.commit(); cursor.close(); conn.close()


# ══════════════════════════════════════════════════════════════
# Phase 1: New Business Tables (MedRAG Frontend Integration)
# ══════════════════════════════════════════════════════════════

def ensure_business_tables() -> None:
    """Create all business tables for the MedRAG frontend integration."""
    conn = get_conn()
    cursor = conn.cursor()

    # Extend existing users table with new columns
    cols_to_add = [
        ("name", "VARCHAR(255)"),
        ("email", "VARCHAR(255)"),
        ("avatar", "TEXT"),
        ("medical_role", "VARCHAR(100)"),
        ("institution", "VARCHAR(255)"),
        ("department", "VARCHAR(100)"),
        ("years_of_experience", "INT DEFAULT 0"),
        ("phone", "VARCHAR(50)"),
        ("last_sign_in_at", "TIMESTAMP NULL"),
    ]
    for col_name, col_type in cols_to_add:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
        except Exception:
            pass  # Column already exists

    # articles
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            title VARCHAR(500),
            file_name VARCHAR(255),
            file_size INT DEFAULT 0,
            file_url TEXT,
            article_type VARCHAR(100),
            status ENUM('pending','parsing','parsed','reviewing','approved','rejected','error') DEFAULT 'pending',
            parsed_content LONGTEXT,
            text_segments_count INT DEFAULT 0,
            figures_count INT DEFAULT 0,
            tables_count INT DEFAULT 0,
            authors JSON,
            publish_date VARCHAR(50),
            journal VARCHAR(255),
            doi VARCHAR(255),
            keywords JSON,
            department VARCHAR(100),
            is_in_knowledge_base TINYINT(1) DEFAULT 0,
            knowledge_nodes_count INT DEFAULT 0,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            parsed_at TIMESTAMP NULL,
            approved_at TIMESTAMP NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_status (status),
            INDEX idx_user_id (user_id),
            INDEX idx_uploaded_at (uploaded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # text_segments
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS text_segments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            article_id INT NOT NULL,
            sequence INT DEFAULT 0,
            content LONGTEXT,
            segment_type ENUM('abstract','introduction','methods','results_primary',
                'results_secondary','subgroup_analysis','sensitivity_analysis',
                'discussion','conclusion','references','other') DEFAULT 'other',
            section_title VARCHAR(255),
            page_number INT DEFAULT 0,
            confidence FLOAT DEFAULT 0,
            word_count INT DEFAULT 0,
            evidence_level VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_article_id (article_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # extracted_figures
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS extracted_figures (
            id INT AUTO_INCREMENT PRIMARY KEY,
            article_id INT NOT NULL,
            figure_type ENUM('table','figure','chart','image') DEFAULT 'figure',
            sequence INT DEFAULT 0,
            caption TEXT,
            description TEXT,
            page_number INT DEFAULT 0,
            confidence FLOAT DEFAULT 0,
            img_path TEXT,
            image_url VARCHAR(500),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_article_id (article_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # chat_sessions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            title VARCHAR(255),
            scope_articles JSON,
            scope_categories JSON,
            message_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # chat_messages
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            session_id INT NOT NULL,
            role ENUM('user','assistant','system') DEFAULT 'user',
            content LONGTEXT,
            content_type ENUM('text','image','pdf','voice','mixed') DEFAULT 'text',
            attachments JSON,
            rag_trace JSON,
            citations JSON,
            rating INT DEFAULT 0,
            feedback TEXT,
            token_count INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_session_id (session_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    # operation_logs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS operation_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            user_name VARCHAR(255),
            action VARCHAR(100),
            target_type VARCHAR(100),
            target_id INT,
            details JSON,
            ip_address VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)

    conn.commit()
    cursor.close(); conn.close()
    logger.info("Business tables (articles, segments, figures, chat, logs) ready")


# ─── Article CRUD ──────────────────────────────────

def create_article(user_id: int, title: str, file_name: str = "", file_size: int = 0,
                   article_type: str = "", department: str = "", authors: list = None,
                   journal: str = "", publish_date: str = "", doi: str = "",
                   keywords: list = None) -> int:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO articles (user_id, title, file_name, file_size, article_type,
            department, authors, journal, publish_date, doi, keywords, status)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending')
    """, (user_id, title, file_name, file_size, article_type, department,
          json.dumps(authors or []), journal, publish_date, doi, json.dumps(keywords or [])))
    conn.commit(); aid = cursor.lastrowid
    cursor.close(); conn.close()
    return aid


def list_articles(status: str = None, search: str = None, article_type: str = None,
                  department: str = None, limit: int = 50) -> list:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    clauses = []; params = []
    if status: clauses.append("status=%s"); params.append(status)
    if search: clauses.append("title LIKE %s"); params.append(f"%{search}%")
    if article_type: clauses.append("article_type=%s"); params.append(article_type)
    if department: clauses.append("department=%s"); params.append(department)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    cursor.execute(f"SELECT * FROM articles{where} ORDER BY uploaded_at DESC LIMIT %s",
                   params + [limit])
    rows = cursor.fetchall()
    for r in rows:
        for f in ("authors", "keywords"):
            if isinstance(r.get(f), str): r[f] = json.loads(r[f])
        for f in ("id", "user_id", "file_size", "text_segments_count", "figures_count",
                   "tables_count", "knowledge_nodes_count"):
            if r.get(f) is not None: r[f] = int(r[f])
    cursor.close(); conn.close()
    return rows


def get_article(article_id: int) -> dict | None:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM articles WHERE id=%s", (article_id,))
    a = cursor.fetchone()
    if not a: cursor.close(); conn.close(); return None
    for f in ("authors", "keywords"):
        if isinstance(a.get(f), str): a[f] = json.loads(a[f])
    # Load segments
    cursor.execute("SELECT * FROM text_segments WHERE article_id=%s ORDER BY sequence", (article_id,))
    segments = cursor.fetchall()
    # Load figures
    cursor.execute("SELECT * FROM extracted_figures WHERE article_id=%s ORDER BY sequence", (article_id,))
    figures = cursor.fetchall()
    cursor.close(); conn.close()
    a["segments"] = segments; a["figures"] = figures
    return a


def update_article_status(article_id: int, status: str) -> None:
    conn = get_conn(); cursor = conn.cursor()
    extra = ""
    if status == "parsed": extra = ", parsed_at=NOW()"
    elif status == "approved": extra = ", approved_at=NOW(), is_in_knowledge_base=1"
    cursor.execute(f"UPDATE articles SET status=%s{extra} WHERE id=%s", (status, article_id))
    conn.commit(); cursor.close(); conn.close()


def delete_article(article_id: int) -> None:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("DELETE FROM text_segments WHERE article_id=%s", (article_id,))
    cursor.execute("DELETE FROM extracted_figures WHERE article_id=%s", (article_id,))
    cursor.execute("DELETE FROM articles WHERE id=%s", (article_id,))
    conn.commit(); cursor.close(); conn.close()


def get_article_stats() -> dict:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    cursor.execute("""SELECT COUNT(*) as total FROM articles""")
    total = cursor.fetchone()["total"]
    cursor.execute("""SELECT status, COUNT(*) as cnt FROM articles GROUP BY status""")
    by_status = {r["status"]: r["cnt"] for r in cursor.fetchall()}
    cursor.execute("""SELECT COUNT(*) as cnt FROM articles WHERE is_in_knowledge_base=1""")
    in_kb = cursor.fetchone()["cnt"]
    cursor.close(); conn.close()
    return {"total": total, "by_status": by_status, "in_knowledge_base": in_kb}


# ─── Segment & Figure helpers ────────────────────────

def add_segments(article_id: int, segments: list) -> int:
    conn = get_conn(); cursor = conn.cursor()
    count = 0
    for seg in segments:
        cursor.execute("""
            INSERT INTO text_segments (article_id, sequence, content, segment_type,
                section_title, page_number, confidence, word_count, evidence_level)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (article_id, seg.get("sequence",0), seg.get("content",""),
              seg.get("segmentType","other"), seg.get("sectionTitle",""),
              seg.get("pageNumber",0), seg.get("confidence",0),
              seg.get("wordCount",0), seg.get("evidenceLevel","")))
        count += 1
    cursor.execute("UPDATE articles SET text_segments_count=text_segments_count+%s WHERE id=%s",
                   (count, article_id))
    conn.commit(); cursor.close(); conn.close()
    return count


def add_figures(article_id: int, figures: list) -> int:
    conn = get_conn(); cursor = conn.cursor()
    count = 0
    for fig in figures:
        cursor.execute("""
            INSERT INTO extracted_figures (article_id, figure_type, sequence, caption,
                description, page_number, confidence, img_path, image_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (article_id, fig.get("figureType","figure"), fig.get("sequence",0),
              fig.get("caption",""), fig.get("description",""),
              fig.get("pageNumber",0), fig.get("confidence",0),
              fig.get("img_path",""), fig.get("imageUrl","")))
        count += 1
    cursor.execute("UPDATE articles SET figures_count=figures_count+%s WHERE id=%s",
                   (count, article_id))
    conn.commit(); cursor.close(); conn.close()
    return count


# ─── Chat CRUD ──────────────────────────────────────

def create_chat_session(user_id: int, title: str = "新对话",
                        scope_articles: list = None, scope_categories: list = None) -> int:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO chat_sessions (user_id, title, scope_articles, scope_categories, message_count)
        VALUES (%s,%s,%s,%s,0)
    """, (user_id, title, json.dumps(scope_articles or []), json.dumps(scope_categories or [])))
    conn.commit(); sid = cursor.lastrowid
    cursor.close(); conn.close()
    return sid


def list_chat_sessions(user_id: int = None) -> list:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    if user_id:
        cursor.execute("SELECT * FROM chat_sessions WHERE user_id=%s ORDER BY updated_at DESC", (user_id,))
    else:
        cursor.execute("SELECT * FROM chat_sessions ORDER BY updated_at DESC")
    rows = cursor.fetchall()
    for r in rows:
        for f in ("scope_articles", "scope_categories"):
            if isinstance(r.get(f), str): r[f] = json.loads(r[f])
    cursor.close(); conn.close()
    return rows


def get_chat_session(session_id: int) -> dict | None:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM chat_sessions WHERE id=%s", (session_id,))
    s = cursor.fetchone()
    if not s: cursor.close(); conn.close(); return None
    cursor.execute("SELECT * FROM chat_messages WHERE session_id=%s ORDER BY created_at", (session_id,))
    s["messages"] = cursor.fetchall()
    cursor.close(); conn.close()
    return s


def add_chat_message(session_id: int, role: str, content: str,
                    content_type: str = "text", attachments: list = None,
                    rag_trace: dict = None, citations: list = None,
                    token_count: int = 0) -> int:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO chat_messages (session_id, role, content, content_type, attachments,
            rag_trace, citations, token_count)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
    """, (session_id, role, content, content_type, json.dumps(attachments or []),
          json.dumps(rag_trace) if rag_trace else None,
          json.dumps(citations) if citations else None, token_count))
    cursor.execute("UPDATE chat_sessions SET message_count=message_count+1 WHERE id=%s", (session_id,))
    conn.commit(); mid = cursor.lastrowid
    cursor.close(); conn.close()
    return mid


def delete_chat_session(session_id: int) -> None:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("DELETE FROM chat_messages WHERE session_id=%s", (session_id,))
    cursor.execute("DELETE FROM chat_sessions WHERE id=%s", (session_id,))
    conn.commit(); cursor.close(); conn.close()


def rate_chat_message(message_id: int, rating: int, feedback: str = "") -> None:
    conn = get_conn(); cursor = conn.cursor()
    cursor.execute("UPDATE chat_messages SET rating=%s, feedback=%s WHERE id=%s",
                   (rating, feedback, message_id))
    conn.commit(); cursor.close(); conn.close()


# ─── Operation Log ──────────────────────────────────

def log_operation(user_id: int, user_name: str, action: str, target_type: str = "",
                  target_id: int = 0, details: dict = None, ip_address: str = "") -> None:
    try:
        conn = get_conn(); cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO operation_logs (user_id, user_name, action, target_type, target_id, details, ip_address)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, (user_id, user_name, action, target_type, target_id,
              json.dumps(details or {}), ip_address))
        conn.commit(); cursor.close(); conn.close()
    except Exception:
        pass  # Non-critical


# ─── System Stats ──────────────────────────────────

def get_system_stats() -> dict:
    conn = get_conn(); cursor = conn.cursor(dictionary=True)
    stats = {}
    cursor.execute("SELECT COUNT(*) as cnt FROM articles"); stats["totalArticles"] = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) as cnt FROM articles WHERE status='parsed'"); stats["parsedArticles"] = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) as cnt FROM articles WHERE is_in_knowledge_base=1"); stats["knowledgeBaseArticles"] = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) as cnt FROM chat_sessions"); stats["totalChatSessions"] = cursor.fetchone()["cnt"]
    cursor.execute("SELECT COUNT(*) as cnt FROM chat_messages"); stats["totalChatMessages"] = cursor.fetchone()["cnt"]
    cursor.close(); conn.close()
    return stats
