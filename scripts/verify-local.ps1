[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ArchivePath,
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [ValidateRange(1, 1440)]
    [int]$TimeoutMinutes = 120,
    [switch]$RequireDriveBackup
)

$ErrorActionPreference = "Stop"
$ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
$ResolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
$Extension = [IO.Path]::GetExtension($ResolvedArchive).ToLowerInvariant()
if ($Extension -notin @(".zip", ".json")) {
    throw "Archive must be a ChatGPT .zip export or conversations.json file."
}

function Get-ApiJson([string]$Path) {
    return Invoke-RestMethod -Method Get -Uri "$ApiBaseUrl$Path" -TimeoutSec 30
}

function Wait-ForFullJob([string]$ArchiveId, [datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        $jobs = @(Get-ApiJson "/api/jobs?limit=500")
        $matches = @($jobs | Where-Object { $_.archive_id -eq $ArchiveId -and $_.mode -eq "full" } | Sort-Object created_at -Descending)
        if ($matches.Count -gt 0) {
            $job = $matches[0]
            Write-Host ("Import job: {0} | {1} | {2}/{3} conversations" -f $job.status, $job.id, $job.processed_conversations, $job.total_conversations)
            if ($job.status -eq "complete") { return $job }
            if ($job.status -eq "awaiting_ai") {
                throw "Extraction is waiting for Gemini. Set GEMINI_API_KEY in .env, recreate api/worker, then rerun this verifier."
            }
            if ($job.status -eq "failed") { throw "Import failed: $($job.error)" }
        }
        else {
            Write-Host "Waiting for the import job to appear..."
        }
        Start-Sleep -Seconds 5
    }
    throw "Timed out waiting for the import job after $TimeoutMinutes minutes."
}

Write-Host "== MoonWitness Memory end-to-end verification ==" -ForegroundColor Cyan
Write-Host "Archive: $ResolvedArchive"

$health = Get-ApiJson "/health"
if ($health.status -ne "ok") { throw "API health check failed." }
$system = Get-ApiJson "/api/system"
if (-not $system.gemini_configured) {
    throw "GEMINI_API_KEY is not configured. Add it to .env and run: docker compose up -d --force-recreate api worker"
}
Write-Host "[1/5] API healthy; Gemini configured." -ForegroundColor Green

$uploadOutput = & curl.exe --silent --show-error --fail -X POST "$ApiBaseUrl/api/archives" -H "Content-Type: application/octet-stream" -H "X-Archive-Filename: $([IO.Path]::GetFileName($ResolvedArchive))" --data-binary "@$ResolvedArchive"
if ($LASTEXITCODE -ne 0) { throw "Archive upload failed (curl exit code $LASTEXITCODE)." }
$upload = $uploadOutput | ConvertFrom-Json
$archiveId = $upload.archive.id
if (-not $archiveId) { throw "Upload response did not contain an archive ID." }
Write-Host ("[2/5] Archive accepted: {0} (duplicate: {1})." -f $archiveId, $upload.duplicate) -ForegroundColor Green

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$job = Wait-ForFullJob -ArchiveId $archiveId -Deadline $deadline

$knowledge = @(Get-ApiJson "/api/knowledge?limit=500" | Where-Object { $_.archive_id -eq $archiveId })
if ($knowledge.Count -eq 0) {
    throw "Import completed but returned no knowledge for this archive. Use an archive containing substantive conversations and inspect worker logs."
}
$withSources = @($knowledge | Where-Object { @($_.source_message_ids).Count -gt 0 })
if ($withSources.Count -gt 0) {
    $source = Get-ApiJson "/api/knowledge/$($withSources[0].id)/sources"
    if (-not $source.messages -or $source.messages.Count -eq 0) {
        throw "Knowledge provenance check failed: source messages were not returned."
    }
}
else {
    throw "No extracted knowledge record contains source_message_ids; provenance verification cannot pass."
}
Write-Host ("[3/5] Extraction complete: {0} knowledge records; provenance checked." -f $knowledge.Count) -ForegroundColor Green

$tempExport = Join-Path ([IO.Path]::GetTempPath()) ("mw-memory-{0}.ndjson" -f [guid]::NewGuid())
try {
    Invoke-WebRequest -Uri "$ApiBaseUrl/api/export.ndjson" -OutFile $tempExport -TimeoutSec 300
    $lineCount = 0
    foreach ($line in [IO.File]::ReadLines($tempExport)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $null = $line | ConvertFrom-Json
        $lineCount++
    }
    if ($lineCount -eq 0) { throw "NDJSON export is empty." }
}
finally {
    Remove-Item -LiteralPath $tempExport -Force -ErrorAction SilentlyContinue
}
Write-Host ("[4/5] NDJSON export valid: {0} records." -f $lineCount) -ForegroundColor Green

if ($RequireDriveBackup) {
    $null = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/api/archives/$archiveId/backup" -TimeoutSec 30
    $driveComplete = $false
    while ((Get-Date) -lt $deadline) {
        $archives = @(Get-ApiJson "/api/archives?limit=500")
        $archive = $archives | Where-Object { $_.id -eq $archiveId } | Select-Object -First 1
        if ($archive.drive_status -eq "uploaded") { $driveComplete = $true; break }
        if ($archive.drive_status -eq "error") { throw "Google Drive backup failed: $($archive.drive_error)" }
        Start-Sleep -Seconds 5
    }
    if (-not $driveComplete) { throw "Timed out waiting for Google Drive backup. Check the rclone profile and worker logs." }
    Write-Host "[5/5] Google Drive backup confirmed." -ForegroundColor Green
}
else {
    Write-Host "[5/5] Drive check skipped (pass -RequireDriveBackup after OAuth setup)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "PASS: local import, extraction, provenance and NDJSON export verified." -ForegroundColor Green
if ($RequireDriveBackup) { Write-Host "PASS: Google Drive backup verified." -ForegroundColor Green }
