import json
from pathlib import Path
from typing import Any

import httpx

from .config import get_settings
from .db import connection, iter_knowledge_records, utc_now


def export_corpus() -> Path:
    """Write the complete knowledge corpus without loading it all into RAM."""
    settings = get_settings()
    settings.export_dir.mkdir(parents=True, exist_ok=True)
    target = settings.export_dir / "moonwitness-knowledge.ndjson"
    temporary = target.with_suffix(target.suffix + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            for record in iter_knowledge_records(batch_size=250):
                handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def sync_to_moonwitness(archive_id: str) -> int:
    """Push one archive to a configured receiver in bounded, retryable batches."""
    settings = get_settings()
    if not settings.moonwitness_sync_url:
        return 0

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if settings.moonwitness_sync_token:
        headers["Authorization"] = f"Bearer {settings.moonwitness_sync_token}"

    synced = 0
    batch: list[dict[str, Any]] = []
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        for record in iter_knowledge_records(archive_id=archive_id, batch_size=settings.moonwitness_batch_size):
            batch.append(record)
            if len(batch) < max(1, settings.moonwitness_batch_size):
                continue
            _send_batch(client, headers, batch)
            _mark_synced(batch)
            synced += len(batch)
            batch = []

        if batch:
            _send_batch(client, headers, batch)
            _mark_synced(batch)
            synced += len(batch)
    return synced


def _send_batch(client: httpx.Client, headers: dict[str, str], batch: list[dict[str, Any]]) -> None:
    response = client.post(
        get_settings().moonwitness_sync_url,
        headers=headers,
        json={
            "source": "moonwitness-memory",
            "schema_version": 1,
            "records": batch,
        },
    )
    response.raise_for_status()


def _mark_synced(batch: list[dict[str, Any]]) -> None:
    now = utc_now()
    with connection() as db:
        db.executemany(
            "UPDATE knowledge SET synced_at=? WHERE id=?",
            [(now, item["id"]) for item in batch],
        )
