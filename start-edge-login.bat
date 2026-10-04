@echo off
setlocal

cd /d "%~dp0"

set "EDGE_PROFILE=%~dp0output\edge-automation-profile"
set "EDGE_PROFILE_NAME=Kshitij"

echo ==========================================
echo AI Job Automation - Edge Login
echo ==========================================
echo.
echo Automation profile:
echo %EDGE_PROFILE%
echo.
echo A dedicated Edge profile will be opened.
echo Log in manually to LinkedIn and/or Naukri.
echo After login is complete, close Edge before
echo starting the automation.
echo.

if not exist "%EDGE_PROFILE%" (
    echo Creating automation profile directory...
    mkdir "%EDGE_PROFILE%"
)

echo Starting Microsoft Edge...
start "" msedge --user-data-dir="%EDGE_PROFILE%" --profile-directory="%EDGE_PROFILE_NAME%"

echo.
echo ==========================================
echo Edge started.
echo Log in manually, then close Edge.
echo ==========================================
pause
