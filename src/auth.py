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
