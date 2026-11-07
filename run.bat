@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting 黄河垃圾热力地图...
echo Open http://127.0.0.1:8000/ if the browser does not open automatically.
python server.py
if errorlevel 1 (
  echo.
  echo Server exited with an error. Check Python 3.11+ and the message above.
  pause
)
