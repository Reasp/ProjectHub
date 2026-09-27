---
id: TASK-78.5
title: >-
  TASK-78.5 Самопроверка ProjectHub: скриншот главного окна через Playwright
  Electron и сравнение с базой
status: Done
assignee: []
created_date: '2026-09-27 05:15'
updated_date: '2026-09-27 05:59'
labels:
  - playwright
  - quality
dependencies: []
parent_task_id: TASK-78
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
scripts/visual/selfcheck.mjs: exe или electron поверх vite build, отдельный user-data-dir, подмена projects:list, окно 1280x800, сравнение с tests/visual/baseline, --update-baseline.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm run selfcheck:ui снимает главное окно собранного exe и сравнивает с базой; diff сохраняется
- [x] #2 Запущенный ProjectHub пользователя и его userData не затрагиваются
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: npm run selfcheck:ui (scripts/visual/selfcheck.mjs, playwright-core 1.63.0 в devDependencies): exe или --dev, свой --user-data-dir, projects:list → [], окно 1280x800, page.screenshot scale css, сравнение через nativeImage, маска шапки по умолчанию, diff.png и selfcheck.json. База tests/visual/baseline/main-window.win32.png создана с собранного exe (--update-baseline), повторный прогон 0,00 %; в --dev два прогона 0,00 %, испорченная база — 2,02 % и провал. Настоящий userData не менялся.
<!-- SECTION:NOTES:END -->
