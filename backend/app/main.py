import hashlib
import logging
import re
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import create_archive, dashboard_counts, init_db, list_rows, search_knowledge, update_job

log = logging.getLogger(__name__)
settings = get_settings()
app = FastAPI(title="MoonWitness Memory Bridge API", version="0.1.0",
              description="Local-first archive ingestion and AI knowledge extraction.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
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
    return search_knowledge(q.strip(), max(1, min(limit, 100)))


@app.post("/api/archives")
async def upload_archive(file: UploadFile = File(...)):
    settings.inbox_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file.filename or "archive.zip").name).strip(".-")
    safe_name = safe_name or "archive.zip"
    if Path(safe_name).suffix.lower() not in {".zip", ".json"}:
        raise HTTPException(status_code=415, detail="Only .zip ChatGPT exports and .json conversations files are supported")

    temp_path = settings.inbox_dir / f".{uuid4().hex}.upload"
    final_path = settings.inbox_dir / f"{uuid4().hex}-{safe_name}"
    digest = hashlib.sha256()
    size = 0
    try:
        with temp_path.open("wb") as output:
            while chunk := await file.read(8 * 1024 * 1024):
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
    finally:
        await file.close()


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    rows = list_rows("jobs", 5000)
    job = next((row for row in rows if row["id"] == job_id), None)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in {"awaiting_ai", "retry", "failed"}:
        raise HTTPException(status_code=409, detail=f"Job cannot be resumed from {job['status']}")
    update_job(job_id, status="pending", cursor=0, processed_conversations=0, error=None)
    return {"status": "queued", "job_id": job_id}
