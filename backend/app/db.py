import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'queued',
            drive_status TEXT NOT NULL DEFAULT 'pending',
            drive_key TEXT,
            drive_error TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            mode TEXT NOT NULL DEFAULT 'full',
            status TEXT NOT NULL DEFAULT 'pending',
            cursor INTEGER NOT NULL DEFAULT 0,
            processed_conversations INTEGER NOT NULL DEFAULT 0,
            total_conversations INTEGER,
            attempts INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            message_id TEXT NOT NULL,
            archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            conversation_id TEXT NOT NULL,
            conversation_title TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT,
            PRIMARY KEY (archive_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(archive_id, conversation_id);

        CREATE TABLE IF NOT EXISTS knowledge (
            id TEXT PRIMARY KEY,
            archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
            conversation_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            tags_json TEXT NOT NULL DEFAULT '[]',
            entities_json TEXT NOT NULL DEFAULT '[]',
            source_message_ids_json TEXT NOT NULL DEFAULT '[]',
            confidence REAL NOT NULL DEFAULT 0.5,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge(kind);
        CREATE INDEX IF NOT EXISTS idx_knowledge_archive ON knowledge(archive_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
            id UNINDEXED, title, summary, content, tokenize='unicode61'
        );
        """)

        # Forward-compatible additions if an older local database already exists.
        columns = {row["name"] for row in db.execute("PRAGMA table_info(jobs)").fetchall()}
        for name, definition in (
            ("mode", "TEXT NOT NULL DEFAULT 'full'"),
            ("attempts", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if name not in columns:
                db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")


def create_archive(file_name: str, file_path: str, size_bytes: int, sha256: str):
    with connection() as db:
        existing = db.execute("SELECT * FROM archives WHERE sha256=?", (sha256,)).fetchone()
        if existing:
            return dict(existing), False

        archive_id = str(uuid4())
        job_id = str(uuid4())
        now = utc_now()
        db.execute(
            "INSERT INTO archives(id,file_name,file_path,size_bytes,sha256,status,created_at) VALUES(?,?,?,?,?,'queued',?)",
            (archive_id, file_name, file_path, size_bytes, sha256, now),
        )
        db.execute(
            "INSERT INTO jobs(id,archive_id,mode,status,created_at,updated_at) VALUES(?,?,'full','pending',?,?)",
            (job_id, archive_id, now, now),
        )
        return {
            "id": archive_id,
            "file_name": file_name,
            "size_bytes": size_bytes,
            "status": "queued",
            "job_id": job_id,
        }, True


def create_backup_job(archive_id: str) -> str | None:
    with connection() as db:
        archive = db.execute("SELECT id FROM archives WHERE id=?", (archive_id,)).fetchone()
        if not archive:
            return None
        active = db.execute(
            """
            SELECT id FROM jobs
            WHERE archive_id=? AND mode='backup_only'
              AND status IN ('pending','processing','retry')
            """,
            (archive_id,),
        ).fetchone()
        if active:
            return str(active["id"])
        job_id = str(uuid4())
        now = utc_now()
        db.execute(
            "INSERT INTO jobs(id,archive_id,mode,status,created_at,updated_at) VALUES(?,?,'backup_only','pending',?,?)",
            (job_id, archive_id, now, now),
        )
        return job_id


def claim_job():
    """Atomically claim a job and recover workers abandoned for over ten minutes."""
    stale_before = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            """
            SELECT * FROM jobs
            WHERE status IN ('pending','retry')
               OR (status='processing' AND updated_at < ?)
            ORDER BY created_at LIMIT 1
            """,
            (stale_before,),
        ).fetchone()
        if not row:
            return None
        db.execute(
            "UPDATE jobs SET status='processing',attempts=attempts+1,error=NULL,updated_at=? WHERE id=?",
            (utc_now(), row["id"]),
        )
        claimed = db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone()
        return dict(claimed)


def update_job(job_id: str, **values: Any) -> None:
    allowed = {
        "mode", "status", "cursor", "processed_conversations",
        "total_conversations", "attempts", "error",
    }
    pairs = [(key, value) for key, value in values.items() if key in allowed]
    pairs.append(("updated_at", utc_now()))
    assignments = ", ".join(f"{key}=?" for key, _ in pairs)
    with connection() as db:
        db.execute(
            f"UPDATE jobs SET {assignments} WHERE id=?",
            [value for _, value in pairs] + [job_id],
        )


def update_archive(archive_id: str, **values: Any) -> None:
    allowed = {"status", "drive_status", "drive_key", "drive_error"}
    pairs = [(key, value) for key, value in values.items() if key in allowed]
    if pairs:
        assignments = ", ".join(f"{key}=?" for key, _ in pairs)
        with connection() as db:
            db.execute(
                f"UPDATE archives SET {assignments} WHERE id=?",
                [value for _, value in pairs] + [archive_id],
            )


def save_messages(archive_id: str, conversation: dict[str, Any]) -> None:
    rows = [
        (
            message["id"], archive_id, conversation["id"], conversation["title"],
            message["role"], message["text"], message.get("created_at"),
        )
        for message in conversation["messages"]
    ]
    with connection() as db:
        db.executemany(
            """
            INSERT OR IGNORE INTO messages(
                message_id,archive_id,conversation_id,conversation_title,role,content,created_at
            ) VALUES(?,?,?,?,?,?,?)
            """,
            rows,
        )


def save_knowledge(archive_id: str, conversation_id: str, item: dict[str, Any]) -> None:
    now = utc_now()
    with connection() as db:
        db.execute(
            """
            INSERT INTO knowledge(
                id,archive_id,conversation_id,kind,title,summary,content,tags_json,
                entities_json,source_message_ids_json,confidence,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, summary=excluded.summary, content=excluded.content,
                tags_json=excluded.tags_json, entities_json=excluded.entities_json,
                source_message_ids_json=excluded.source_message_ids_json,
                confidence=excluded.confidence, updated_at=excluded.updated_at
            """,
            (
                item["id"], archive_id, conversation_id, item["kind"], item["title"],
                item.get("summary", ""), item.get("content", ""),
                json.dumps(item.get("tags", []), ensure_ascii=False),
                json.dumps(item.get("entities", []), ensure_ascii=False),
                json.dumps(item.get("source_message_ids", []), ensure_ascii=False),
                float(item.get("confidence", 0.5)), now, now,
            ),
        )
        db.execute("DELETE FROM knowledge_fts WHERE id=?", (item["id"],))
        db.execute(
            "INSERT INTO knowledge_fts(id,title,summary,content) VALUES(?,?,?,?)",
            (item["id"], item["title"], item.get("summary", ""), item.get("content", "")),
        )


def get_archive(archive_id: str):
    with connection() as db:
        row = db.execute("SELECT * FROM archives WHERE id=?", (archive_id,)).fetchone()
        return dict(row) if row else None


def list_rows(table: str, limit: int = 100):
    if table not in {"archives", "jobs", "knowledge"}:
        raise ValueError("Unsupported table")
    with connection() as db:
        rows = db.execute(
            f"SELECT * FROM {table} ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(row) for row in rows]


def dashboard_counts():
    with connection() as db:
        return {
            "archives": db.execute("SELECT COUNT(*) FROM archives").fetchone()[0],
            "messages": db.execute("SELECT COUNT(*) FROM messages").fetchone()[0],
            "knowledge": db.execute("SELECT COUNT(*) FROM knowledge").fetchone()[0],
            "active_jobs": db.execute(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('pending','processing','retry')"
            ).fetchone()[0],
            "failed_jobs": db.execute("SELECT COUNT(*) FROM jobs WHERE status='failed'").fetchone()[0],
        }


def search_knowledge(query: str, limit: int = 30):
    with connection() as db:
        try:
            rows = db.execute(
                """
                SELECT k.* FROM knowledge_fts f
                JOIN knowledge k ON k.id=f.id
                WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?
                """,
                (query, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = db.execute(
                """
                SELECT * FROM knowledge
                WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? LIMIT ?
                """,
                (f"%{query}%", f"%{query}%", f"%{query}%", limit),
            ).fetchall()
        return [dict(row) for row in rows]



def get_knowledge_by_ids(ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    with connection() as db:
        rows = db.execute(
            f"SELECT * FROM knowledge WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
    indexed = {row["id"]: dict(row) for row in rows}
    return [indexed[item_id] for item_id in ids if item_id in indexed]

def decode_knowledge_row(row: Any) -> dict[str, Any]:
    """Return the stable public knowledge shape without leaking storage JSON columns."""
    item = dict(row)
    for source, target in (
        ("tags_json", "tags"),
        ("entities_json", "entities"),
        ("source_message_ids_json", "source_message_ids"),
    ):
        raw = item.pop(source, "[]")
        try:
            item[target] = json.loads(raw or "[]")
        except (TypeError, json.JSONDecodeError):
            item[target] = []
    return item


def iter_knowledge_records(archive_id: str | None = None, batch_size: int = 250):
    """Iterate knowledge using keyset pagination and short-lived DB connections.

    This avoids retaining a whole archive's extracted corpus in memory or keeping
    a SQLite read transaction open while a remote webhook is being called.
    """
    size = max(1, min(int(batch_size), 1000))
    last_id = ""
    while True:
        with connection() as db:
            if archive_id:
                rows = db.execute(
                    "SELECT * FROM knowledge WHERE archive_id=? AND id>? ORDER BY id LIMIT ?",
                    (archive_id, last_id, size),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT * FROM knowledge WHERE id>? ORDER BY id LIMIT ?",
                    (last_id, size),
                ).fetchall()
        if not rows:
            break
        for row in rows:
            yield decode_knowledge_row(row)
        last_id = str(rows[-1]["id"])


def get_knowledge_sources(knowledge_id: str) -> dict[str, Any] | None:
    """Resolve a knowledge node back to its original source messages."""
    with connection() as db:
        row = db.execute(
            "SELECT id,archive_id,conversation_id,source_message_ids_json FROM knowledge WHERE id=?",
            (knowledge_id,),
        ).fetchone()
        if not row:
            return None
        try:
            source_ids = json.loads(row["source_message_ids_json"] or "[]")
        except (TypeError, json.JSONDecodeError):
            source_ids = []
        source_ids = [str(value) for value in source_ids if value]
        messages: list[dict[str, Any]] = []
        for offset in range(0, len(source_ids), 900):
            batch = source_ids[offset:offset + 900]
            if not batch:
                continue
            placeholders = ",".join("?" for _ in batch)
            found = db.execute(
                f"SELECT message_id,conversation_id,conversation_title,role,content,created_at "
                f"FROM messages WHERE archive_id=? AND message_id IN ({placeholders})",
                [row["archive_id"], *batch],
            ).fetchall()
            messages.extend(dict(message) for message in found)
        result = {
            "knowledge_id": row["id"],
            "archive_id": row["archive_id"],
            "conversation_id": row["conversation_id"],
        }
    indexed = {message["message_id"]: message for message in messages}
    return {
        **result,
        "messages": [indexed[source_id] for source_id in source_ids if source_id in indexed],
    }
