# StudyMedia Sidecar Watchdog (Localhost-Only 127.0.0.1:4848 for Tailscale Serve)
# Runs server.js in an auto-restarting loop with zero public ports.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

# Refresh PATH so yt-dlp and ffmpeg installed via winget are always found
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Test-Path '.env')) {
  Write-Error "Missing sidecar\.env. Copy .env.example to .env and set API_KEY first."
  exit 1
}

$logFile = Join-Path $PSScriptRoot 'sidecar.log'

while ($true) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $logFile -Value "[$ts] Starting StudyMedia Sidecar on 127.0.0.1:4848..."

  # Trim log file if larger than 2 MB
  if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 2MB)) {
    Get-Content $logFile -Tail 200 | Set-Content $logFile
  }

  try {
    & node server.js *>> $logFile
  } catch {
    Add-Content -Path $logFile -Value "[$ts] Process error: $_"
  }

  Start-Sleep -Seconds 3
}
