---
id: TASK-46
title: >-
  Мёртвый код и дубли: stdio MCP-сервер, ProcessTerminal, дублирующие IPC,
  разбиение main.ts на модули, contextdump.md
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
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
- [ ] #1 Единый реестр MCP-инструментов используется обоими транспортами (stdio и SSE) либо stdio-вариант удалён вместе со scripts/mcp-server.mjs, если он не нужен
- [ ] #2 ProcessTerminal.tsx удалён
- [ ] #3 Дублирующие IPC-каналы удалены, preload и electron.d.ts синхронизированы
- [ ] #4 IPC-обработчики вынесены в electron/ipc/*.ts по доменам (projects, backlog, git, ai, files, voice, mcp), main.ts содержит только bootstrap окна и регистрацию модулей
- [ ] #5 contextdump.md перенесён в backlog/docs как doc-N или удалён; npm run lint:docs проходит
<!-- AC:END -->
