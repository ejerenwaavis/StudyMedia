# StudyMedia Sidecar Launcher (Localhost-Only + Outbound Cloudflare Tunnel)
# Run: powershell -ExecutionPolicy Bypass -File .\start-sidecar.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Refresh PATH in case winget packages were just installed
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

if (-not (Test-Path '.env')) {
  Write-Error "Missing sidecar\.env. Copy .env.example to .env and set a strong API_KEY first."
  exit 1
}

Write-Host "[StudyMedia Sidecar] Starting hardened Express server on 127.0.0.1:4848..." -ForegroundColor Cyan
$nodeProc = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow

Start-Sleep -Seconds 1
$cfBin = if (Test-Path "$PSScriptRoot\bin\cloudflared.exe") { "$PSScriptRoot\bin\cloudflared.exe" } else { 'cloudflared' }
Write-Host "[StudyMedia Sidecar] Starting outbound-only Cloudflare Tunnel..." -ForegroundColor Green
try {
  & $cfBin tunnel --url http://127.0.0.1:4848
} finally {
  if ($nodeProc -and -not $nodeProc.HasExited) {
    Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue
  }
}
