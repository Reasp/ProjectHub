@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Dev Infra - Web UI

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js не найден. Установите: https://nodejs.org
    pause
    exit /b 1
)

if /I "%~1"=="stop" (
    node scripts\web.mjs stop
    pause
    exit /b 0
)

node scripts\web.mjs start
echo.
echo Остановить всё: start-web.bat stop
pause
