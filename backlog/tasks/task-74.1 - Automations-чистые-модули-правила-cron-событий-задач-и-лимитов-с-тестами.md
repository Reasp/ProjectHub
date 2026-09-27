---
id: TASK-74.1
title: 'Automations: чистые модули правила, cron, событий задач и лимитов с тестами'
status: Done
assignee: []
created_date: '2026-09-26 23:02'
updated_date: '2026-09-27 00:03'
labels:
  - automation
  - scheduler
dependencies: []
parent_task_id: TASK-74
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-52 п. 1, 2, 4, 5, 6. automationRules.ts (zod-схема правила, матчинг события и условий, cooldown, дневные лимиты и бюджет, причинность и глубина цепочки, хэш правила для доверия, шаблон промпта), cronExpr.ts (разбор 5 полей и макросов, следующее срабатывание в локальном времени, DST, пропущенные срабатывания), taskSnapshot.ts (снимок frontmatter задачи и diffTaskSnapshot). Без Electron и fs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Схема правила отклоняет неизвестные триггеры и действия, требует dailyBudgetUsd для runAgent; матчинг покрывает все триггеры и условия
- [x] #2 cron: разбор полей, списков, диапазонов, шагов, имён и макросов; следующее срабатывание, OR дня месяца и недели, DST без двойного запуска, политика catchUp
- [x] #3 Cooldown, дневные лимиты, пауза до полуночи, причинность (само правило не реагирует на свой запуск, глубина больше 3 отклоняется) и diffTaskSnapshot покрыты unit-тестами
<!-- AC:END -->
