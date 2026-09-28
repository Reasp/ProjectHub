---
id: TASK-77.6
title: 'Живая проверка экспорта ролей и хуков с Claude Code, скриншоты, pack:win'
status: Done
assignee: []
created_date: '2026-09-27 04:18'
updated_date: '2026-09-28 04:53'
labels:
  - hooks
  - verification
dependencies: []
parent_task_id: TASK-77
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Временный проект; экспорт ролей; claude -p (haiku) с субагентом и хуками; PreToolUse в очередь HITL, решение через hitlService/MCP; PostToolUse пишет аудит с длительностью; fail-open при недоступном ProjectHub; скриншоты менеджера ролей.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Субагент и хуки работают в настоящем Claude Code
- [x] #2 HITL и аудит получают события терминальной сессии
- [x] #3 Fail-open при недоступном ProjectHub
- [x] #4 Скриншоты и pack:win
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Живой прогон Claude Code 2.1.280 (haiku) на временном проекте: 5 сценариев зелёные, детали в decision-54 «Реализация». Codex вживую не проверялся (не оплачен).
<!-- SECTION:NOTES:END -->
