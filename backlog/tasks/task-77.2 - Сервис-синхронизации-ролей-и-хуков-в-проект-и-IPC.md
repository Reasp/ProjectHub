---
id: TASK-77.2
title: Сервис синхронизации ролей и хуков в проект и IPC
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
roleSyncService: план (предпросмотр) и применение с атомарной записью, orphan и перезапись конфликтов только явно; IPC roles:syncPlan/roles:syncApply; настройки terminal-hooks.json. decision-54 п. 2, 9, 10.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Предпросмотр возвращает файлы, статус и содержимое
- [x] #2 Применение пишет атомарно, foreign не трогает, conflict/orphan — только по выбору
- [x] #3 Настройки хуков читаются и сохраняются с нормализацией
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
roleSyncService.ts (план/запись, atomic, conflict/orphan только по выбору), IPC roles:syncPlan/syncApply, terminalHooks:*; тесты roleSyncService.test.ts.
<!-- SECTION:NOTES:END -->
