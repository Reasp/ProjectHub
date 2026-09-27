---
id: TASK-78.1
title: >-
  TASK-78.1 Чистые модули визуальной верификации: ui-smoke, артефакты,
  browser_*, evidence, сравнение кадров
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
Чистые модули без Electron (правило 17) по decision-55: формат проверки ui-smoke и сбор артефактов с лимитами и ротацией, каталог и классификация инструментов browser_*, скриншоты как evidence в отчёте Done-loop, попиксельное сравнение кадров.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Формат ui-smoke (kind, artifacts.from, minScreenshots, плейсхолдер artifactsDir), дефолт по скрипту ui-smoke и счётчики Playwright Test покрыты unit-тестами
- [x] #2 Сбор артефактов (расширения, лимиты файла/проверки, путь только внутри рабочего каталога) и план ротации хранилища покрыты unit-тестами
- [x] #3 Каталог browser_* и вердикт page/host с автономностью и рабочим каталогом покрыты unit-тестами
- [x] #4 Поле screenshots в отчёте, сверка с артефактами итерации, метка [ui] и Final Summary покрыты unit-тестами
- [x] #5 imageDiff.mjs (допуск, доля, маски, разный размер) покрыт unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: browserToolCatalog.ts (каталог browser_* @playwright/mcp 0.0.82, общие правила по filename/paths/url, browser_run_code_unsafe — всегда host), visualArtifacts.ts (формат ui-smoke, отбор с лимитами 15 МБ/40 файлов/60 МБ, план ротации 1 ГБ/30 дней, путь чтения, разрешение ссылок на скриншоты), поле screenshots и метка [ui] в doneLoop.ts, счётчики Playwright Test в arenaChecks.ts, scripts/visual/imageDiff.mjs. Тесты: browserToolCatalog, visualArtifacts, doneLoopScreenshots, imageDiff.
<!-- SECTION:NOTES:END -->
