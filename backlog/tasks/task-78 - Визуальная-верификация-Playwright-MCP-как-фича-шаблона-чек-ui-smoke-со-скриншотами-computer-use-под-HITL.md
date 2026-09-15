---
id: TASK-78
title: >-
  Визуальная верификация: Playwright MCP как фича шаблона, чек ui-smoke со
  скриншотами, computer use под HITL
status: To Do
assignee: []
created_date: '2026-09-15 03:13'
labels:
  - ai
  - playwright
  - computer-use
  - template
  - quality
milestone: m-0
dependencies: []
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GPT-6 Astra — первая модель с сильным computer use (OSWorld 2.0 — 72,6 %), Claude тоже верифицирует изменения запуском приложения (скилл `run`). Сейчас чеки ProjectHub — только lint/test/build; агент не может «посмотреть» на результат в браузере или в самом Electron-приложении. Задача добавляет визуальную верификацию как опциональную часть контура (doc-10).

## Что сделать
1. Фича шаблона `features.playwright` в `infra.config.json`/`setup.mjs`: добавляет Playwright MCP (`@playwright/mcp`) в `.mcp.json` и `.agents/mcp_config.json`; правило в `infra-dev.md` о том, когда агент обязан проверить UI.
2. Чек `ui-smoke` в `arenaChecks`: команда из `.projecthub.json` (например `npx playwright test --project smoke`), артефакты (скриншоты/trace) складываются в каталог сессии и показываются в Arena рядом с диффом.
3. Для ProjectHub как проекта: сценарий самопроверки — запуск `release/win-unpacked/ProjectHub.exe` (с учётом переменной `ELECTRON_RUN_AS_NODE` в shell агента), скриншот главного окна через Playwright Electron API, сравнение с базовым (порог различий).
4. Скриншоты в структурированном отчёте Done-loop как evidence для AC про UI.
5. Ограничения: computer use за пределами worktree/браузера проекта — только по явному HITL-одобрению; в Automations запрещён.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Фича playwright в шаблоне: setup.mjs добавляет/убирает Playwright MCP в обоих MCP-конфигах; правило в infra-dev.md и sync-rules
- [ ] #2 Чек ui-smoke с артефактами (скриншоты/trace) отображается в Arena и учитывается судьёй
- [ ] #3 Самопроверка ProjectHub: скриншот главного окна собранного exe через Playwright Electron с сравнением с базовым
- [ ] #4 Скриншоты принимаются как evidence в отчёте Done-loop
- [ ] #5 Computer use вне проекта требует HITL-одобрения и запрещён в Automations; lint/test зелёные
<!-- AC:END -->
