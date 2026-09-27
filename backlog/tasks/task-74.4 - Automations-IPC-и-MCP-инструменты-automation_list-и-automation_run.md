---
id: TASK-74.4
title: 'Automations: IPC и MCP-инструменты automation_list и automation_run'
status: Done
assignee: []
created_date: '2026-09-26 23:06'
updated_date: '2026-09-27 00:03'
labels:
  - automation
  - mcp
dependencies:
  - TASK-74.3
parent_task_id: TASK-74
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 п. 8. IPC (список, сохранение глобальных правил, подтверждение проектных, вкл/выкл, запуск сейчас, снятие паузы, журнал), preload и типы; automation_list/automation_run во встроенном MCP-сервере, отказ automation_run из сессии агента.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 automation_list возвращает правила, состояние и последние запуски; automation_run запускает правило для внешнего клиента и отклоняется из сессии агента
- [x] #2 IPC-операции покрыты тестами сервиса; типы рендерера согласованы
<!-- AC:END -->
