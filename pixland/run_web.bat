@echo off
setlocal
cd /d "%~dp0"
if "%PIXLANDS_DATA_DIR%"=="" set PIXLANDS_DATA_DIR=%~dp0
if "%PIXLANDS_CONCURRENCY%"=="" set PIXLANDS_CONCURRENCY=2
python -m uvicorn pixlands_web:app --host 127.0.0.1 --port 8000
