@echo off
title StudyMedia Sidecar - Manual Restart
echo ====================================================
echo   StudyMedia Home Sidecar - Manual Restart Tool
echo ====================================================
echo.
echo [1/3] Stopping any existing Sidecar process...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'StudyMediaSidecar' -ErrorAction SilentlyContinue; $pf = Join-Path '%~dp0' 'watchdog.pid'; if (Test-Path $pf) { $p = (Get-Content $pf -ErrorAction SilentlyContinue | Select-Object -First 1) -as [int]; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }; Get-NetTCPConnection -LocalPort 4848 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo [2/3] Starting StudyMediaSidecar background task (hidden)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-ScheduledTask -TaskName 'StudyMediaSidecar'"
timeout /t 3 /nobreak >nul

echo [3/3] Verifying Sidecar health...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$envPath = Join-Path '%~dp0' '.env'; $key = (Get-Content $envPath | Where-Object { $_ -match '^API_KEY=' } | Select-Object -First 1) -replace '^API_KEY=',''; try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4848/health' -Headers @{ 'x-api-key' = $key.Trim() } -TimeoutSec 5; if ($r.status -eq 'ok') { Write-Host ('STATUS: ONLINE (Max ' + $r.maxFilesize + ', Timeout ' + $r.timeoutSeconds + 's)') -ForegroundColor Green } else { Write-Host 'STATUS: UNEXPECTED RESPONSE' -ForegroundColor Yellow } } catch { Write-Host ('STATUS: OFFLINE - ' + $_.Exception.Message) -ForegroundColor Red }"
echo.
echo You can safely close this window - the Sidecar keeps running invisibly in the background!
echo.
pause
