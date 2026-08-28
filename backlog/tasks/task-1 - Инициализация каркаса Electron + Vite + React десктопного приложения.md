---
id: "task-1"
title: "Инициализация каркаса Electron + Vite + React десктопного приложения"
status: "To Do"
labels: ["desktop", "electron", "vite", "react", "setup"]
created: "2026-08-28"
---

# task-1: Инициализация каркаса Electron + Vite + React десктопного приложения

## Description
Развернуть базовый каркас мультиплатформенного десктопного приложения ProjectHub на базе Electron, Vite, React 19, TypeScript и Tailwind CSS v4.

## Acceptance Criteria
- [ ] Настроен `package.json` со всеми скриптами запуска dev-режима (`npm run dev`) и сборки (`npm run build`).
- [ ] Настроен главный процесс Electron (`electron/main.ts`) с поддержкой создания окна, безопасного IPC и жизненного цикла приложения.
- [ ] Настроен `preload.ts` с типизированным `contextBridge` для взаимодействия UI с Node.js.
- [ ] Настроен Vite + React 19 в папке `src/` с подключенным Tailwind CSS v4 и базовым темным макетом (Sidebar + Header + Main Content Area).
- [ ] Приложение успешно запускается локально командой `npm run dev` и открывает десктопное окно.
