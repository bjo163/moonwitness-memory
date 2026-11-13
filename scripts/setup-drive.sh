#!/usr/bin/env bash
set -euo pipefail
mkdir -p data/rclone
echo "Create an Rclone remote named gdrive using the Google Drive backend."
echo "Complete the browser OAuth flow when prompted."
docker compose --profile drive run --rm --service-ports rclone-s3 config
echo "Saved data/rclone/rclone.conf"
echo "Start with: docker compose --profile drive up --build -d"
