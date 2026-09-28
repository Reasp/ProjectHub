---
id: TASK-81.3
title: 'Ревью PR: prReviewService, ревьюеры на чтение во флоте и проверяющий'
status: Done
assignee: []
created_date: '2026-09-27 00:11'
updated_date: '2026-09-28 04:53'
labels:
  - review
  - swarm
dependencies:
  - TASK-81.2
parent_task_id: TASK-81
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-53 п. 3, 4, 6, 7, 9. Голова PR в refs/projecthub/pr/N, fan-out с меткой review и суженными правами, разбор ответов, дедупликация, проверяющий, запись ревью в userData/pr-reviews, заметка в задаче, событие pr:reviewFinished и вид уведомления prReview.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ревьюеры работают в worktree головы PR только на чтение; автосудья и заметки хода для сессий ревью не запускаются
- [x] #2 Находки дедуплицируются и проверяются отдельным проходом; неподтверждённые не попадают в комментарий
- [x] #3 Повторное ревью того же head SHA не запускается; стоимость и бюджет 70/30 учитываются
<!-- AC:END -->
