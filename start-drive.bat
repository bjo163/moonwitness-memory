@echo off
setlocal
cd /d "%~dp0"

if not exist .env (
  echo Run start.bat once to create .env, then configure GEMINI_API_KEY and S3_SECRET_KEY.
  pause
  exit /b 1
)

if not exist data\rclone\rclone.conf (
  echo Starting Google Drive OAuth setup...
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-drive.ps1
  if errorlevel 1 (
    echo [ERROR] Google Drive setup did not complete.
    pause
    exit /b 1
  )
)

docker compose --profile drive config --quiet
if errorlevel 1 (
  echo [ERROR] Docker Compose Drive profile is invalid. Check .env.
  pause
  exit /b 1
)

docker compose --profile drive up --build -d
if errorlevel 1 (
  echo [ERROR] Could not start Drive gateway. Check logs.
  pause
  exit /b 1
)

echo.
echo Google Drive S3 gateway: http://127.0.0.1:9000
echo Dashboard: http://localhost:3000
start "" "http://localhost:3000"
