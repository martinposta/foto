@echo off
rem Double-click to start the gallery admin (opens in your browser).
cd /d "%~dp0"
if not exist node_modules (
  echo Prvni spusteni: instaluji zavislosti...
  call npm install || goto :error
)
call npm run admin
goto :eof

:error
echo.
echo Instalace selhala. Je nainstalovany Node.js? (https://nodejs.org)
pause
