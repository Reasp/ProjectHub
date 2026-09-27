---
id: TASK-74.2
title: 'Automations: automationService, хранение, доверие к проектным правилам, журнал'
status: Done
assignee: []
created_date: '2026-09-26 23:03'
updated_date: '2026-09-27 00:03'
labels:
  - automation
  - eventbus
dependencies:
  - TASK-74.1
parent_task_id: TASK-74
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 п. 2, 3, 4, 5. automations.json и automations-state.json в userData, секция automations в .projecthub.json, доверие по хэшу правила, планировщик с тиком 30 с, подписка на шину, taskEventSource и событие task:updated, журнал automations-log.jsonl с ротацией, события automation:suspended и automation:notify, вид уведомления automation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Проектное правило не срабатывает без подтверждения человеком на этой машине и снова требует подтверждения после изменения содержимого
- [x] #2 cron-правило и правило на событие шины запускают действие и пишут журнал; ротация журнала работает; состояние переживает перезапуск
- [x] #3 task:updated публикуется с изменениями статуса и исполнителя; automation:suspended доходит до notificationService
<!-- AC:END -->
