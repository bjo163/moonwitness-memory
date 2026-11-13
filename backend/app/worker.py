import json
import logging
import time
from pathlib import Path
from typing import Any

from .ai import GeminiExtractor
from .archive import chunk_messages, iter_conversations
from .config import get_settings
from .db import claim_job, connection, get_archive, init_db, save_knowledge, save_messages, update_archive, update_job
from .embeddings import index_knowledge
from .moonwitness import export_corpus, sync_to_moonwitness
from .storage import upload_archive

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("memory-worker")


def load_knowledge_for_archive(archive_id: str) -> list[dict[str, Any]]:
    with connection() as db:
        rows = db.execute("SELECT * FROM knowledge WHERE archive_id=?", (archive_id,)).fetchall()
    output = []
    for row in rows:
        item = dict(row)
        item["tags"] = json.loads(item.pop("tags_json"))
        item["entities"] = json.loads(item.pop("entities_json"))
        item["source_message_ids"] = json.loads(item.pop("source_message_ids_json"))
        output.append(item)
    return output


def process_job(job: dict[str, Any]) -> None:
    settings = get_settings()
    archive = get_archive(job["archive_id"])
    if not archive:
        raise RuntimeError("Archive record no longer exists")
    path = Path(archive["file_path"])
    if not path.is_file():
        raise FileNotFoundError(f"Archive file is missing: {path}")

    if archive["drive_status"] != "uploaded":
        try:
            key = f"archives/{archive['id']}/{archive['file_name']}"
            uri = upload_archive(path, key)
            update_archive(archive["id"], drive_status="uploaded", drive_key=uri, drive_error=None)
            log.info("Archive backed up to %s", uri)
        except Exception as exc:
            update_archive(archive["id"], drive_status="error", drive_error=str(exc)[:1000])
            log.warning("Drive/S3 backup failed; local original is preserved: %s", exc)

    if not settings.gemini_api_key:
        update_archive(archive["id"], status="awaiting_ai")
        update_job(job["id"], status="awaiting_ai", error="Set GEMINI_API_KEY in .env, then press Resume")
        return

    update_archive(archive["id"], status="processing")
    extractor = GeminiExtractor(settings.gemini_api_key, settings.gemini_model)
    processed = int(job.get("cursor") or 0)
    total = 0
    for index, conversation in enumerate(iter_conversations(path)):
        total = index + 1
        if index < processed:
            continue
        save_messages(archive["id"], conversation)
        extracted: list[dict[str, Any]] = []
        for chunk in chunk_messages(conversation["messages"], settings.ai_chunk_chars):
            records = extractor.extract(conversation, chunk)
            for record in records:
                save_knowledge(archive["id"], conversation["id"], record)
                extracted.append(record)
        if extracted:
            index_knowledge(extracted)
        update_job(job["id"], cursor=index + 1, processed_conversations=index + 1,
                   total_conversations=max(total, processed), status="processing")

    if total == 0:
        raise ValueError("No ChatGPT conversations found in this archive")
    update_job(job["id"], total_conversations=total)
    current_items = load_knowledge_for_archive(archive["id"])
    try:
        synced = sync_to_moonwitness(current_items)
        if synced:
            log.info("Synced %s knowledge records to MoonWitness receiver", synced)
    except Exception:
        log.exception("MoonWitness webhook sync failed; local NDJSON export remains available")
    export_corpus()
    update_archive(archive["id"], status="complete")
    update_job(job["id"], status="complete", cursor=total, processed_conversations=total,
               total_conversations=total, error=None)
    log.info("Completed archive %s (%s conversations)", archive["file_name"], total)


def main() -> None:
    init_db()
    log.info("Memory worker started")
    while True:
        job = claim_job()
        if not job:
            time.sleep(3)
            continue
        try:
            process_job(job)
        except Exception as exc:
            log.exception("Job %s failed", job["id"])
            update_job(job["id"], status="retry", error=str(exc)[:2000])


if __name__ == "__main__":
    main()
