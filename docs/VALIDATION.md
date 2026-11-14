# Local end-to-end verification (Windows)

Run this after the Docker Compose stack is running and the Gemini key is configured.

~~~powershell
# Import -> Gemini extraction -> provenance -> NDJSON export
.\scripts\verify-local.ps1 -ArchivePath "C:\Users\you\Downloads\conversations.zip"

# Include Google Drive verification after completing the Rclone OAuth setup
.\scripts\verify-local.ps1 -ArchivePath "C:\Users\you\Downloads\conversations.zip" -RequireDriveBackup
~~~

The verifier uses the real local API and a real ChatGPT export. It waits for the worker, checks that knowledge was extracted for the uploaded archive, resolves one knowledge item's original source messages, and parses every NDJSON output line. The Drive option additionally waits for the archive to report drive_status=uploaded.

Requirements:
- Windows PowerShell 5.1+ and curl.exe.
- Docker Compose stack running at http://127.0.0.1:8000.
- GEMINI_API_KEY set in .env, followed by docker compose up -d --force-recreate api worker.
- For Drive verification: Rclone remote named gdrive configured and the Drive profile running.

The script does not send data to any remote receiver. MoonWitness webhook delivery is verified separately by backend CI tests; a real receiver endpoint and matching token must be configured before that path can be exercised.

If the verifier fails, inspect:

~~~powershell
docker compose logs --tail 200 api worker
docker compose ps
~~~

Do not expose the local API publicly; it is intentionally unauthenticated for single-user loopback operation.
