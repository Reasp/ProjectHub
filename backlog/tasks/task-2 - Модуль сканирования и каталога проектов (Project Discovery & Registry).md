---
id: task-2
title: Модуль сканирования и каталога проектов (Project Discovery & Registry)
status: Done
assignee: []
created_date: ''
updated_date: '2026-08-28 03:15'
labels:
  - backend
  - discovery
  - git
  - fs
  - ipc
dependencies: []
---

# task-2: Модуль сканирования и каталога проектов (Project Discovery & Registry)

## Description
Разработать сервис сканирования файловой системы и управления каталогом проектов, совместимых с `ProjectTemplate`.

## Acceptance Criteria
- [x] Сервис умеет автоматически сканировать указанные директории (например, `F:\`, `D:\Projects`) и находить папки с `backlog/` или `infra.config.json`.
- [x] Поддерживается ручное добавление проекта через системный диалог выбора папки.
- [x] Для каждого проекта считываются метаданные:
  - Имя проекта из `backlog/config.yml` или `package.json`.
  - Статус Git (текущая ветка, количество измененных/незакоммиченных файлов, ahead/behind, последний коммит).
  - Сводка задач (счетчики задач по статусам `To Do`, `In Progress`, `Review`, `Done`).
  - Статус dev-сервера (запущен/остановлен, список живых процессов).
  - Статус RAG-индекса (готовность, количество чанков, дата сборки).
- [x] Список проектов сохраняется в локальной конфигурации Hub (`~/.projecthub/projects.json` или `localStorage`).
- [x] Реализованы методы IPC: `projects:list`, `projects:scan`, `projects:add`, `projects:remove`, `projects:refresh`, `projects:toggleFavorite`, `projects:getScanRoots`, `projects:setScanRoots`.
