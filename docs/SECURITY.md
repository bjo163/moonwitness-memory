# Security and privacy

MoonWitness Memory is a single-user local application, not a hosted multi-tenant service.

- Docker Compose publishes the web, API and optional S3 gateway ports on `127.0.0.1`.
- The local API has no authentication. Do not change host bindings to `0.0.0.0`, expose it to LAN, or put it behind a public tunnel without adding authentication and network controls first.
- Secrets belong in `.env`, which is ignored by Git.
- Rclone OAuth credentials live in `data/rclone/rclone.conf`; protect and back up this file privately.
- Uploaded source archives are retained unchanged in `data/inbox`.
- Gemini is optional cloud processing. When enabled, bounded transcript text chunks are sent to Google's API. Do not process sensitive content unless you accept that transfer.
- Embeddings are computed locally and stored in `data/vectors`; the default model is downloaded into `data/models`.
- Google Drive is an optional archive backup target. The local S3-compatible gateway is experimental and loopback-bound.
- The initial dashboard does not expose source deletion. Back up the complete `data/` directory before manual cleanup or upgrades.
