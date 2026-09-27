---
id: TASK-78.3
title: 'TASK-78.3 UI артефактов в Arena и Done-loop, вид ui-smoke в настройках, i18n'
status: Done
assignee: []
created_date: '2026-09-27 05:15'
updated_date: '2026-09-27 05:59'
labels:
  - playwright
  - ui
dependencies: []
parent_task_id: TASK-78
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Галерея миниатюр во вкладке проверок кандидата, просмотр в модалке через createPortal (decision-17), миниатюры под критериями Done-loop, вид ui-smoke в ArenaSettingsModal, ru/en.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вкладка проверок кандидата показывает миниатюры и открывает просмотр; trace — показать в папке
- [x] #2 Панель Done-loop показывает скриншоты под критериями и число артефактов у проверок
- [x] #3 В настройках проверок есть вид ui-smoke; тексты ru/en
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: CheckArtifactsGallery (миниатюры object-contain, просмотр через createPortal z-[9999], Escape, «показать в папке»), вкладка «Проверки» кандидата, панель Done-loop (число скриншотов у проверки, галерея, скриншоты под критерием), вид проверки и поля ui-smoke в ArenaSettingsModal, ключи ru/en. Проверено скриншотами копии приложения на данных живого прогона (EN и RU).
<!-- SECTION:NOTES:END -->
