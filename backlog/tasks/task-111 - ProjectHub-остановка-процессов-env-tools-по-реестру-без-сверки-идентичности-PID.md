---
id: TASK-111
title: >-
  ProjectHub: остановка процессов env-tools по реестру без сверки идентичности
  PID
status: To Do
assignee: []
created_date: '2026-09-28 00:43'
labels:
  - env-tools
  - processes
dependencies:
  - TASK-110
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено в TASK-110 (decision-59). Тот же паттерн, что был в env-tools, но в самом приложении:

- `electron/services/processManager.ts` → `stopEnvToolsProcess`: `isPidAlive(entry.pid)` (только `process.kill(pid, 0)`), затем `treeKill(pid, 'SIGKILL')` по pid из `.env-state/processes.json`. Кнопка «Остановить» на вкладке процессов по устаревшей записи убьёт чужое дерево. Проверено 2026-09-28: запись shot-81b указывала на pid 38880 — `backlog.exe` (MCP-сервер сессии агента), pack-win-72c — на `conhost.exe`.
- `processManager.ts` → `listProcessesForProject`: статус `running` для таких записей.
- `electron/services/projectScanner.ts` (раздел «7. Process Status»): `runningCount` считает такие записи работающими.

Что сделать: сверять `pidCreatedAt` записи (мс Unix, время создания процесса по ОС — формат decision-59) с временем создания процесса. Снимок уже есть: `listWindowsProcesses()` в `electron/services/processSweep.ts` отдаёт `createdAt` в тех же единицах (CIM CreationDate совпадает с Process.StartTime до мс). Для записей без `pidCreatedAt` — правило decision-59: процесс создан позже `startedAt` → мёртвая; иначе «неизвестно», не убивать, только удалять запись. Hub-процессы (свои ChildProcess) не затрагиваются.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 stopEnvToolsProcess не убивает процесс, если pid записи переиспользован или идентичность не подтверждена — покрыто тестом
- [ ] #2 listProcessesForProject и projectScanner не показывают такие записи как работающие
- [ ] #3 Проверка идентичности — один снимок процессов на вызов, а не запрос на запись
<!-- AC:END -->
