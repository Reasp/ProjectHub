#!/usr/bin/env bash
set -e

echo "==================================================="
echo "  ProjectHub — Сборка приложения (Linux/macOS)"
echo "==================================================="
echo ""

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "[1/3] Проверка и установка зависимостей npm..."
npm install

echo ""
echo "[2/3] Компиляция TypeScript и бандлинг интерфейса..."
npm run build

echo ""
echo "[3/3] Упаковка Electron бинарников..."
npx electron-builder

echo ""
echo "==================================================="
echo "  ✔ Сборка успешно завершена!"
echo "  Файлы находятся в каталоге release/"
echo "==================================================="
