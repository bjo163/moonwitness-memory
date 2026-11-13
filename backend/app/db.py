

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
    indexed = {message["message_id"]: message for message in messages}
    return {
        "knowledge_id": row["id"],
        "archive_id": row["archive_id"],
        "conversation_id": row["conversation_id"],
        "messages": [indexed[source_id] for source_id in source_ids if source_id in indexed],
    }
