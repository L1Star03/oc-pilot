@echo off
rem oc-pilot launcher (generic)
rem usage: oc-start.bat [project-dir-for-opencode-web]
set "HERE=%~dp0.."
set "PROJ=%~1"
if "%PROJ%"=="" set "PROJ=%USERPROFILE%"
if "%OPENCODE_PORT%"=="" set "OPENCODE_PORT=4096"
netstat -ano | findstr "LISTENING" | findstr ":%OPENCODE_PORT% " >nul 2>&1
if errorlevel 1 (
    echo starting opencode web on %OPENCODE_PORT% in %PROJ%
    start "" /min powershell -NoProfile -Command "Set-Location '%PROJ%'; opencode web --port %OPENCODE_PORT%"
) else (
    echo opencode web already running on %OPENCODE_PORT%
)
echo starting oc-pilot
start "" /min cmd /c "cd /d "%HERE%" && node server.js"
timeout /t 2 >nul
echo board: http://127.0.0.1:4097
