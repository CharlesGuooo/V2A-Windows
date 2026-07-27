@echo off
REM Debug launcher: keeps the console window open and prints logs live.
REM For normal use double-click V2A.vbs instead (no window, lives in the tray).
REM Kept ASCII-only on purpose: cmd.exe parses the file in the OEM codepage
REM before chcp takes effect, so non-ASCII text here would be garbled.
chcp 65001 >nul
cd /d "%~dp0"
set V2A_CONSOLE=1
echo.
echo   V2A - debug mode
echo   Log file: %%APPDATA%%\V2A\v2a.log
echo   Press Ctrl+C to stop.
echo.
node server.js
echo.
echo   Server stopped.
pause
