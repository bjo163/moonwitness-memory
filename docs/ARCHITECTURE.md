# Architecture

## Operating model

This is a personal application running on the user's computer through Docker Compose. Web, API and S3 ports bind to loopback only. No hosted SaaS, public deployment, VPS or multi-tenant layer is required.

- Next.js: local dashboard.
- FastAPI: archive upload, metadata, search and job control.
- Python worker: streaming import, Gemini extraction, local embeddings, Drive backup and MoonWitness export/webhook.
- SQLite + FTS5: local metadata, messages, provenance and full-text search.
- LanceDB + FastEmbed: local multilingual vector index.
- Rclone S3 gateway: optional experimental S3-compatible endpoint backed by Google Drive.
- Gemini: cloud AI only. Bounded conversation chunks are sent; raw archive files remain local and are copied to Drive when configured.

## Large archive behavior

The browser posts a File body directly to the API. FastAPI streams request chunks to a temporary file on the data volume while calculating SHA-256, then atomically renames it. This avoids multipart spooling plus a second disk copy. The worker opens ZIP members and iterates a top-level conversations array using ijson, holding one conversation in memory at a time. The parser never expands the full ZIP to disk.

Messages are inserted idempotently and each completed conversation is a checkpoint. A retry resumes from the last completed conversation. A long conversation that fails before its checkpoint may be repeated; extraction records use stable IDs to avoid duplicate knowledge rows. Gemini prompts are bounded by a character budget, which is a practical guard rather than an exact token limit.

The original upload is never modified. Duplicate archives are detected by SHA-256. MAX_UPLOAD_GB controls the API limit; effective capacity is constrained by disk space, ZIP structure, Drive quota, network and model limits.

## Data layout

- data/inbox: original uploaded source archives.
- data/db: SQLite database.
- data/vectors: local LanceDB vector index.
- data/models: local embedding model cache.
- data/exports: newline-delimited JSON corpus.
- data/rclone: private Rclone OAuth configuration.

Back up the full data directory. Never commit it.

## MoonWitness integration

The inspected MoonWitness PocketBase schema does not yet expose a dedicated knowledge-memory collection or documented ingestion contract. This app therefore always writes data/exports/moonwitness-knowledge.ndjson and supports an optional versioned JSON webhook via MOONWITNESS_SYNC_URL. Configure the webhook only after a real MoonWitness receiver exists; this avoids inventing a route or writing into an unrelated collection.

## Local security

- Published ports bind to 127.0.0.1.
- Keep .env and data/ out of Git.
- Use a long random S3 secret.
- Protect data/rclone/rclone.conf because it contains OAuth credentials.
- Gemini receives only selected transcript chunks when extraction is enabled. Exclude sensitive conversations before processing when required.
