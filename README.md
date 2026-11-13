# MOONWITNESS MEMORY BRIDGE

**Local-first archive intelligence. One personal cockpit. Your originals stay yours.**

MOONWITNESS MEMORY BRIDGE imports large AI conversation backups, stores the original files locally, extracts structured knowledge with cloud AI, indexes it locally, backs up originals to Google Drive through an S3-compatible gateway, and exports knowledge for MoonWitness ingestion.

This is a **single-user local application**. It is not a hosted service and does not require a VPS.

## Capabilities

- Imports ChatGPT ZIP exports containing conversations.json and standalone conversations.json.
- Streams uploads to disk and iterates conversations without loading the entire archive into RAM.
- Detects duplicate archives by SHA-256 and preserves originals unchanged.
- Extracts stories, lore, characters, events, ideas, projects, decisions, quotes, concepts and fragments with Gemini.
- Stores messages, knowledge and source message IDs in local SQLite.
- Uses SQLite FTS5 for full-text search and optional FastEmbed + LanceDB for local multilingual vector indexing.
- Uploads source archives to Google Drive through Rclone's experimental S3 gateway.
- Exports an NDJSON corpus and supports a configurable MoonWitness webhook.
- Checkpoints each completed conversation so interrupted jobs can resume.

## Quick start (Windows + Docker Desktop)

1. Install Docker Desktop and start it.
2. Copy .env.example to .env.
3. Add your Gemini key to GEMINI_API_KEY. Change S3_SECRET_KEY to a long random secret.
4. Start the local application:

       docker compose up --build -d

5. Open http://localhost:3000. API docs: http://localhost:8000/docs.

Without the Drive profile, local import and AI extraction still work. Drive backup is marked unavailable; the original stays in data/inbox.

## Enable Google Drive S3 gateway

1. Run PowerShell: .\scripts\setup-drive.ps1
2. Create an Rclone remote named gdrive using the Google Drive backend and complete browser OAuth.
3. Start the full stack:

       docker compose --profile drive up --build -d

S3 endpoint: http://127.0.0.1:9000. See docs/GOOGLE-DRIVE-S3.md for limitations.

## Configure Gemini

Set GEMINI_API_KEY in .env. The model is configurable through GEMINI_MODEL. Restart the API and worker after editing:

       docker compose up -d --force-recreate api worker

Only bounded message chunks are sent to Gemini. The original ZIP is never sent as one giant prompt.

## MoonWitness sync

The inspected MoonWitness codebase does not yet provide a dedicated knowledge-memory ingestion endpoint or collection. The bridge therefore always creates data/exports/moonwitness-knowledge.ndjson and supports a versioned JSON webhook using MOONWITNESS_SYNC_URL and MOONWITNESS_SYNC_TOKEN. Configure the webhook only after a real receiver exists; do not guess an endpoint.

## Data paths

- data/inbox: original uploaded archives.
- data/db: SQLite database.
- data/vectors: local embeddings and vector search index.
- data/exports: MoonWitness NDJSON corpus.
- data/rclone: Google Drive OAuth configuration.
- data/rclone-cache: Rclone VFS cache.

Back up the entire data/ directory. Never commit it.

## Useful commands

       docker compose logs -f worker
       docker compose ps
       docker compose down
       docker compose --profile drive up -d
