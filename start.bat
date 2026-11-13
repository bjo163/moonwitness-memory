@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop / Docker CLI is not installed.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker engine is not running. Start Docker Desktop first.
  pause
  exit /b 1
)

if not exist .env (
  copy /Y .env.example .env >nul
  echo.
  echo FIRST RUN: edit .env and add your GEMINI_API_KEY.
  echo Then run start.bat again.
  start "" notepad.exe "%CD%.env"
  pause
  exit /b 0
)

docker compose config --quiet
if errorlevel 1 (
  echo [ERROR] docker-compose configuration is invalid. Check .env.
  pause
  exit /b 1
)

docker compose up --build -d
if errorlevel 1 (
  echo [ERROR] Docker Compose failed. Run logs.bat for details.
  pause
  exit /b 1
)

echo.
echo MOONWITNESS MEMORY BRIDGE is starting.
echo Dashboard: http://localhost:3000
echo API docs:  http://localhost:8000/docs
start "" "http://localhost:3000"
