# Configure Tailscale Serve (PRIVATE TAILNET HTTPS ONLY — strictly NO Funnel)
$ErrorActionPreference = 'Stop'

$tsBin = Get-Command tailscale -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $tsBin -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) {
  $tsBin = 'C:\Program Files\Tailscale\tailscale.exe'
}
if (-not $tsBin) {
  Write-Error 'Tailscale CLI not found. Install Tailscale first.'
  exit 1
}

Write-Host '[1/3] Resetting any previous Tailscale Serve / Funnel rules...' -ForegroundColor Cyan
& $tsBin serve reset

Write-Host '[2/3] Enabling PRIVATE Tailnet-only HTTPS proxy -> http://127.0.0.1:4848...' -ForegroundColor Green
& $tsBin serve --bg http://127.0.0.1:4848

Write-Host '[3/3] Verifying Serve Status (must say Tailnet only, NO Funnel):' -ForegroundColor Yellow
& $tsBin serve status
