@echo off
chcp 65001 > nul
echo ===================================================
echo   ProjectHub — Сборка приложения для Windows
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/3] Проверка и установка зависимостей npm...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Не удалось установить зависимости npm.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Компиляция TypeScript и бандлинг интерфейса...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Ошибка сборки проекта.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Упаковка исполняемого приложения Electron...
call npx electron-builder --win --dir
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Ошибка генерации бинарных файлов.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo   ✔ Сборка успешно завершена!
echo.
echo   Исполняемый файл приложения готов к запуску:
echo   - release\win-unpacked\ProjectHub.exe
echo ===================================================
echo.
pause
