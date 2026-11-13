# Google Drive as a local S3-compatible object store

This adapter uses Rclone's `serve s3` command in front of a Google Drive remote. The checked-in Compose image is pinned to Rclone 1.76.0. The local endpoint is published only on http://127.0.0.1:9000 and is reachable inside Compose at http://rclone-s3:9000.

## Configure once (Windows)

1. Start the base app once so `.env` exists.
2. Change `S3_ACCESS_KEY` and `S3_SECRET_KEY` to private values in `.env`.
3. Run `start-drive.bat`, or run PowerShell: `.\scripts\setup-drive.ps1`.
4. In the Rclone configuration wizard, create a remote named `gdrive` and select the Google Drive (`drive`) backend.
5. Complete browser OAuth. Use your own Google OAuth client credentials when appropriate.
6. Start the Drive profile: `docker compose --profile drive up --build -d`.
7. Use **BACKUP** beside an archive in the dashboard.

Linux/macOS: `bash scripts/setup-drive.sh`.

## S3 client settings

- Endpoint: http://127.0.0.1:9000
- Region: us-east-1
- Bucket: mw-memory
- Addressing: path-style
- Signature: AWS Signature Version 4
- Credentials: `S3_ACCESS_KEY` / `S3_SECRET_KEY` from `.env`

The bucket maps to a directory under the Rclone remote root `MOONWITNESS-MEMORY`. The worker creates the bucket if absent and uploads source archives using multipart transfer. Parts are serialized to avoid concurrent multipart part writes.

## Compatibility and safety limits

Rclone documents `serve s3` as **experimental**. It supports common object-storage calls, including bucket operations, object reads/writes, deletes and multipart uploads, but it is not the full AWS S3 API. Features such as versioning, ACLs, bucket policies and lifecycle rules are not a supported target for this integration. Some object metadata is held in memory and is not durable like native object-store metadata.

Google Drive is a file store, not a native S3 object store. Rclone translates common S3 operations to files and directories in the Drive remote. Performance and reliability depend on network connectivity, Google API quotas, Drive account restrictions and account storage quota.

The gateway does not need to cache every object on local disk by default. Keep enough local disk for the source inbox, SQLite database, vector index and embedding model. Keep the Rclone configuration private: `data/rclone/rclone.conf` contains OAuth credentials.

Without a configured Rclone remote, local import and AI extraction still work. The worker records a backup error but never removes the local original. Once Drive is configured, use **BACKUP** on the archive to queue a backup-only retry.
