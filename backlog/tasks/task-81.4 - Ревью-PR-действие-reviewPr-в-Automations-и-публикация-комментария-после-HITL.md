---
id: TASK-81.4
title: 'Ревью PR: действие reviewPr в Automations и публикация комментария после HITL'
status: Done
assignee: []
created_date: '2026-09-27 00:11'
updated_date: '2026-09-28 04:53'
labels:
  - review
  - automation
  - hitl
dependencies:
  - TASK-81.3
parent_task_id: TASK-81
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 п. 2, 8. Действие reviewPr (дневной бюджет обязателен, черновики пропускаются), отложенный итог действия в движке, запрос HITL с текстом комментария, gh pr comment --body-file, режим manual.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Событие pr.opened запускает ревью через правило Automations (правила по умолчанию выключены)
- [x] #2 Комментарий публикуется только после одобрения HITL или кнопкой человека; отказ и тайм-аут не публикуют; approve невозможен
<!-- AC:END -->
