# StudyMedia Sidecar Watchdog (Localhost-Only 127.0.0.1:4848 for Tailscale Serve)
# Runs server.js in an auto-restarting loop with zero public ports.

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

$pidFile = Join-Path $PSScriptRoot 'watchdog.pid'

# Stop any previous watchdog instance recorded in watchdog.pid
if (Test-Path $pidFile) {
  $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($oldPid -and ($oldPid -as [int]) -and ([int]$oldPid -ne $PID)) {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
}
Set-Content -Path $pidFile -Value $PID -Encoding ascii

# Refresh PATH so yt-dlp and ffmpeg installed via winget are always found
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Test-Path '.env')) {
  Write-Error "Missing sidecar\.env. Copy .env.example to .env and set API_KEY first."
  exit 1
}

$logFile = Join-Path $PSScriptRoot 'sidecar.log'

while ($true) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  try {
    Add-Content -Path $logFile -Encoding utf8 -Value "[$ts] Starting StudyMedia Sidecar on 127.0.0.1:4848..."
    # Trim log file if larger than 2 MB
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 2MB)) {
      Get-Content $logFile -Tail 200 | Set-Content -Encoding utf8 $logFile
    }
  } catch {
    # Ignore transient log lock
  }

  # Clean up any orphaned process still holding port 4848 before starting
  Get-NetTCPConnection -LocalPort 4848 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }

  try {
    & node server.js 2>&1 | Out-File -FilePath $logFile -Encoding utf8 -Append
  } catch {
    try { Add-Content -Path $logFile -Encoding utf8 -Value "[$ts] Process error: $_" } catch {}
  }

  Start-Sleep -Seconds 3
}
