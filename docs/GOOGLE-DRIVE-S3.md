# Google Drive as a local S3-compatible object store

This setup uses Rclone's experimental `serve s3` command in front of a Google Drive remote. The endpoint is published only on http://127.0.0.1:9000 and is reachable inside Compose at http://rclone-s3:9000.

## Configure once (Windows)

1. Copy .env.example to .env.
2. Change S3_ACCESS_KEY and S3_SECRET_KEY to private values.
3. Run PowerShell: `.\scripts\setup-drive.ps1`.
4. Create a remote named `gdrive` and choose the Google Drive backend (`drive`).
5. In the OAuth wizard, use your own Google OAuth client credentials where available; complete the browser authorization.
6. Start the full stack: `docker compose --profile drive up --build -d`.

Linux/macOS: `bash scripts/setup-drive.sh`.

## S3 client settings

- Endpoint: http://127.0.0.1:9000
- Region: us-east-1
- Bucket: mw-memory
- Addressing: path-style
- Signature: AWS Signature Version 4
- Credentials: S3_ACCESS_KEY / S3_SECRET_KEY from .env

The bucket is represented as a directory under the Rclone remote root `MOONWITNESS-MEMORY`. The worker creates the bucket if absent and uploads source archives using multipart transfer. Client multipart uploads are serialized so Rclone receives contiguous part numbers in order.

## Compatibility limits

Rclone explicitly describes `serve s3` as experimental. It supports common object storage operations, but it is not the complete AWS S3 API. Versioning, ACLs, bucket policies, lifecycle rules and other advanced S3 features are out of scope. Metadata support is limited and some state is held in memory. Do not treat this gateway as a drop-in production replacement for AWS S3.

Google Drive is a file store, not a native S3 object store. Rclone translates common S3 operations to files in the Drive remote. Performance depends on network, Google API quota, Drive account restrictions and number of files. For this personal archive workflow it provides a convenient S3-compatible local interface.

The S3 gateway streams objects to the remote by default; it does not need to cache every object on local disk. Keep enough local disk for the original archive inbox, SQLite database, vector index and embedding model.

Without a configured Rclone remote, local import and AI extraction still work. The worker records a Drive backup error but never removes the local original. After Drive is configured, use BACKUP on an archive in the dashboard to enqueue a backup-only job.
