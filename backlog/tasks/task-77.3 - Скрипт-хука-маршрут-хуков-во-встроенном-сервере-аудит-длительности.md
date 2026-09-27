---
id: TASK-77.3
title: 'Скрипт хука, маршрут хуков во встроенном сервере, аудит длительности'
status: Review
assignee: []
created_date: '2026-09-27 04:17'
updated_date: '2026-09-27 04:54'
labels:
  - hooks
  - hitl
dependencies: []
parent_task_id: TASK-77
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
projecthub-hook.mjs (fail-open/closed, бюджет, лог), POST /api/hooks/event с токеном хуков, terminalHookService (политика, HITL origin terminal, durationMs в аудите, Stop → уведомление и проверки), переменные окружения встроенного терминала. decision-54 п. 3–8.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PreToolUse: deny/allow/ask политики, ask уходит в очередь HITL и ждёт решения в пределах бюджета
- [x] #2 PostToolUse пишет outcome с durationMs
- [x] #3 Stop: уведомление, проверки off/notify/block
- [x] #4 Токен хуков не открывает другие маршруты; скрипт fail-open при недоступном ProjectHub; тесты
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
projecthub-hook.mjs (terminalHookScript.ts), POST /api/hooks/event, terminalHookService, durationMs в аудите, окружение встроенного терминала; тесты terminalHookService/terminalHookScript/mcpTerminalHookRoute.
<!-- SECTION:NOTES:END -->
