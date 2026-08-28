---
id: "task-1"
title: "Инициализация каркаса Electron + Vite + React десктопного приложения"
status: "Done"
labels: ["desktop", "electron", "vite", "react", "setup"]
created: "2026-08-28"
---

# task-1: Инициализация каркаса Electron + Vite + React десктопного приложения

## Description
Развернуть базовый каркас мультиплатформенного десктопного приложения ProjectHub на базе Electron, Vite, React 19, TypeScript и Tailwind CSS v4.

## Acceptance Criteria
- [x] Настроен `package.json` со всеми скриптами запуска dev-режима (`npm run dev`) и сборки (`npm run build`).
- [x] Настроен главный процесс Electron (`electron/main.ts`) с поддержкой создания окна, безопасного IPC и жизненного цикла приложения.
- [x] Настроен `preload.ts` с типизированным `contextBridge` для взаимодействия UI с Node.js.
- [x] Настроен Vite + React 19 в папке `src/` с подключенным Tailwind CSS v4 и базовым темным макетом (Sidebar + Header + Main Content Area).
- [x] Приложение успешно запускается и собирается (`npm run build`).
