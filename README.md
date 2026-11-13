# MOONWITNESS MEMORY BRIDGE

**Local-first archive intelligence. One personal cockpit. Your originals stay yours.**

MOONWITNESS MEMORY BRIDGE imports large AI conversation backups, stores the original files locally, extracts structured knowledge with cloud AI, indexes it locally, backs up originals to Google Drive through an S3-compatible gateway, and exports knowledge for MoonWitness ingestion.

This is a **single-user local application**. It is not a hosted service and does not require a VPS.

## Capabilities

- Imports ChatGPT ZIP exports containing conversations.json and standalone conversations.json.
- Streams the browser upload body directly to disk; avoids a second multipart temporary copy.
- Streams JSON parsing and processes one conversation at a time.
- Detects duplicate archives by SHA-256 and preserves originals unchanged.
- Extracts stories, lore, characters, events, ideas, projects, decisions, quotes, concepts and fragments with Gemini.
- Stores messages, knowledge and source message IDs in local SQLite.
- Uses SQLite FTS5 for full-text search and FastEmbed + LanceDB for local multilingual vector indexing.
- Uploads source archives to Google Drive through Rclone's experimental S3 gateway.
- Exports an NDJSON corpus and supports a configurable MoonWitness webhook.
- Checkpoints after each completed conversation, recovers stale jobs and resumes from the last checkpoint.
- Re-queues Drive-only backups for an archive imported before Google Drive was configured.

## Quick start (Windows + Docker Desktop)

1. Install Docker Desktop and start it.
2. Double-click `start.bat`. On first run it creates `.env` and opens it in Notepad.
3. Add your Gemini key to `GEMINI_API_KEY` and replace `S3_SECRET_KEY` with a long random secret.
4. Save `.env`, then double-click `start.bat` again.
5. Open http://localhost:3000. API docs: http://localhost:8000/docs.

Optional command-line equivalent:

       docker compose up --build -d

Use `stop.bat` to stop the app and `logs.bat` to follow container logs. These commands never delete the local `data/` directory.

This starts the local archive pipeline. If Google Drive is not configured, source files remain safe in data/inbox and Drive status shows an error/pending state. Configure Drive later and press BACKUP on an archive.

## Enable Google Drive S3 gateway

1. Double-click `start-drive.bat`; it opens the Rclone configuration wizard when Drive has not been configured yet.
2. Create an Rclone remote named `gdrive` using the Google Drive backend and complete browser OAuth.
3. The launcher starts the full Compose stack with the Drive profile.

PowerShell/manual equivalent:

       .\scripts\setup-drive.ps1
       docker compose --profile drive up --build -d

S3 endpoint: http://127.0.0.1:9000. The worker connects to it over the private Compose network. See docs/GOOGLE-DRIVE-S3.md for compatibility limits.

## Configure Gemini

Set GEMINI_API_KEY in .env. The default model is gemini-3.8-flash; change it through GEMINI_MODEL whenever you want. Restart the API and worker after editing:

       docker compose up -d --force-recreate api worker

Only bounded message chunks are sent to Gemini. The original ZIP is never sent as one giant prompt. Review sensitive archives before enabling cloud extraction.

## MoonWitness sync

The inspected MoonWitness codebase does not yet provide a dedicated knowledge-memory ingestion endpoint or collection. The bridge therefore always creates data/exports/moonwitness-knowledge.ndjson and supports a versioned JSON webhook using MOONWITNESS_SYNC_URL and MOONWITNESS_SYNC_TOKEN. Configure the webhook only after a real receiver exists; do not guess an endpoint.

## Data paths

- data/inbox: original uploaded archives.
- data/db: SQLite database.
- data/vectors: local LanceDB vector index.
- data/models: downloaded local embedding model cache.
- data/exports: MoonWitness NDJSON corpus.
- data/rclone: Google Drive OAuth configuration.

Back up the entire data/ directory. Never commit it.

## Useful commands

       docker compose logs -f worker
       docker compose ps
       docker compose down
       docker compose --profile drive up -d
