---
id: TASK-46
title: >-
  Мёртвый код и дубли: stdio MCP-сервер, ProcessTerminal, дублирующие IPC,
  разбиение main.ts на модули, contextdump.md
status: Done
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-10 04:37'
labels:
  - audit
  - refactoring
  - P2
dependencies: []
references:
  - electron/services/mcpServer.ts
  - electron/services/mcpServerService.ts
  - src/components/terminal/ProcessTerminal.tsx
  - electron/main.ts
  - electron/preload.ts
  - contextdump.md
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - package.json
  - contextdump.md
  - electron/services/gitService.ts
  - electron/ipc/types.ts
  - electron/ipc/projectsIpc.ts
  - electron/ipc/backlogIpc.ts
  - electron/ipc/gitIpc.ts
  - electron/ipc/aiIpc.ts
  - electron/ipc/filesIpc.ts
  - electron/ipc/voiceIpc.ts
  - electron/ipc/mcpIpc.ts
  - electron/ipc/processIpc.ts
  - electron/ipc/index.ts
  - backlog/docs/doc-9 - Контекст-проекта-и-состояние-системы-Context-Dump.md
priority: low
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 6.2, 6.3, 6.4, 6.5 (doc-7).

`electron/services/mcpServer.ts` (stdio, 11 инструментов) нигде не используется и расходится по составу и именам с SSE-сервером `mcpServerService` (10 инструментов). `src/components/terminal/ProcessTerminal.tsx` не импортируется. В `main.ts` дублируются IPC `files:readContent`/`file:readFile`, `files:saveContent`/`file:writeFile`, а `git:getLog`/`git:getStatus` живут отдельно от `gitService`; 103 обработчика в одном файле на 1100 строк. `contextdump.md` в корне репозитория содержит frontmatter без id и нарушает правило 13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Единый реестр MCP-инструментов используется обоими транспортами (stdio и SSE) либо stdio-вариант удалён вместе со scripts/mcp-server.mjs, если он не нужен
- [x] #2 ProcessTerminal.tsx удалён
- [x] #3 Дублирующие IPC-каналы удалены, preload и electron.d.ts синхронизированы
- [x] #4 IPC-обработчики вынесены в electron/ipc/*.ts по доменам (projects, backlog, git, ai, files, voice, mcp), main.ts содержит только bootstrap окна и регистрацию модулей
- [x] #5 contextdump.md перенесён в backlog/docs как doc-N или удалён; npm run lint:docs проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Удалить неиспользуемый stdio MCP сервер (electron/services/mcpServer.ts, scripts/mcp-server.mjs, package.json).
2. Удалить мертвый компонент src/components/terminal/ProcessTerminal.tsx.
3. Устранить дублирующие IPC-каналы (file:readFile, file:writeFile в пользу files:readContent, files:saveContent), консолидировать git-методы в gitService.ts, обновить preload.ts и electron.d.ts.
4. Разбить монолитный electron/main.ts на доменные модули в electron/ipc/*.ts (projects, backlog, git, ai, files, voice, mcp, process).
5. Перенести contextdump.md в backlog/docs/ как doc-9 через Backlog.md, очистить корневой contextdump.md от некорректного frontmatter.
6. Верифицировать lint, test, lint:docs и pack:win.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализована комплексная очистка мертвого кода и архитектурная декомпозиция IPC в рамках TASK-46 (пункты аудита 6.2, 6.3, 6.4, 6.5 doc-7):
1. Удален неиспользуемый stdio MCP сервер (electron/services/mcpServer.ts) и внешний скрипт scripts/mcp-server.mjs, а также соответствующая команда из package.json. Вся MCP-функциональность централизована в HTTP/SSE сервере mcpServerService.ts.
2. Удален мертвый неимпортируемый компонент src/components/terminal/ProcessTerminal.tsx.
3. Устранены дублирующие IPC-каналы file:readFile, file:writeFile, file:listFiles. Preload и electron.d.ts синхронизированы на единообразные files:readContent, files:saveContent, files:readTree. Методы getLog и getStatus инкапсулированы в gitService.ts.
4. Монолитный electron/main.ts (1540 строк) декомпозирован на доменные модули в electron/ipc/*.ts: projectsIpc, backlogIpc, gitIpc, aiIpc, filesIpc, voiceIpc, mcpIpc, processIpc, объединенные через registerAllIpc(). В main.ts остались только bootstrap окон, security guards и lifecycle (размер сокращен до ~320 строк).
5. contextdump.md зарегистрирован в Backlog.md как doc-9 (с валидным frontmatter), а в корневом файле удален YAML frontmatter со ссылкой на doc-9.
Все 186 unit-тестов, lint (0 ошибок), lint:docs и pack:win успешно пройдены.
<!-- SECTION:FINAL_SUMMARY:END -->
