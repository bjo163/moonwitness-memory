# REST API and knowledge contract

Base URL: `http://localhost:8000`

Interactive OpenAPI documentation is available at `/docs`. The API is intended for a local single-user application and has no authentication layer. Keep it bound to loopback.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health status |
| GET | `/api/system` | Configured feature flags; never returns secrets |
| GET | `/api/dashboard` | Summary counts |
| GET | `/api/archives?limit=100` | Imported archive metadata and backup status |
| POST | `/api/archives` | Upload raw ZIP/JSON body; set `X-Archive-Filename` |
| POST | `/api/archives/{archive_id}/backup` | Queue Drive backup |
| GET | `/api/jobs?limit=100` | Worker queue and checkpoints |
| POST | `/api/jobs/{job_id}/resume` | Resume a waiting/failed job |
| GET | `/api/knowledge?limit=100` | Knowledge records |
| GET | `/api/knowledge/{knowledge_id}/sources` | Original message provenance |
| GET | `/api/search?q=...` | Keyword + vector search |
| GET | `/api/export.ndjson` | Full corpus as NDJSON download |

### Upload example

The request body is the file itself, not multipart form data:

```powershell
curl.exe -X POST "http://localhost:8000/api/archives" `
  -H "Content-Type: application/octet-stream" `
  -H "X-Archive-Filename: conversations.zip" `
  --data-binary "@conversations.zip"
```

### Knowledge record

A knowledge record has this shape (optional fields may be empty):

```json
{
  "id": "stable-record-id",
  "archive_id": "archive-id",
  "conversation_id": "conversation-id",
  "kind": "story",
  "title": "A title",
  "summary": "A short summary",
  "content": "Extracted knowledge",
  "tags": ["tag"],
  "entities": ["entity"],
  "source_message_ids": ["message-id"],
  "confidence": 0.9,
  "created_at": "2026-11-14T00:00:00+00:00",
  "updated_at": "2026-11-14T00:00:00+00:00",
  "synced_at": null
}
```

The source endpoint returns the matching original message text, role, title and timestamp. A consumer should retain the stable knowledge ID and provenance fields during ingestion.

## NDJSON pull

`GET /api/export.ndjson` sends one JSON record per line. Clients should stream the response rather than assuming it is a small JSON array. This is the recommended decoupled handoff to MoonWitness.

## Optional webhook push

When `MOONWITNESS_SYNC_URL` is explicitly configured, the worker posts batches like:

```json
{
  "source": "moonwitness-memory",
  "schema_version": 1,
  "records": []
}
```

Add `MOONWITNESS_SYNC_TOKEN` to send a Bearer token. The receiver should upsert by `records[].id` so that retries are idempotent. Do not configure the webhook until a real receiving endpoint and its contract have been implemented.
