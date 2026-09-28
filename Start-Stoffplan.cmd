@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Bitte zuerst Node.js 24 installieren.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto error
)
call npm run build
if errorlevel 1 goto error
call npm start
if errorlevel 1 goto error
exit /b 0
:error
echo Stoffplan konnte nicht gestartet werden. Bitte die Meldung oben pruefen.
pause
exit /b 1
