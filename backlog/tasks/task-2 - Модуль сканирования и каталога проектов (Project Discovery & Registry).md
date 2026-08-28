---
id: "task-2"
title: "Модуль сканирования и каталога проектов (Project Discovery & Registry)"
status: "To Do"
labels: ["backend", "discovery", "git", "fs", "ipc"]
created: "2026-08-28"
---

# task-2: Модуль сканирования и каталога проектов (Project Discovery & Registry)

## Description
Разработать сервис сканирования файловой системы и управления каталогом проектов, совместимых с `ProjectTemplate`.

## Acceptance Criteria
- [ ] Сервис умеет автоматически сканировать указанные директории (например, `F:\`, `D:\Projects`) и находить папки с `backlog/` или `infra.config.json`.
- [ ] Поддерживается ручное добавление проекта через системный диалог выбора папки.
- [ ] Для каждого проекта считываются метаданные:
  - Имя проекта из `backlog/config.yml` или `package.json`.
  - Статус Git (текущая ветка, количество измененных/незакоммиченных файлов).
  - Сводка задач (счетчики задач по статусам `To Do`, `In Progress`, `Review`, `Done`).
  - Статус dev-сервера (запущен/остановлен).
  - Статус RAG-индекса.
- [ ] Список проектов сохраняется в локальной конфигурации Hub (`~/.projecthub/projects.json` или `localStorage`).
- [ ] Реализованы методы IPC: `projects:list`, `projects:scan`, `projects:add`, `projects:remove`, `projects:refresh`.
