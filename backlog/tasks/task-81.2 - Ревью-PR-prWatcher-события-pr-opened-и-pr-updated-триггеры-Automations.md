---
id: TASK-81.2
title: 'Ревью PR: prWatcher, события pr:opened и pr:updated, триггеры Automations'
status: Done
assignee: []
created_date: '2026-09-27 00:11'
updated_date: '2026-09-28 04:53'
labels:
  - review
  - automation
dependencies:
  - TASK-81.1
parent_task_id: TASK-81
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 п. 1, 2. Опрос gh pr list для проектов с включёнными правилами, снимок в userData/pr-watch.json, пауза при ошибках, события шины; триггеры pr.opened и pr.updated в automationRules и UI редактора.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый PR и новый коммит в PR дают события шины; PR, открытый при закрытом приложении, даёт событие после запуска
- [x] #2 Без gh, авторизации или сети опрос не падает, а ставит проект на паузу с одной записью в лог
<!-- AC:END -->
