@echo off
cd /d "%~dp0"

if not exist "vendor\transformers.min.js" goto need_download
if not exist "models\Xenova\all-MiniLM-L6-v2\onnx\model_quantized.onnx" goto need_download
goto start_server

:need_download
echo Компоненты нейросети не найдены. Запускается загрузка (~55 МБ)...
echo.
python download_model.py
if errorlevel 1 (
    echo.
    echo Ошибка загрузки. Проверьте подключение к интернету и запустите снова.
    pause
    exit /b 1
)
echo.

:start_server
start /b python server.py
timeout /t 2 /nobreak > nul
start "" "http://localhost:8080"

:keepalive
timeout /t 3600 /nobreak > nul
goto :keepalive
