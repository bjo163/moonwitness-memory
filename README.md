# MOONWITNESS MEMORY

**Local-first archive intelligence. Keep the originals. Extract what matters.**

MoonWitness Memory is a standalone, single-user knowledge engine for AI conversation archives. It runs on your own Windows machine with Docker Compose. MoonWitness can consume its knowledge later through a documented REST API or NDJSON export; this repository does not depend on MoonWitness internals or its database.

## Interface DNA

The dashboard uses **ARCHIVE RIOT**: underground archive-room energy, manga-inspired vector artwork, industrial telemetry, neobrutalist panels and a complete dark/light theme. The command deck includes scroll-aware navigation, real archive upload progress, integration/job status cues, searchable and filterable knowledge with incremental loading, and an accessible provenance reader. See [Brand DNA](docs/BRAND-DNA.md).

## What it does

- Imports ChatGPT ZIP exports and standalone `conversations.json` files.
- Streams the browser upload to disk, calculates SHA-256, and preserves the original archive unchanged.
- Parses the export incrementally and processes one conversation at a time.
- Extracts durable stories, lore, characters, events, ideas, projects, decisions, quotes, concepts and entities with Gemini.
- Stores messages, knowledge and source-message provenance in SQLite.
- Provides full-text search with SQLite FTS5 and local multilingual semantic search with FastEmbed + LanceDB.
- Backs up original archives to Google Drive through Rclone's experimental S3-compatible gateway.
- Checkpoints completed conversations and resumes failed or paused jobs.
- Exposes REST/OpenAPI endpoints, source provenance and a streamed NDJSON corpus export.

This is a local utility, not a hosted service. The web dashboard, API and optional S3 gateway bind to loopback by default.

## Quick start — Windows

Requirements: Windows 10/11, Docker Desktop with the Linux container engine, and an internet connection for container/model downloads.

1. Clone this repository and open its folder.
2. Double-click `start.bat`. On first launch it creates `.env` and opens it in Notepad.
3. Add your Gemini API key to `GEMINI_API_KEY`. Keep the rest of the defaults initially. Save the file.
4. Double-click `start.bat` again. Docker builds and starts the local stack.
5. Open **http://localhost:3000**. API documentation is at **http://localhost:8000/docs**.

You can also start it in PowerShell:

```powershell
Copy-Item .env.example .env   # first run only
notepad .env                  # add GEMINI_API_KEY
docker compose up --build -d
```

The first build downloads Python and Node dependencies. The first semantic-index operation downloads the multilingual embedding model into `data/models`.

### Without a Gemini key

Import still stores the original archive locally. Its extraction job moves to `awaiting_ai`; it does not discard the upload. Add `GEMINI_API_KEY`, recreate the API and worker, then press **RESUME** on the waiting job:

```powershell
docker compose up -d --force-recreate api worker
```

## Google Drive backup

Google Drive is optional. Local import and extraction work without it.

1. Start the base stack once so that `.env` exists.
2. Replace `S3_ACCESS_KEY` and `S3_SECRET_KEY` in `.env` with private values.
3. Double-click `start-drive.bat`.
4. In the Rclone configuration wizard, create a remote named `gdrive`, select Google Drive, and complete OAuth.
5. When the stack is running, use **BACKUP** beside an archive in the dashboard.

The local S3-compatible endpoint is **http://127.0.0.1:9000**. Inside Docker Compose, the worker uses `http://rclone-s3:9000`. The gateway writes to the `MOONWITNESS-MEMORY` folder in the configured Drive remote.

**Important:** Rclone's `serve s3` is explicitly experimental. It implements common object operations and multipart uploads, not every AWS S3 feature. This integration is designed for a personal archive backup path, not as a general production S3 replacement. See [Google Drive S3 notes](docs/GOOGLE-DRIVE-S3.md).

PowerShell alternative:

```powershell
.\scripts\setup-drive.ps1
docker compose --profile drive up --build -d
```

Without a configured Drive remote, the archive remains in `data/inbox`. A Drive failure never deletes the local original. After Drive has been configured, use **BACKUP** to queue a backup-only retry.

## Large archive handling

- The browser sends the file body directly; the API streams it to a temporary file and then renames it.
- The API enforces `MAX_UPLOAD_GB` while bytes arrive. Default: 500 GB.
- SHA-256 is calculated during upload for duplicate detection.
- ZIP members are read as streams. The parser does not expand the entire ZIP into another directory.
- One conversation is materialized at a time; message content is split into bounded chunks before it is sent to Gemini.
- The worker stores a checkpoint after each completed conversation. Retries continue from that checkpoint.
- Source archives are never sent to Gemini as one giant prompt.

Practical capacity still depends on disk space, ZIP structure, the size of a single conversation, network, Google Drive quota and Gemini API limits. Keep sufficient free disk space. Review sensitive archives before enabling cloud extraction: only bounded text chunks are sent to Gemini, but those chunks do leave the computer.

## Dashboard and API

| Endpoint | Purpose |
|---|---|
| `GET /health` | API health |
| `GET /api/system` | Local configuration status without exposing secrets |
| `GET /api/dashboard` | Archive/message/knowledge/job counts |
| `GET /api/archives` | Imported archives and Drive status |
| `POST /api/archives` | Stream a ZIP or JSON upload |
| `POST /api/archives/{id}/backup` | Queue a Drive backup |
| `GET /api/jobs` | Processing queue and checkpoints |
| `POST /api/jobs/{id}/resume` | Resume a waiting or failed job |
| `GET /api/knowledge` | Extracted knowledge records |
| `GET /api/knowledge/{id}/sources` | Original messages behind a knowledge record |
| `GET /api/search?q=...` | Hybrid keyword + semantic search |
| `GET /api/export.ndjson` | Stream the full knowledge corpus for another system |

OpenAPI UI: **http://localhost:8000/docs**. Full request/response details and the future-consumer contract are in [API.md](docs/API.md).

MoonWitness integration stays decoupled. The reliable handoff today is `GET /api/export.ndjson`; an optional webhook can be configured with `MOONWITNESS_SYNC_URL` and `MOONWITNESS_SYNC_TOKEN` only when a real receiving endpoint exists. Do not guess or point it at an unrelated MoonWitness route.

## Data and backup

All persistent data lives under `data/`:

- `data/inbox` — original uploaded archives.
- `data/db` — SQLite database and WAL files.
- `data/vectors` — LanceDB semantic index.
- `data/models` — locally downloaded embedding model.
- `data/exports` — NDJSON corpus export.
- `data/rclone` — Google Drive OAuth configuration.

Back up the entire `data/` directory. For a consistent manual backup, stop the stack first with `stop.bat`, copy the directory, then start it again. The stop command never removes `data/`.

Useful commands:

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f worker
docker compose down
docker compose --profile drive up -d
```

## Privacy and security

- Do not expose the loopback-bound ports to a LAN or the public internet. The local API has no user login because it is intended for one local user only.
- Keep `.env` and `data/rclone/rclone.conf` private.
- Use a long random S3 secret even though the endpoint is loopback-bound.
- Gemini extraction is cloud processing. Disable it or do not import sensitive conversations when those excerpts must stay offline.
- Embeddings are computed locally; the original archive remains on local disk.
- Do not commit `data/`, `.env`, or OAuth credentials.

See [Security notes](docs/SECURITY.md) and [Architecture](docs/ARCHITECTURE.md).
