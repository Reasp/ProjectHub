---
id: "task-12"
title: "Сводная аналитика и активность проекта (Project Analytics & Activity Dashboard)"
status: "Done"
assignee: []
created_date: "2026-08-31"
labels:
  - analytics
  - dashboard
  - metrics
  - git
  - backlog
  - ui
dependencies: []
priority: "medium"
type: "feature"
---

# task-12: Сводная аналитика и активность проекта (Project Analytics & Activity Dashboard)

## Description
Разработать сводную панель аналитики и метрик активности проекта (Project Analytics Dashboard): визуализация прогресса задач, распределение по статусам и тегам, динамика коммитов Git и статистика базы знаний Vector RAG.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Модальная панель или экран аналитики проекта `ProjectAnalyticsModal.tsx`.
- [x] #2 Метрики прогресса бэклога: круговые/линейные диаграммы соотношения задач (`Done`, `In Progress`, `Review`, `To Do`), процент готовности, топ тегов.
- [x] #3 Метрики Git-активности: статистика коммитов, распределение по авторам, количество измененных файлов.
- [x] #4 Метрики базы знаний RAG: количество проиндексированных чанков и документов LanceDB, размер индекса, дата последней сборки.
- [x] #5 Кнопка вызова аналитики в шапке проекта (`Header.tsx`).
<!-- AC:END -->
