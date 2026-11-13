import hashlib
import logging
import re
from pathlib import Path
from urllib.parse import unquote
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import get_settings
from .db import (
    create_archive, create_backup_job, dashboard_counts, decode_knowledge_row,
    get_knowledge_by_ids, get_knowledge_sources, init_db, list_rows,
    search_knowledge, update_job,
)
from .embeddings import search_vectors
from .moonwitness import export_corpus

log = logging.getLogger(__name__)
settings = get_settings()
app = FastAPI(
    title="MoonWitness Memory API",
    version="0.2.0",
    description="Local-first archive ingestion, traceable knowledge extraction and export.",
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


@app.get("/api/system")
def system_status():
    drive_config = settings.data_dir / "rclone" / "rclone.conf"
    return {
        "mode": "local-first",
        "gemini_configured": bool(settings.gemini_api_key),
        "gemini_model": settings.gemini_model,
        "embeddings_enabled": settings.enable_embeddings,
        "embedding_model": settings.embedding_model if settings.enable_embeddings else None,
        "drive_configured": drive_config.is_file(),
        "moonwitness_sync_configured": bool(settings.moonwitness_sync_url),
        "max_upload_gb": settings.max_upload_gb,
    }


@app.get("/api/dashboard")
def dashboard():
    return dashboard_counts()


@app.get("/api/archives")
def archives(limit: int = 100):
    rows = list_rows("archives", max(1, min(limit, 500)))
    # Never expose container filesystem paths to dashboard/API consumers.
    fields = ("id", "file_name", "size_bytes", "sha256", "status", "drive_status", "drive_key", "drive_error", "created_at")
    return [{key: row.get(key) for key in fields} for row in rows]


@app.get("/api/jobs")
def jobs(limit: int = 100):
    return list_rows("jobs", max(1, min(limit, 500)))


@app.get("/api/knowledge")
def knowledge(limit: int = 100):
    rows = list_rows("knowledge", max(1, min(limit, 500)))
    return [decode_knowledge_row(row) for row in rows]


@app.get("/api/knowledge/{knowledge_id}/sources")
def knowledge_sources(knowledge_id: str):
    result = get_knowledge_sources(knowledge_id)
    if not result:
        raise HTTPException(status_code=404, detail="Knowledge record not found")
    return result


@app.get("/api/search")
def search(q: str, limit: int = 30):
    if not q.strip():
        raise HTTPException(status_code=400, detail="Search query is required")
    bounded_limit = max(1, min(limit, 100))
    keyword_results = [
        decode_knowledge_row(row)
        for row in search_knowledge(q.strip(), bounded_limit)
    ]
    seen = {row["id"] for row in keyword_results}
    vector_ids = [item_id for item_id in search_vectors(q.strip(), bounded_limit) if item_id not in seen]
    semantic_results = [
        decode_knowledge_row(row)
        for row in get_knowledge_by_ids(vector_ids[: max(0, bounded_limit - len(keyword_results))])
    ]
    return keyword_results + semantic_results


@app.get("/api/export.ndjson")
def download_knowledge_export():
    """MoonWitness and other clients can pull the full corpus as streamed NDJSON."""
    path = export_corpus()
    return FileResponse(
        path,
        media_type="application/x-ndjson",
        filename="moonwitness-knowledge.ndjson",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/archives")
async def upload_archive(request: Request):
    """Stream raw request bytes to disk; avoids multipart temp-file duplication."""
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    raw_name = request.headers.get("x-archive-filename", "archive.zip")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(unquote(raw_name)).name).strip(".-")
    safe_name = safe_name or "archive.zip"
    if Path(safe_name).suffix.lower() not in {".zip", ".json"}:
        raise HTTPException(status_code=415, detail="Only .zip ChatGPT exports and standalone conversations.json files are supported")

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
            return {"duplicate": True, "archive": {key: existing.get(key) for key in ("id", "file_name", "size_bytes", "status", "drive_status", "created_at")}}

        temp_path.replace(final_path)
        archive, created = create_archive(safe_name, str(final_path), size, sha)
        if not created:
            final_path.unlink(missing_ok=True)
            public_fields = ("id", "file_name", "size_bytes", "status", "drive_status", "created_at")
            return {"duplicate": True, "archive": {key: archive.get(key) for key in public_fields}}
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
    if not job_id:
        raise HTTPException(status_code=404, detail="Archive not found")
    return {"status": "queued", "archive_id": archive_id, "job_id": job_id}


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    rows = list_rows("jobs", 5000)
    job = next((row for row in rows if row["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in {"awaiting_ai", "retry", "failed"}:
        raise HTTPException(status_code=409, detail=f"Job cannot be resumed from {job['status']}")
    # Preserve the checkpoint so retries do not repeat completed conversations.
    update_job(job_id, status="pending", attempts=0, error=None)
    return {"status": "queued", "job_id": job_id}
