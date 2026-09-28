---
id: TASK-77.1
title: Чистые модули экспорта ролей и протокола хуков с unit-тестами
status: Done
assignee: []
created_date: '2026-09-27 04:17'
updated_date: '2026-09-28 04:53'
labels:
  - roles
  - hooks
dependencies: []
parent_task_id: TASK-77
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
roleExport.ts (роль → .claude/agents/*.md и .codex/agents/*.toml, маркер и hash, planFileWrite, слияние записей хуков в settings.json/hooks.json) и terminalHookProtocol.ts (разбор входа хука Claude/Codex, ответ в формате движка). decision-54 п. 1–3, 5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Маппинг роли в md/toml по decision-54 п. 1, пропуск ролей чужого движка
- [x] #2 planFileWrite: create/unchanged/update/conflict/foreign/orphan, CRLF не даёт ложного конфликта
- [x] #3 Слияние хуков не трогает чужие записи, невалидный JSON — conflict
- [x] #4 Протокол: вход Claude/Codex нормализуется, ответ allow/deny/none/block в формате движка; тесты
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
roleExport.ts и terminalHookProtocol.ts с тестами (roleExport.test.ts, terminalHookProtocol.test.ts); decision-54.
<!-- SECTION:NOTES:END -->
