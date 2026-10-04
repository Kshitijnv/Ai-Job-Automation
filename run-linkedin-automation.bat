@echo off
setlocal

cd /d "%~dp0"

title LinkedIn Job Automation Pipeline

echo ==================================================
echo LinkedIn Job Automation Pipeline
echo ==================================================
echo.
echo This runs the same sequential pipeline that was
echo previously orchestrated through n8n:
echo.
echo Search -> Fit -> JD -> Resume -> Apply -> Dashboard
echo.
echo Each step must finish successfully before the next
echo step starts.
echo.

echo [1/6] Search Agent
echo --------------------------------------------------
node scripts\search-agent.js
if errorlevel 1 goto :fail

echo.
echo [2/6] Fit Agent
echo --------------------------------------------------
node scripts\fit-agent.js
if errorlevel 1 goto :fail

echo.
echo [3/6] JD Agent
echo --------------------------------------------------
node scripts\jd-agent.js
if errorlevel 1 goto :fail

echo.
echo [4/6] Resume Agent
echo --------------------------------------------------
node scripts\resume-agent.js
if errorlevel 1 goto :fail

echo.
echo [5/6] LinkedIn Apply Agent
echo --------------------------------------------------
node scripts\apply-agent.js
if errorlevel 1 goto :fail

echo.
echo [6/6] Dashboard Agent
echo --------------------------------------------------
node scripts\dashboard-agent.js
if errorlevel 1 goto :fail

echo.
echo ==================================================
echo LinkedIn automation completed successfully.
echo ==================================================
echo.
pause
exit /b 0

:fail
echo.
echo ==================================================
echo PIPELINE STOPPED
echo ==================================================
echo.
echo The previous step returned an error.
echo Remaining steps were not executed.
echo.
pause
exit /b 1
