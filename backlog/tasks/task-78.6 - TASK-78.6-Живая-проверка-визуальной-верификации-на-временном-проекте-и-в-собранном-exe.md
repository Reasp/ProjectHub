---
id: TASK-78.6
title: >-
  TASK-78.6 Живая проверка визуальной верификации на временном проекте и в
  собранном exe
status: Done
assignee: []
created_date: '2026-09-27 05:16'
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
Временный проект с веб-страницей: ui-smoke через настоящий Playwright в Arena или Done-loop, Claude Code (haiku) с Playwright MCP снимает страницу, самопроверка ProjectHub, скриншоты UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ui-smoke через настоящий Playwright: скриншот в Arena или отчёте Done-loop
- [x] #2 Claude Code с Playwright MCP открывает страницу и делает снимок; host-инструмент уходит в HITL
- [x] #3 Самопроверка ProjectHub на собранном exe со сравнением с базой
- [x] #4 Скриншоты UI сняты; lint/test/check-bundle зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: временный проект (статическая страница, Playwright Test на системном Chrome 153). Done-loop на Claude CLI haiku: 1 итерация, $0.066, ui-smoke снял home.png, критерий [ui] засчитан по screenshots, задача в Review, Final Summary со скриншотом. Claude Code + Playwright MCP из .mcp.json от setup.mjs: navigate/snapshot/screenshot, $0.045. browser_run_code_unsafe: карточка HITL при auto-approve (отклонена), в запуске origin automation — отказ без карточки. Самопроверка exe совпала с базой. lint 0/494, test 166/1874, check-bundle ok, pack:win собран (exe 13:53). Скриншоты UI — в scratchpad сессии (shots78/shots).
<!-- SECTION:NOTES:END -->
