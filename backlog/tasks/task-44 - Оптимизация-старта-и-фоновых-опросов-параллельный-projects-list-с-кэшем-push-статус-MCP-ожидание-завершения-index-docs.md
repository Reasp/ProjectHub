---
id: TASK-44
title: >-
  Оптимизация старта и фоновых опросов: параллельный projects:list с кэшем,
  push-статус MCP, ожидание завершения index-docs
status: Review
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-06 21:15'
labels:
  - audit
  - performance
  - P1
dependencies: []
references:
  - electron/main.ts
  - electron/services/projectScanner.ts
  - electron/services/claudeUsageService.ts
  - src/components/mcp/McpServerStatusBadge.tsx
  - src/components/ai/ClaudeUsageButton.tsx
  - src/components/docs/DocsRagView.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/main.ts
  - electron/preload.ts
  - electron/services/projectScanner.ts
  - electron/services/gitService.ts
  - electron/services/mcpServerService.ts
  - electron/services/claudeUsageService.ts
  - electron/services/claudeBridgeService.ts
  - src/types/electron.d.ts
  - src/components/mcp/McpServerStatusBadge.tsx
  - src/components/ai/ClaudeUsageButton.tsx
  - src/components/docs/DocsRagView.tsx
  - tests/unit/projectScanner.test.ts
  - tests/unit/claudeUsageRateLimits.test.ts
priority: medium
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 3.4, 3.9, 5.8 (doc-7).

`projects:list` последовательно вызывает `inspectProject` для каждого проекта (git status, git log, чтение всех файлов задач), старт с 20+ проектами занимает секунды. `McpServerStatusBadge` опрашивает статус каждые 5 с, `ClaudeUsageButton` каждые 120 с (а `claudeUsageService` спаунит `claude -p /usage` при каждом промахе 45-секундного кэша), даже когда вкладки не видны. `DocsRagView.handleReindex` запускает `npm run index-docs` и через 4 с считает индекс готовым.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 inspectProject выполняется параллельно с лимитом (например, 4) и кэшем по mtime каталогов backlog/tasks и .git; повторный projects:list без изменений отдаёт данные из кэша
- [x] #2 Статус MCP-сервера приходит push-событием mcp:statusChanged из main; polling каждые 5 с удалён
- [x] #3 Опрос usage выполняется только при открытой модалке или по явному запросу; проверить, что claude -p /usage не расходует квоту, иначе заменить на чтение stats-cache.json
- [x] #4 handleReindex подписывается на process:statusChanged для процесса index-docs и обновляет статистику после его завершения
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## AC#1 — параллельный projects:list с кэшем по mtime
- `projectScanner.ts`: `mapWithConcurrency(items, limit, fn)` (порядок результатов сохраняется, ошибка элемента не роняет остальные), `INSPECT_CONCURRENCY = 4`.
- `inspectProject(path, { useCache })`: ключ кэша `computeInspectCacheKey` = mtime ключевых путей (`backlog/tasks`, `backlog/config.yml`, `.git`, `.git/HEAD|index|refs|packed-refs|logs/HEAD`, `infra.config.json`, `package.json`, `.rag-index/meta.json`, `.env-state/processes.json`) **плюс mtime каждого файла задачи** — правка статуса задачи меняет файл, но не mtime каталога (NTFS/ext4), одного каталога недостаточно. Только stat, без чтения/парсинга. TTL записи 2 мин (`INSPECT_CACHE_TTL_MS`) — страховка от изменений рабочего дерева git, которые по mtime не видны.
- На попадании в кэш `favorite`/`voiceAlias` берутся из реестра свежими. Результаты с `skipGit` (скан каталогов) не кэшируются.
- `projects:list` → `mapWithConcurrency(..., { useCache: true })`; `projects:refresh`/`getDetails`/`add` считают заново и обновляют кэш; `projects:remove` и `git:changed` (`gitService.onGitChanged`, подписка в main.ts, чтобы gitService не тянул projectRegistry/electron.app) сбрасывают запись.
- `scanDirectories`: полный осмотр найденных проектов тоже параллельно.

## AC#2 — push-статус MCP
- `mcpServerService.broadcastStatus()` шлёт `mcp:statusChanged` при listening/ошибке старта, после stop(), при regenerateToken, при set/delete SSE-сессии.
- preload `onMcpStatusChanged`, тип `McpServerStatus` в electron.d.ts (заменил inline-типы getMcpStatus/toggleMcpServer).
- `McpServerStatusBadge`: один `getMcpStatus` при монтировании + подписка; `setInterval(5000)` удалён.

## AC#3 — usage без спауна CLI
- **Проверено**: `claude -p /usage` (CLI 2.1.260) в print-режиме НЕ выполняет встроенную команду — строка «/usage» уходит модели как промпт (в ответе модель рассуждала про путь `C:\Program Files\Git\usage`). Каждый промах 45-секундного кэша тратил квоту.
- `claudeUsageService.getUsage` читает только `~/.claude/stats-cache.json` (сессии/сообщения/токены по моделям). Окна лимитов (сессия/неделя/модельная) берутся из `rate_limit_event` stream-json уже идущих сессий Claude CLI: `noteRateLimitEvent(info)` вызывается из `claudeBridgeService` в месте разбора события; `five_hour`→session, `seven_day`→weekly, `seven_day_<model>`→fableLimit. `rawText` теперь описывает источники данных. `parseUsageText` оставлен (покрыт тестом), но в продакшене не используется.
- `ClaudeUsageButton`: `setInterval(120000)` удалён; загрузка при монтировании и после закрытия модалки (там возможен force-refresh). Модалка по-прежнему грузит usage при открытии.
- Ограничение: до первого rate-limit события в сессии AI Studio проценты лимитов в бейдже отсутствуют (`isFallback: true`). Точные проценты без затрат квоты доступны только через OAuth-эндпоинт usage с токеном из хранилища Claude Code — сознательно не делал (доступ к чужим credentials).

## AC#4 — ожидание завершения index-docs
- `DocsRagView.handleReindex`: подписка `window.api.onProcessStatusChanged` до запуска; завершение (`status !== 'running'`) процесса с `name === 'index-docs'` и `cwd` текущего проекта (сравнение без регистра и завершающих слэшей) → снять флаг и `fetchStats()`. Если `startProcessAction` вернул null или уже незапущенный процесс — завершаем сразу. Отписка при размонтировании через ref.

## Проверки
- `tsc --noEmit` — ок; `vitest run` — 13 файлов, 107 тестов (18 новых: `projectScanner.test.ts` — лимит параллелизма/порядок/ошибки, кэш-хит, инвалидация по правке файла задачи и добавлению задачи, `invalidateInspectCache`, skipGit не кэшируется; `claudeUsageRateLimits.test.ts` — разбор окон, игнор событий без utilization, getUsage без спауна).
- `npm run lint:docs` — ок; `npm run pack:win` — `release/win-unpacked/ProjectHub.exe` пересобран.
<!-- SECTION:NOTES:END -->
