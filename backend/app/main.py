import hashlib
import logging
import re
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .embeddings import search_vectors
from .db import (
    create_archive, create_backup_job, dashboard_counts, get_knowledge_by_ids,
    init_db, list_rows, search_knowledge, update_job,
)

log = logging.getLogger(__name__)
settings = get_settings()
app = FastAPI(
    title="MoonWitness Memory Bridge API",
    version="0.1.1",
    description="Local-first archive ingestion and AI knowledge extraction.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Archive-Filename"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "mode": "local-first"}


@app.get("/api/dashboard")
def dashboard():
    return dashboard_counts()


@app.get("/api/archives")
def archives(limit: int = 100):
    return list_rows("archives", max(1, min(limit, 500)))


@app.get("/api/jobs")
def jobs(limit: int = 100):
    return list_rows("jobs", max(1, min(limit, 500)))


@app.get("/api/knowledge")
def knowledge(limit: int = 100):
    import json
    rows = list_rows("knowledge", max(1, min(limit, 500)))
    for row in rows:
        row["tags"] = json.loads(row.pop("tags_json"))
        row["entities"] = json.loads(row.pop("entities_json"))
        row["source_message_ids"] = json.loads(row.pop("source_message_ids_json"))
    return rows


@app.get("/api/search")
def search(q: str, limit: int = 30):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required")
    bounded_limit = max(1, min(limit, 100))
    keyword_results = search_knowledge(q.strip(), bounded_limit)
    seen = {row["id"] for row in keyword_results}
    vector_ids = [item_id for item_id in search_vectors(q.strip(), bounded_limit) if item_id not in seen]
    semantic_results = get_knowledge_by_ids(vector_ids[: max(0, bounded_limit - len(keyword_results))])
    return keyword_results + semantic_results


@app.post("/api/archives")
async def upload_archive(request: Request):
    """Stream raw request bytes to disk; avoids multipart temp-file duplication."""
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    raw_name = request.headers.get("x-archive-filename", "archive.zip")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(unquote(raw_name)).name).strip(".-")
    safe_name = safe_name or "archive.zip"
    if Path(safe_name).suffix.lower() not in {".zip", ".json"}:
        raise HTTPException(status_code=415, detail="Only .zip ChatGPT exports and .json conversations files are supported")

    temp_path = settings.inbox_dir / f".{uuid4().hex}.upload"
    final_path = settings.inbox_dir / f"{uuid4().hex}-{safe_name}"
    digest = hashlib.sha256()
    size = 0
    try:
        with temp_path.open("wb") as output:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail=f"Archive exceeds configured limit ({settings.max_upload_gb} GB)")
                digest.update(chunk)
                output.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        sha = digest.hexdigest()
        existing = next((row for row in list_rows("archives", 5000) if row["sha256"] == sha), None)
        if existing:
            temp_path.unlink(missing_ok=True)
            return {"duplicate": True, "archive": existing}

        temp_path.replace(final_path)
        archive, created = create_archive(safe_name, str(final_path), size, sha)
        if not created:
            final_path.unlink(missing_ok=True)
            return {"duplicate": True, "archive": archive}
        archive["sha256"] = sha
        return {"duplicate": False, "archive": archive, "message": "Archive queued for background processing"}
    except HTTPException:
        temp_path.unlink(missing_ok=True)
        raise
    except Exception:
        temp_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        log.exception("Archive upload failed")
        raise HTTPException(status_code=500, detail="Archive upload failed")


@app.post("/api/archives/{archive_id}/backup")
def backup_archive(archive_id: str):
    archive = next((row for row in list_rows("archives", 5000) if row["id"] == archive_id), None)
    if not archive:
        raise HTTPException(status_code=404, detail="Archive not found")
    if archive["drive_status"] == "uploaded":
        return {"status": "already_uploaded", "archive_id": archive_id}
    job_id = create_backup_job(archive_id)
    return {"status": "queued", "archive_id": archive_id, "job_id": job_id}


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    rows = list_rows("jobs", 5000)
    job = next((row for row in rows if row["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in {"awaiting_ai", "retry", "failed"}:
        raise HTTPException(status_code=409, detail=f"Job cannot be resumed from {job['status']}")
    # Preserve the checkpoint so retries do not repeat already completed conversations.
    update_job(job_id, status="pending", attempts=0, error=None)
    return {"status": "queued", "job_id": job_id}
