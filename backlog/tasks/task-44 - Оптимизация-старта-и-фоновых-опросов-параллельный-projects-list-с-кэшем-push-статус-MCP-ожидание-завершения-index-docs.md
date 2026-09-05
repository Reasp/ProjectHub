---
id: TASK-44
title: >-
  Оптимизация старта и фоновых опросов: параллельный projects:list с кэшем,
  push-статус MCP, ожидание завершения index-docs
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
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
- [ ] #1 inspectProject выполняется параллельно с лимитом (например, 4) и кэшем по mtime каталогов backlog/tasks и .git; повторный projects:list без изменений отдаёт данные из кэша
- [ ] #2 Статус MCP-сервера приходит push-событием mcp:statusChanged из main; polling каждые 5 с удалён
- [ ] #3 Опрос usage выполняется только при открытой модалке или по явному запросу; проверить, что claude -p /usage не расходует квоту, иначе заменить на чтение stats-cache.json
- [ ] #4 handleReindex подписывается на process:statusChanged для процесса index-docs и обновляет статистику после его завершения
<!-- AC:END -->
