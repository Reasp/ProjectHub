---
id: TASK-29
title: >-
  Аутентификация и CORS для встроенного HTTP/SSE MCP-сервера (RCE с любой
  веб-страницы)
status: Review
assignee: []
created_date: '2026-09-05 09:06'
updated_date: '2026-09-05 11:20'
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
modified_files:
  - electron/services/mcpServerService.ts
  - src/components/mcp/McpServerStatusBadge.tsx
  - src/types/electron.d.ts
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
- [x] #1 Все маршруты, кроме /api/status, требуют заголовок Authorization: Bearer <token>; при несовпадении возвращается 401
- [x] #2 /mcp.json больше не отдаётся по HTTP; конфиг-сниппет копируется из UI (McpServerStatusBadge)
- [x] #3 CORS не отражает произвольный Origin: заголовок Access-Control-Allow-Origin не выставляется для внешних origin (или разрешён только пустой/null origin CLI-клиентов)
- [x] #4 Ограничено число попыток подбора порта (например, 10), после чего start() возвращает false с ошибкой в UI
- [x] #5 Проверено вручную: запрос с Origin https://example.com без токена получает 401/403
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. mcpServerService.handleHttpRequest: проверка Host (только loopback), отказ 403 любому запросу с заголовком Origin (CORS-заголовки не выставляются вовсе), проверка Bearer-токена (timingSafeEqual) на всех маршрутах кроме /api/status, 401 при несовпадении.
2. Удалить маршрут /mcp.json; /api/status отдаёт публичный статус без токена.
3. /api/action: whitelist допустимых type.
4. start(): не более 10 попыток подбора порта, затем false + lastError в статусе.
5. UI (McpServerStatusBadge): показ lastError, cURL-пример с Authorization; типы electron.d.ts.
6. Ручная проверка curl: без токена/с Origin → 401/403, с токеном → 200.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Сервер (`electron/services/mcpServerService.ts`)**
- `handleHttpRequest`: любой запрос с заголовком `Origin` (браузер, включая preflight OPTIONS) → 403; CORS-заголовки больше не выставляются вовсе. Заголовок `Host` обязан быть loopback (127.0.0.1/localhost/[::1]) — защита от DNS rebinding, иначе 403.
- Все маршруты кроме `GET /api/status` требуют `Authorization: Bearer <token>`; сравнение через `crypto.timingSafeEqual`; при несовпадении 401 + `WWW-Authenticate`. Проверка стоит до роутинга, поэтому `/sse`, `/message`, `/api/action` и любые неизвестные пути закрыты.
- `/api/status` теперь отдаёт `getPublicStatus()` — без поля `token` (раньше токен утекал и здесь).
- Маршрут `/mcp.json` удалён; сниппет с токеном копируется только из UI.
- `/api/action`: whitelist `type` (REMOTE_ACTION_TYPES), иначе 400.
- `start()`: не более `MAX_PORT_ATTEMPTS = 10` попыток при EADDRINUSE, затем `false`, сервер закрывается, в статусе появляется `lastError` (сбрасывается при следующем успешном старте). Ошибки уже работающего сервера не переопределяют результат промиса.
- Убран дублирующий `transport.start()` после `mcpServer.connect(transport)` — connect стартует транспорт сам, а повторный вызов на каждое подключение писал в лог «SSEServerTransport already started».

**UI (`McpServerStatusBadge.tsx`, `electron.d.ts`)**: поле `lastError` в статусе, красный баннер «Ошибка запуска» при остановленном сервере, cURL-пример дополнен заголовком Authorization.

**Проверка**
1. Собранный `release/win-unpacked/ProjectHub.exe`, curl: `/api/status` → 200 без token; `POST /api/action` с `Origin: https://example.com` → 403; OPTIONS preflight → 403 без Access-Control-*; без токена `/api/action`, `/sse`, `/mcp.json` → 401; неверный токен → 401; `Host: evil.com` → 403.
2. Изолированный прогон сервиса в node (rolldown-бандл с заглушкой electron): валидный токен → `/api/action` 200, `/sse` 200 event-stream + endpoint-событие, `POST /message` 202; `/message` с валидным sessionId, но без токена → 401; `/mcp.json` с токеном → 404; 10 занятых портов → `start()=false`, `lastError` заполнен, после освобождения портов старт успешен.
3. `tsc --noEmit` чисто, `npm run lint:docs` ок, `npm run pack:win` собран.

**Заметка по окружению**: при запуске exe/`npm run dev` из сессии агента внутри VS Code унаследована `ELECTRON_RUN_AS_NODE=1` — Electron запускается как plain node и молча завершается. Перед запуском нужно снимать переменную.
<!-- SECTION:NOTES:END -->
