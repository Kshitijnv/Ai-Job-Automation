@echo off
setlocal

cd /d F:\Agent\Automation

echo ========================================
echo      Instahyre Job Automation
echo      Maximum Jobs: 50
echo ========================================
echo.

node scripts\instahyre\instahyre-agent.js --limit 50

echo.
echo ========================================
echo Instahyre automation finished.
echo ========================================
pause