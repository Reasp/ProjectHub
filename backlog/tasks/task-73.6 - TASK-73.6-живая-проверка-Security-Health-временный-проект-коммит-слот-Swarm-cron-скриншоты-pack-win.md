---
id: TASK-73.6
title: >-
  TASK-73.6 живая проверка Security Health: временный проект, коммит, слот
  Swarm, cron, скриншоты, pack:win
status: Done
assignee: []
created_date: '2026-09-27 06:13'
updated_date: '2026-09-28 04:53'
labels:
  - security
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56. Временный проект C:\Temp\ph-task73 с уязвимой зависимостью и секретом; настоящий npm audit; коммит из GitInspector; слот Swarm с новым пакетом и ключом; правило cron; скриншоты UI; pack:win.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Живой npm audit → панель → задача создана
- [x] #2 Коммит с секретом из GitInspector отклонён, override записан в аудит
- [x] #3 Слот Swarm с пакетом и ключом: блок в карточке, штраф, HITL при слиянии
- [x] #4 Правило cron запустило аудит; скриншоты сняты; pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Живая проверка 2026-09-27 (подробности — decision-56, раздел «Реализация и уточнения»): временный проект C:\Temp\ph-task73 (lodash 4.17.20, minimist 1.2.5). Агенты — настоящим кодом во временном vitest (2 слота Claude haiku, $0.08); UI — копия ProjectHub (electron.exe поверх vite build, отдельный userData, файл реестра проектов подменён хуком в обёртке-точке входа: Playwright не передаёт NODE_OPTIONS). Cron-правило → npm audit → уведомление securityFinding; вкладка → TASK-2; GitInspector: отказ и override с аудитом; карточки слотов, Pick Winner → Центр решений → слияние. Скриншоты — в scratchpad сессии (shots73). pack:win: цепочка npm run build на этой машине падает на флейках checkpointGit/agentFleetOrphans (EBUSY, тайм-аут) — так же на исходном HEAD 7a41e20 в отдельном worktree; шаги build выполнены по отдельности (docs, индекс, lint 0/494, тесты 174/1975, tsc, vite build, check-bundle), затем electron-builder --dir и patch-exe-icon; selfcheck:ui собранного exe — 0,01 %.
<!-- SECTION:NOTES:END -->
