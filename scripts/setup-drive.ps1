$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "data/rclone" | Out-Null
Write-Host "Create an Rclone remote named gdrive using the Google Drive (drive) backend." -ForegroundColor Cyan
Write-Host "Complete the browser OAuth flow when prompted."
docker compose --profile drive run --rm --service-ports rclone-s3 config
if ($LASTEXITCODE -ne 0) { throw "Rclone configuration failed" }
Write-Host "Saved data/rclone/rclone.conf" -ForegroundColor Green
Write-Host "Start with: docker compose --profile drive up --build -d"
