---
id: TASK-77.4
title: 'UI менеджера ролей: синхронизация в проект, предпросмотр, расхождения, i18n'
status: Review
assignee: []
created_date: '2026-09-27 04:17'
updated_date: '2026-09-27 04:54'
labels:
  - roles
  - ui
dependencies: []
parent_task_id: TASK-77
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Панель в RolesSettingsModal: список файлов со статусами, предпросмотр содержимого, «Синхронизировать в проект», перезапись конфликтов, удаление orphan, настройки хуков и команда переменных окружения для внешнего терминала; строки ru/en; origin terminal в Центре решений.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Предпросмотр и синхронизация работают из UI
- [x] #2 Индикатор расхождений в менеджере ролей
- [x] #3 Настройки хуков и команда окружения; i18n ru/en
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RoleSyncPanel + roleSyncView.ts (тесты), кнопка с индикатором в RolesSettingsModal, источник «Терминал» и длительность в Центре решений; скриншоты scratchpad/shots77/shots.
<!-- SECTION:NOTES:END -->
