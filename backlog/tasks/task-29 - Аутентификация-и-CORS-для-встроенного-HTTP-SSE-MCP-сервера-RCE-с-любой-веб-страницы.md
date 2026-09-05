---
id: TASK-29
title: >-
  Аутентификация и CORS для встроенного HTTP/SSE MCP-сервера (RCE с любой
  веб-страницы)
status: To Do
assignee: []
created_date: '2026-09-05 09:06'
labels:
  - audit
  - security
  - mcp
  - P0
dependencies: []
references:
  - electron/services/mcpServerService.ts
  - src/components/mcp/McpServerStatusBadge.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 4.1, 1.6 (doc-7).

`mcpServerService` генерирует Bearer-токен, но ни один маршрут (`/sse`, `/message`, `/api/action`, `/mcp.json`) его не проверяет. CORS отражает произвольный `Origin`. В результате любая открытая в браузере страница может выполнить `fetch('http://127.0.0.1:42042/api/action')` или подключиться к SSE и вызвать `projecthub_run_process` с произвольной командой. Дополнительно: при `EADDRINUSE` порт инкрементируется без ограничения попыток.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все маршруты, кроме /api/status, требуют заголовок Authorization: Bearer <token>; при несовпадении возвращается 401
- [ ] #2 /mcp.json больше не отдаётся по HTTP; конфиг-сниппет копируется из UI (McpServerStatusBadge)
- [ ] #3 CORS не отражает произвольный Origin: заголовок Access-Control-Allow-Origin не выставляется для внешних origin (или разрешён только пустой/null origin CLI-клиентов)
- [ ] #4 Ограничено число попыток подбора порта (например, 10), после чего start() возвращает false с ошибкой в UI
- [ ] #5 Проверено вручную: запрос с Origin https://example.com без токена получает 401/403
<!-- AC:END -->
