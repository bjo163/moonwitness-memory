# Security and privacy

This is a single-user local application, not a hosted multi-tenant service.

- Compose publishes the web, API and S3 gateway ports on 127.0.0.1 only.
- Do not change host bindings to 0.0.0.0 unless authentication, network controls and firewall rules are added.
- Secrets belong in .env, which is ignored by Git.
- Rclone OAuth credentials live in data/rclone/rclone.conf and must remain private.
- Uploaded source archives are retained unchanged in data/inbox.
- Gemini cloud AI is optional. When configured, bounded conversation chunks are sent to Google's API. Do not process sensitive content unless you accept that transfer.
- Embeddings run locally and are stored in data/vectors.
- The initial UI does not expose source deletion. Back up data/ before updates or cleanup.
