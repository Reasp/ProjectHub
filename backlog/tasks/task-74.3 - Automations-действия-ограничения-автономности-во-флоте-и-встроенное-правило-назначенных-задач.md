---
id: TASK-74.3
title: >-
  Automations: действия, ограничения автономности во флоте и встроенное правило
  назначенных задач
status: Done
assignee: []
created_date: '2026-09-26 23:05'
updated_date: '2026-09-27 00:03'
labels:
  - automation
  - swarm
dependencies:
  - TASK-74.2
parent_task_id: TASK-74
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 п. 1, 6, 7. Действия runAgent (одиночный слот и цикл до готовности, origin automation, бюджет запуска), runChecks, reindexDocs, notify, projectAction; запрет yolo и --dangerously-skip-permissions для автономных запусков; builtin:assigned-tasks поверх decideAutoStart вместо прямого вызова из backlogWatcher.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все пять действий выполняются и оставляют итог в журнале; projectAction с requiresConfirmation отклоняется
- [x] #2 Автономные запуски идут только через HITL с политикой роли: нет fallback на --dangerously-skip-permissions и yolo; исчерпанный бюджет останавливает агента и приостанавливает правило
- [x] #3 Автозапуск назначенных задач работает встроенным правилом; тесты assignedTaskRules без изменений зелёные
<!-- AC:END -->
