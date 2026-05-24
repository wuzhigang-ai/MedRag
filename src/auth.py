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
