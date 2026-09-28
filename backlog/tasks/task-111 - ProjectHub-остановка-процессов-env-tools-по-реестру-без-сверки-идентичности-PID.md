---
id: TASK-111
title: >-
  ProjectHub: остановка процессов env-tools по реестру без сверки идентичности
  PID
status: Done
assignee: []
created_date: '2026-09-28 00:43'
updated_date: '2026-09-28 04:53'
labels:
  - env-tools
  - processes
dependencies:
  - TASK-110
modified_files:
  - electron/services/envRegistryIdentity.ts
  - electron/services/processSweep.ts
  - electron/services/processManager.ts
  - electron/services/projectScanner.ts
  - src/types/electron.d.ts
  - src/components/processes/ProcessesView.tsx
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - tests/unit/envRegistryIdentity.test.ts
  - tests/unit/processManager.test.ts
  - tests/unit/projectScanner.test.ts
  - >-
    backlog/decisions/decision-60 -
    ProjectHub-сверка-процессов-env-tools-по-времени-старта-статус-unknown-и-общий-снимок-процессов.md
  - >-
    backlog/decisions/decision-59 -
    env-tools-идентичность-процесса-в-реестре-по-времени-старта-и-чистка-мёртвых-записей.md
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
- [x] #1 stopEnvToolsProcess не убивает процесс, если pid записи переиспользован или идентичность не подтверждена — покрыто тестом
- [x] #2 listProcessesForProject и projectScanner не показывают такие записи как работающие
- [x] #3 Проверка идентичности — один снимок процессов на вызов, а не запрос на запись
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Решение — decision-60 (связано с decision-59, decision-37).

Сделано:
- `electron/services/envRegistryIdentity.ts` (чистый модуль, без Electron): `entryStatus` — правило decision-59 (pidCreatedAt ±1000 мс; без pidCreatedAt: процесс создан позже startedAt → dead, иначе unknown); `resolveEntryStatuses` — один снимок на вызов, только если kill(0) нашёл живые pid; `createSnapshotCache` — общий кэш с дедупликацией параллельных запросов; `snapshotIsStaleFor` — кэш заменяется свежим снимком, если он старше записи.
- `processSweep.ts`: `listPosixProcesses` (`ps -A -o pid=,ppid=,lstart=`, LC_ALL=C), `listProcesses()`, `processSnapshotCache`, `envToolsEntryStatuses`. На Windows переиспользован `listWindowsProcesses()` (CIM).
- `processManager.ts`: `stopEnvToolsProcess` — свежий снимок; treeKill только при running; dead/unknown — только удаление записи; сбой снимка — исключение, запись не трогается; перед записью реестр перечитывается. `restartProcess` для unknown отказывает (иначе копия рядом с возможно живым оригиналом). `listProcessesForProject` — dead → stopped, unknown — отдельный статус.
- `projectScanner.ts`: `runningCount` — только running; снимок общий для всех проектов (кэш 10 с).
- UI: `ManagedProcess.status` + `'unknown'`; во вкладке процессов жёлтая плашка «Не подтверждён» с подсказкой, кнопка «Удалить запись» вместо «Остановить», перезапуск неактивен; `envToolsHint` ru/en обновлён.

Проверки:
- `npm run lint`: 0 ошибок, 494 предупреждения (baseline); `npm test`: 177 файлов / 1999 тестов; `pack:win` зелёный (check-bundle, tsc внутри); `index-docs`, `lint:docs` — ок.
- Тесты: `envRegistryIdentity.test.ts` (15); в `processManager.test.ts` записи env-tools пишутся с настоящим pidCreatedAt из снимка ОС, добавлен сценарий «PID переиспользован/не подтверждён»: посторонний живой процесс переживает stopProcess, restartProcess для unknown отклонён, сбой снимка → ошибка без kill и без удаления записи; в `projectScanner.test.ts` — runningCount = 1 из трёх записей на один pid. Тест TTL (аудит 2.1) проверяет лог до listProcessesForProject: список теперь сверяет реестр хаба снимком дольше TTL 200 мс.
- Фикстура — копия реестра хаба до чистки (C:\Temp\ph-111\processes.orig.json, 85 записей): kill(0) считал живыми 2, новое правило — dead все 85, включая shot-81b и pack-win-72c; снимок ~535 мс, повтор из кэша — 0 мс.
- Живая проверка в собранном exe (Playwright, отдельный --user-data-dir, подмена projects:list на временный проект): три записи на один живой pid показаны как «Работает» / «Не подтверждён» / «Остановлен», «Работает: 1»; «Удалить запись» у unknown удалила только запись, процесс жив; «Остановить» у running завершил процесс. selfcheck:ui не запускался: главное окно не менялось, правка во вкладке процессов.

Замечание: MCP env-tools этой сессии оказался на старом коде (pid-файл обёртки без времени старта, запись без pidCreatedAt), вопреки заметке передачи.
<!-- SECTION:NOTES:END -->
