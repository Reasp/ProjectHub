---
id: TASK-76
title: >-
  Память агента по проекту: файлы памяти, инъекция в contextBuilder, MCP
  memory_write/memory_search, индекс docs-rag
status: To Do
assignee: []
created_date: '2026-09-15 03:12'
labels:
  - ai
  - context
  - memory
  - rag
  - mcp
milestone: m-0
dependencies: []
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GPT-6 Astra вместо сжатия контекста ведёт «context notes» — структурированные, доступные поиску заметки, переживающие смену окна контекста; Claude Code имеет авто-память по проекту; Hermes продаёт «persistent memory». В ProjectHub контекст собирается заново на каждый запуск (`contextBuilder`: задача + RAG + GitNexus), а знания агента о проекте (что пробовали, почему отказались, где грабли) теряются между сессиями и движками. Задача добавляет engine-agnostic память проекта (doc-10).

## Модель
- Хранилище: `backlog/memory/` (внутри Backlog — источник истины, decision-3) либо `.projecthub/memory/` — решить в ADR; один факт = один markdown-файл с frontmatter (`id`, `type: project|feedback|reference`, `created`, `source: task-N/session`), даты строками (правило 16). Индекс `MEMORY.md` — одна строка на факт.
- Запись: MCP-инструмент `memory_write` во встроенном MCP-сервере ProjectHub (доступен всем движкам через `.mcp.json`/app-server MCP), плюс `memory_search`; для Claude CLI — также подсказка в системном промпте «сохраняй неочевидные выводы через memory_write».
- Чтение: `contextBuilder` подмешивает `MEMORY.md` (лимит по токенам) + релевантные факты через `docs-rag` (индексировать каталог памяти вместе с docs/decisions; `lint:docs` и `check-index` расширить).
- «Заметки хода»: по завершении хода/сессии агент пишет краткую заметку в `implementationNotes` задачи — вместе с итерациями Done-loop это даёт «журнал попыток» вместо потери контекста при compaction.
- Гигиена: UI-просмотр памяти проекта, удаление/правка фактов, дедупликация (поиск похожих перед записью), запрет секретов (проверка паттернов).

## Что сделать
1. ADR о месте и формате памяти; `memoryService.ts` + чистый модуль `memoryFormat.ts` (парсер/валидатор, тесты).
2. Инструменты `memory_write`/`memory_search` в `mcpServerService` + IPC для UI.
3. `contextBuilder`: секция «Память проекта» с лимитом и переключателем в `ContextAppliedCard`.
4. `scripts/rag/index-docs.mjs` и `check-index`: включить каталог памяти.
5. UI-вкладка «Память» в Docs-разделе проекта.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Формат и место хранения памяти зафиксированы в ADR; парсер/валидатор — чистый модуль с unit-тестами; даты в frontmatter строками (правило 16)
- [ ] #2 MCP-инструменты memory_write и memory_search доступны агентам всех движков через встроенный MCP-сервер; запись с секретами отклоняется
- [ ] #3 contextBuilder подмешивает память проекта с лимитом токенов; секция отключается в ContextAppliedCard
- [ ] #4 Память индексируется docs-rag; lint:docs и check-index учитывают каталог памяти
- [ ] #5 По завершении сессии агента по задаче краткая заметка хода попадает в implementationNotes задачи
- [ ] #6 UI просмотра/правки/удаления фактов памяти; i18n; lint/test зелёные, pack:win собран
<!-- AC:END -->
