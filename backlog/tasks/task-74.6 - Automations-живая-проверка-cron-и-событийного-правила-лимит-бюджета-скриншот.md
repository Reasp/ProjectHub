---
id: TASK-74.6
title: >-
  Automations: живая проверка cron и событийного правила, лимит бюджета,
  скриншот
status: Done
assignee: []
created_date: '2026-09-26 23:07'
updated_date: '2026-09-27 00:03'
labels:
  - automation
dependencies:
  - TASK-74.5
parent_task_id: TASK-74
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Временный проект и userData: cron каждую минуту и task.statusChanged в Review запускает чеки; агент на удалённой Ollama или Claude CLI; лимит бюджета останавливает правило и уведомляет; скриншот UI; lint, test, check-bundle, lint:docs, pack:win.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cron-правило и правило на событие отработали вживую, журнал записан
- [x] #2 Превышение дневного бюджета приостановило правило и дало уведомление
- [x] #3 Скриншоты UI; lint, test, check-bundle, lint:docs зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Живая проверка 2026-09-27
<!-- SECTION:NOTES:END -->
