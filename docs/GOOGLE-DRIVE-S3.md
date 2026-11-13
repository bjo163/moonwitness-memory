# Google Drive as a local S3-compatible object store

This setup uses Rclone's experimental serve s3 command in front of a Google Drive remote. The endpoint is only published at http://127.0.0.1:9000 and is reachable inside Compose at http://rclone-s3:9000.

## Configure once (Windows)

1. Copy .env.example to .env.
2. Change S3_ACCESS_KEY and S3_SECRET_KEY to private values.
3. Run PowerShell: .\scripts\setup-drive.ps1
4. In the interactive prompt create a remote named gdrive and select the Google Drive backend (drive).
5. Complete the browser OAuth authorization.
6. Start the full stack: docker compose --profile drive up --build -d

Linux/macOS: bash scripts/setup-drive.sh.

## S3 client settings

- Endpoint: http://127.0.0.1:9000
- Region: us-east-1
- Bucket: mw-memory
- Addressing: path-style
- Signature: AWS Signature Version 4
- Credentials: S3_ACCESS_KEY / S3_SECRET_KEY from .env

The bucket is a directory under the remote root MOONWITNESS-MEMORY. The worker creates the bucket if absent and uploads archives using multipart transfer.

## Compatibility limits

Rclone documents serve s3 as experimental. It implements common object operations, including list, HEAD/GET/PUT, delete, copy and multipart upload, but not the complete AWS S3 API. Some custom metadata is kept in memory only, and conditional writes are not atomic against changes made outside the gateway. Do not rely on S3 object versioning, bucket policies, lifecycle rules, ACLs, event notifications or durable custom metadata. The original archive and local provenance database remain the source of truth.

Google Drive is a file store, not a native S3 object store. The gateway translates common S3 operations to files in Drive. Performance depends on quota, network, VFS cache and account constraints. This personal archive use case is different from a production S3 replacement.

Without a configured Rclone remote, local import and AI extraction still work. The worker records a Drive backup error but never removes the local original.
