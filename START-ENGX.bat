@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js LTS first, then run this file again.
 pause
 exit /b 1
)
start "" http://127.0.0.1:5173
node serve-built.mjs
pause
