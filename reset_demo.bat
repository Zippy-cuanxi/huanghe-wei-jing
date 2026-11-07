@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo This will delete the local demo database and demo IDs, then restart.
if exist "var\app.db" del /q "var\app.db"
if exist "var\app.db-wal" del /q "var\app.db-wal"
if exist "var\app.db-shm" del /q "var\app.db-shm"
if exist "demo\demo_ids.json" del /q "demo\demo_ids.json"
echo Demo data reset. Starting server...
python server.py
if errorlevel 1 pause
