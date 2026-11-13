import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from .config import get_settings


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connection():
    path = get_settings().db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=60000")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS archives (
            id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'queued', drive_status TEXT NOT NULL DEFAULT 'pending',
            drive_key TEXT, drive_error TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending', cursor INTEGER NOT NULL DEFAULT 0,
            processed_conversations INTEGER NOT NULL DEFAULT 0, total_conversations INTEGER,
            error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            message_id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            conversation_id TEXT NOT NULL, conversation_title TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(archive_id, conversation_id);
        CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            conversation_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]', entities_json TEXT NOT NULL DEFAULT '[]',
            source_message_ids_json TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 0.5,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge(kind);
        CREATE INDEX IF NOT EXISTS idx_knowledge_archive ON knowledge(archive_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(id UNINDEXED,title,summary,content,tokenize='unicode61');
        """)


def create_archive(file_name: str, file_path: str, size_bytes: int, sha256: str):
    with connection() as db:
        existing = db.execute("SELECT * FROM archives WHERE sha256=?", (sha256,)).fetchone()
        if existing:
            return dict(existing), False
        archive_id = str(uuid4())
        now = utc_now()
        db.execute("INSERT INTO archives(id,file_name,file_path,size_bytes,sha256,status,created_at) VALUES(?,?,?,?,?,'queued',?)",
                   (archive_id, file_name, file_path, size_bytes, sha256, now))
        job_id = str(uuid4())
        db.execute("INSERT INTO jobs(id,archive_id,status,created_at,updated_at) VALUES(?,?,'pending',?,?)",
                   (job_id, archive_id, now, now))
        return {"id": archive_id, "file_name": file_name, "size_bytes": size_bytes, "status": "queued", "job_id": job_id}, True


def claim_job():
    with connection() as db:
        row = db.execute("SELECT * FROM jobs WHERE status IN ('pending','retry') ORDER BY created_at LIMIT 1").fetchone()
        if not row:
            return None
        db.execute("UPDATE jobs SET status='processing',error=NULL,updated_at=? WHERE id=?", (utc_now(), row["id"]))
        return dict(row)


def update_job(job_id: str, **values: Any) -> None:
    allowed = {"status", "cursor", "processed_conversations", "total_conversations", "error"}
    pairs = [(key, value) for key, value in values.items() if key in allowed]
    pairs.append(("updated_at", utc_now()))
    assignments = ", ".join(f"{key}=?" for key, _ in pairs)
    with connection() as db:
        db.execute(f"UPDATE jobs SET {assignments} WHERE id=?", [value for _, value in pairs] + [job_id])


def update_archive(archive_id: str, **values: Any) -> None:
    allowed = {"status", "drive_status", "drive_key", "drive_error"}
    pairs = [(key, value) for key, value in values.items() if key in allowed]
    if pairs:
        assignments = ", ".join(f"{key}=?" for key, _ in pairs)
        with connection() as db:
            db.execute(f"UPDATE archives SET {assignments} WHERE id=?", [value for _, value in pairs] + [archive_id])


def save_messages(archive_id: str, conversation: dict[str, Any]) -> None:
    rows = [(message["id"], archive_id, conversation["id"], conversation["title"], message["role"], message["text"], message.get("created_at"))
            for message in conversation["messages"]]
    with connection() as db:
        db.executemany("INSERT OR IGNORE INTO messages(message_id,archive_id,conversation_id,conversation_title,role,content,created_at) VALUES(?,?,?,?,?,?,?)", rows)


def save_knowledge(archive_id: str, conversation_id: str, item: dict[str, Any]) -> None:
    import json
    now = utc_now()
    with connection() as db:
        db.execute("""
            INSERT INTO knowledge(id,archive_id,conversation_id,kind,title,summary,content,tags_json,entities_json,
                source_message_ids_json,confidence,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,content=excluded.content,
                tags_json=excluded.tags_json,entities_json=excluded.entities_json,
                source_message_ids_json=excluded.source_message_ids_json,confidence=excluded.confidence,updated_at=excluded.updated_at
        """, (item["id"], archive_id, conversation_id, item["kind"], item["title"], item.get("summary", ""),
              item.get("content", ""), json.dumps(item.get("tags", []), ensure_ascii=False),
              json.dumps(item.get("entities", []), ensure_ascii=False), json.dumps(item.get("source_message_ids", []), ensure_ascii=False),
              float(item.get("confidence", 0.5)), now, now))
        db.execute("DELETE FROM knowledge_fts WHERE id=?", (item["id"],))
        db.execute("INSERT INTO knowledge_fts(id,title,summary,content) VALUES(?,?,?,?)",
                   (item["id"], item["title"], item.get("summary", ""), item.get("content", "")))


def get_archive(archive_id: str):
    with connection() as db:
        row = db.execute("SELECT * FROM archives WHERE id=?", (archive_id,)).fetchone()
        return dict(row) if row else None


def list_rows(table: str, limit: int = 100):
    if table not in {"archives", "jobs", "knowledge"}:
        raise ValueError("Unsupported table")
    with connection() as db:
        rows = db.execute(f"SELECT * FROM {table} ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]


def dashboard_counts():
    with connection() as db:
        return {
            "archives": db.execute("SELECT COUNT(*) FROM archives").fetchone()[0],
            "messages": db.execute("SELECT COUNT(*) FROM messages").fetchone()[0],
            "knowledge": db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0],
            "active_jobs": db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('pending','processing','retry')").fetchone()[0],
            "failed_jobs": db.execute("SELECT COUNT(*) FROM jobs WHERE status='failed'").fetchone()[0],
        }


def search_knowledge(query: str, limit: int = 30):
    with connection() as db:
        try:
            rows = db.execute("SELECT k.* FROM knowledge_fts f JOIN knowledge k ON k.id=f.id WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?",
                              (query, limit)).fetchall()
        except sqlite3.OperationalError:
            rows = db.execute("SELECT * FROM knowledge WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? LIMIT ?",
                              (f"%{query}%", f"%{query}%", f"%{query}%", limit)).fetchall()
        return [dict(row) for row in rows]
