@echo off
setlocal

cd /d "%~dp0"

echo ==========================================
echo Naukri Job Application Automation
echo ==========================================
echo.
echo Starting Naukri job applications from your profile...
echo.

node scripts\naukri\naukri-agent.js

echo.
echo ==========================================
echo Naukri automation finished.
echo ==========================================
pause
