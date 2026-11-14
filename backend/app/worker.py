import logging
import time
from pathlib import Path
from typing import Any

from .ai import GeminiExtractor
from .archive import chunk_messages, iter_conversations
from .config import get_settings
from .db import (
    claim_job, create_sync_job, get_archive, init_db, save_knowledge, save_messages,
    update_archive, update_job,
)
from .embeddings import index_knowledge
from .moonwitness import export_corpus, sync_to_moonwitness
from .storage import upload_archive

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("memory-worker")
MAX_ATTEMPTS = 5


def backup_source_archive(archive: dict[str, Any]) -> None:
    path = Path(archive["file_path"])
    key = f"archives/{archive['id']}/{archive['file_name']}"
    uri = upload_archive(path, key)
    update_archive(archive["id"], drive_status="uploaded", drive_key=uri, drive_error=None)
    log.info("Archive backed up to %s", uri)


def process_job(job: dict[str, Any]) -> None:
    settings = get_settings()
    archive = get_archive(job["archive_id"])
    if not archive:
        raise RuntimeError("Archive record no longer exists")
    if job.get("mode") == "sync_only":
        synced = sync_to_moonwitness(archive["id"])
        update_job(job["id"], status="complete", error=None)
        log.info("Synced %s knowledge records for archive %s", synced, archive["id"])
        return

    path = Path(archive["file_path"])
    if not path.is_file():
        raise FileNotFoundError(f"Archive file is missing: {path}")

    if job.get("mode") == "backup_only":
        try:
            backup_source_archive(archive)
            update_job(job["id"], status="complete", error=None)
            return
        except Exception as exc:
            update_archive(archive["id"], drive_status="error", drive_error=str(exc)[:1000])
            raise

    if archive["drive_status"] != "uploaded":
        try:
            backup_source_archive(archive)
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
        update_job(
            job["id"],
            cursor=index + 1,
            processed_conversations=index + 1,
            total_conversations=max(total, processed),
            status="processing",
        )

    if total == 0:
        raise ValueError("No ChatGPT conversations found in this archive")
    update_job(job["id"], total_conversations=total)

    if settings.moonwitness_sync_url:
        sync_job_id = create_sync_job(archive["id"])
        if sync_job_id:
            log.info("Queued MoonWitness delivery job %s", sync_job_id)

    export_corpus()
    update_archive(archive["id"], status="complete")
    update_job(
        job["id"], status="complete", cursor=total,
        processed_conversations=total, total_conversations=total, error=None,
    )
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
            attempts = int(job.get("attempts") or 1)
            if attempts >= MAX_ATTEMPTS:
                update_job(job["id"], status="failed", error=str(exc)[:2000])
                if job.get("mode") != "backup_only":
                    update_archive(job["archive_id"], status="failed")
            else:
                update_job(job["id"], status="retry", error=str(exc)[:2000])
                # Avoid hammering Gemini/Drive during an outage; the job remains resumable.
                time.sleep(min(60, 2 ** min(attempts, 6)))


if __name__ == "__main__":
    main()
