import json
from pathlib import Path
from typing import Any
import httpx
from .config import get_settings
from .db import connection, utc_now


def export_corpus() -> Path:
    settings = get_settings()
    target = settings.export_dir / "moonwitness-knowledge.ndjson"
    with connection() as db, target.open("w", encoding="utf-8") as handle:
        rows = db.execute("SELECT * FROM knowledge ORDER BY created_at").fetchall()
        for row in rows:
            record = dict(row)
            record["tags"] = json.loads(record.pop("tags_json"))
            record["entities"] = json.loads(record.pop("entities_json"))
            record["source_message_ids"] = json.loads(record.pop("source_message_ids_json"))
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return target


def sync_to_moonwitness(items: list[dict[str, Any]]) -> int:
    settings = get_settings()
    export_corpus()
    if not settings.moonwitness_sync_url or not items:
        return 0
    headers = {"Content-Type": "application/json"}
    if settings.moonwitness_sync_token:
        headers["Authorization"] = f"Bearer {settings.moonwitness_sync_token}"
    synced = 0
    with httpx.Client(timeout=60) as client:
        for offset in range(0, len(items), max(1, settings.moonwitness_batch_size)):
            batch = items[offset:offset + settings.moonwitness_batch_size]
            response = client.post(
                settings.moonwitness_sync_url,
                headers=headers,
                json={"source": "moonwitness-memory-bridge", "schema_version": 1, "records": batch},
            )
            response.raise_for_status()
            synced += len(batch)
    if synced:
        with connection() as db:
            db.executemany("UPDATE knowledge SET synced_at=? WHERE id=?",
                           [(utc_now(), item["id"]) for item in items])
    return synced
