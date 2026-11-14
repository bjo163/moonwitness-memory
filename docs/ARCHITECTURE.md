# Architecture

## Operating model

MoonWitness Memory is a standalone, single-user application running on the user's computer through Docker Compose. It does not depend on the MoonWitness application, database schema or ORM. Web, API and optional S3 ports bind to loopback only.

- **Next.js** — local dashboard.
- **FastAPI** — streamed archive upload, system status, job control, search, provenance and export.
- **Python worker** — incremental import, Gemini extraction, local embedding indexing, optional Drive backup and optional webhook delivery.
- **SQLite + FTS5** — archive metadata, messages, job checkpoints, knowledge records and full-text search.
- **LanceDB + FastEmbed** — local multilingual vector index.
- **Rclone S3 gateway** — optional experimental S3-compatible endpoint backed by a Google Drive remote.
- **Gemini API** — optional cloud extraction. Only bounded text chunks are sent.

## Large archive behavior

The browser sends a File body directly to the API. FastAPI streams request chunks to a temporary file on the data volume while calculating SHA-256, then atomically renames it. This avoids multipart spooling plus a second disk copy.

The worker opens ZIP members and iterates the top-level conversations array using ijson. It does not extract the full ZIP to disk. One conversation is materialized at a time; its messages are chunked into bounded contexts before AI extraction. A pathological single conversation can still require substantial memory, so available RAM and archive structure remain practical limits.

Messages are inserted idempotently. Each completed conversation becomes a job checkpoint. A retry resumes from the last completed conversation. A conversation that fails before its checkpoint may be repeated; extracted knowledge IDs are stable, preventing duplicate rows.

The original upload is never modified. Duplicate archives are detected by SHA-256. `MAX_UPLOAD_GB` controls the API body limit; practical capacity is constrained by local storage, a single conversation's size, ZIP structure, Drive quota, network and model limits.

## Knowledge contract

Each knowledge record retains:
- stable record ID and type/kind;
- title, summary and content;
- tags and entities;
- confidence;
- archive and conversation IDs;
- original source message IDs;
- creation/update timestamps and optional sync timestamp.

The `/api/knowledge/{id}/sources` endpoint resolves source message IDs back to the original message text. `/api/export.ndjson` streams the entire knowledge corpus. MoonWitness can pull and ingest this data later without sharing a database or ORM.

An optional webhook sends versioned batches only when `MOONWITNESS_SYNC_URL` and `MOONWITNESS_SYNC_TOKEN` are configured. Delivery is a separate `sync_only` job with the same retry policy as archive jobs. Extraction completion is not coupled to remote availability. The receiver must upsert by stable knowledge ID because a retry can resend batches already accepted before a later batch failed. No endpoint is assumed or hardcoded for MoonWitness.

## Google Drive path

The Drive profile starts `rclone serve s3` against a Google Drive remote. The worker uses the internal Compose endpoint and Boto3 multipart uploads. Rclone's S3 server is experimental and supports common object-storage operations, not the complete AWS S3 contract. This is only an archive-backup adapter, not a general S3 service.

The local gateway is optional. Without it, archive ingestion and extraction continue and local originals are retained.

## Data layout

- `data/inbox` — original source archives.
- `data/db` — SQLite database.
- `data/vectors` — local LanceDB vector index.
- `data/models` — local embedding model cache.
- `data/exports` — NDJSON corpus.
- `data/rclone` — private Rclone OAuth configuration.

Back up the full data directory. Stop the Compose stack before a manual copy to keep SQLite files consistent.

## Local security

- Published ports bind to `127.0.0.1`.
- There is no login in the single-user local API; do not publish it to LAN or internet.
- Keep `.env` and `data/rclone/rclone.conf` private.
- Use a long random S3 secret.
- Gemini receives selected transcript text chunks when extraction is enabled.
- Embeddings run locally.
