#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js не найден. Установите: https://nodejs.org"
  exit 1
fi

if [ "$1" = "stop" ]; then
  node scripts/web.mjs stop
  exit 0
fi

node scripts/web.mjs start
echo
echo "Остановить всё: ./start-web.sh stop"
