---
id: TASK-73.2
title: >-
  TASK-73.2 сервис Security Health: аудит по кнопке, кэш в userData, создание
  задачи из находки, вкладка проекта
status: Review
assignee: []
created_date: '2026-09-27 06:12'
updated_date: '2026-09-27 07:03'
labels:
  - security
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 п. 2, 9. securityHealthService (npm/pip-audit, single-flight, интервал 10 минут, кэш <userData>/security), IPC, вкладка «Безопасность» в ProjectWorkspace, i18n ru/en, настройка registryLookups.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка запускает аудит, панель показывает уровни, advisories со ссылками и статусы экосистем (нет lock, не установлен, офлайн)
- [x] #2 Создать задачу из находки — задача Backlog с label security, повтор показывает id
- [x] #3 Кэш в userData, при открытии проекта сеть не трогается
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
securityHealthService (npm audit, pip-audit в режиме --no-deps --disable-pip, single-flight, интервал 10 минут только для Automations, кэш <userData>/security, настройки registryLookups), IPC security:*, вкладка «Безопасность» (SecurityHealthView), i18n ru/en. Живая проверка: настоящий npm audit на C:\Temp\ph-task73 — Critical 1 (minimist) / High 1 (lodash), advisories со ссылками; «Создать задачу» → TASK-2 с label security; повтор — «Задача уже есть». Скриншоты: 02-security-after-cron, 03-task-created.
<!-- SECTION:NOTES:END -->
