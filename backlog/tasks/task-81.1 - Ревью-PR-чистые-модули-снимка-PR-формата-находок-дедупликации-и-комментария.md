---
id: TASK-81.1
title: 'Ревью PR: чистые модули снимка PR, формата находок, дедупликации и комментария'
status: Done
assignee: []
created_date: '2026-09-27 00:11'
updated_date: '2026-09-28 04:53'
labels:
  - review
  - pr
dependencies: []
parent_task_id: TASK-81
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 п. 1, 5, 6, 8. prSnapshot.ts (diffPrSnapshot: базовая линия, opened, updated по head SHA), prReviewFormat.ts (промпты ревьюера и проверяющего, разбор оград projecthub-review и projecthub-verify, zod, синонимы серьёзности), dedupeFindings и ранжирование, построитель комментария с маскировкой секретов и команды gh pr comment. Без Electron и fs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 diffPrSnapshot: первая встреча проекта — без событий; новый номер — opened; другой head SHA — updated; закрытые PR не дают событий
- [x] #2 Разбор находок и вердиктов толерантен к ограде, лишнему тексту и синонимам; неверный ответ не бросает исключение
- [x] #3 Дедупликация склеивает находки об одном месте и считает согласие; комментарий строится только из подтверждённых, секреты маскируются, команда публикации — только pr comment
<!-- AC:END -->
