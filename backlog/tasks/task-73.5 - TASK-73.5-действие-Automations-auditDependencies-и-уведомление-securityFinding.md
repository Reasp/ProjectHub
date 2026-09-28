---
id: TASK-73.5
title: TASK-73.5 действие Automations auditDependencies и уведомление securityFinding
status: Done
assignee: []
created_date: '2026-09-27 06:13'
updated_date: '2026-09-28 04:53'
labels:
  - security
  - automations
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 п. 8, 10. Действие auditDependencies (схема, UI правила), событие security:finding, вид securityFinding в матрице каналов и настройках уведомлений, i18n.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Правило по cron запускает аудит, итог в журнале
- [x] #2 Новые находки не ниже minSeverity дают уведомление securityFinding через шину и notificationRules
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Действие auditDependencies (схема, форма, редактор, исполнитель, automationService), событие security:finding, вид securityFinding (трей, ОС, Telegram, Remote), клик openSecurity. Живая проверка: правило cron * * * * * выполнило настоящий npm audit (1,4 с, «critical 1, high 1; новых находок: 2»), уведомление securityFinding critical доставлено.
<!-- SECTION:NOTES:END -->
