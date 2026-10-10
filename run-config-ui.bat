@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  Starting Application Profile Configuration UI...
echo ========================================================
start "" http://localhost:3000/
node scripts/config-server.js
pause
