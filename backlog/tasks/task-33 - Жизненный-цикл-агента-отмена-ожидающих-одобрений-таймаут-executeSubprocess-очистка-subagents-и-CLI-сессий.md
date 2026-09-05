---
id: TASK-33
title: >-
  Жизненный цикл агента: отмена ожидающих одобрений, таймаут executeSubprocess,
  очистка subagents и CLI-сессий
status: Review
assignee:
  - Claude
created_date: '2026-09-05 09:07'
updated_date: '2026-09-05 21:21'
labels:
  - audit
  - memory-leak
  - ai-studio
  - P1
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - electron/main.ts
  - src/store/useAIStudioStore.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/claudeBridgeService.ts
  - electron/services/aiAgentService.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useAIStudioStore.ts
  - tests/unit/claudeBridgeService.test.ts
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 1.3, 1.4, 2.3 (doc-7).

`claudeBridgeService.requestApproval` создаёт промис, который никогда не отклоняется: при `abortSession`, `clearSession` или закрытии окна `runAgentTask` висит навсегда, статус проекта остаётся `waiting_approval`, замыкание держит все сообщения. `executeSubprocess` не имеет таймаута и лимита вывода: команда вроде `npm run dev` подвешивает цикл агента, а `output` растёт без предела. `activeSubagents` никогда не переводятся в `completed` и не удаляются, `sessionClaudeCliIds` не очищается (метод `clearSession` не подключён к IPC), `projectStatuses` растёт с числом проектов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pendingApprovals хранит resolve и reject; abortSession/clearSession отклоняют все ожидающие одобрения данной сессии и переводят статус проекта в idle
- [x] #2 executeSubprocess принимает таймаут (настраиваемый, по умолчанию 5 минут) и лимит вывода (например, 1 МБ с усечением), по истечении процесс убивается через tree-kill
- [x] #3 Долгоживущие команды (dev-серверы) агент может запускать через processManager в фоне, а не блокируя цикл
- [x] #4 Подагенты получают статус completed/failed при завершении родительской сессии и удаляются из activeSubagents по завершении сессии
- [x] #5 Добавлен IPC ai:clearSession, вызываемый из useAIStudioStore.clearSession/closeSession, который чистит sessionClaudeCliIds и активные процессы
- [x] #6 При закрытии окна performGracefulShutdown убивает все activeProcesses claudeBridgeService
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План (после исследования кода)

Контекст: `runAgentTask` (API-путь) получает tool-calls из `aiAgentService.streamChat`, а обработчик чанков — `async`-колбэк, который никто не await'ит. Значит отклонение промиса `requestApproval` нельзя пробрасывать наружу — его нужно ловить внутри обработчика. В `getAnthropicTools` инструмент `run_command` не объявлен, хотя мост его обрабатывает — для AC #3 объявляем его с полями `background`/`name`.

1. **claudeBridgeService.ts**
   - `pendingApprovals: Map<id, {sessionId, projectPath, resolve, reject}>`; `rejectPendingApprovals(sessionId, reason)` отклоняет их `ApprovalCancelledError` и переводит статус проекта в `idle`. Вызывается из `abortSession` (и через него из `clearSession`) и из `killAll()`.
   - Реестр активных сессий `activeSessions: Map<sessionId, projectPath>` (ставится в начале `runAgentTask`, снимается в `finishSession`). `abortSession` работает только по нему; для CLI-пути помечает сессию `abortedSessions`, чтобы `close` завершил её как `idle`/«Отменено», а не `error`. Убийство процессов — через `tree-kill` (при `shell:true` `proc.kill()` убивал только оболочку).
   - Обработчик tool-call'ов обёрнут в try/catch: `ApprovalCancelledError` → `tc.status='rejected'`, прочие ошибки → `tc.status='error'` (раньше это были бы unhandled rejection).
   - `executeSubprocess(cmd, cwd, onProgress, {timeoutMs, maxOutputBytes, sessionId})`: таймаут по умолчанию 5 мин (`autoApproveRules.commandTimeoutSec` переопределяет), лимит вывода 1 МБ с усечением «хвоста», по таймауту `tree-kill` и результат с подсказкой про `background: true`. `onProgress` получает уже ограниченный снимок вывода (раньше вызывающий код копил `liveOutput` без лимита). Дочерние процессы регистрируются по сессии и убиваются в `abortSession`/`killAll`.
   - Два дублирующихся блока запуска команды → один `runCommandTool`. При `args.background === true` команда стартует через `processManager.startProcess(projectPath, cmd, name)` и сразу возвращает pid/id.
   - Подагенты: `finishSessionSubagents(sessionId, status)` — при завершении сессии `running` → `completed` (done) / `failed` (error/abort), событие `subagentUpdated`, затем удаление из `activeSubagents`.
   - `setProjectStatus(..., 'idle')` удаляет запись из `projectStatuses` (геттер и так возвращает idle по умолчанию).
   - `killAll()` для shutdown: отклонить все одобрения, убить CLI-процессы и subprocess'ы.
2. **aiAgentService.ts**: `AutoApproveRules.commandTimeoutSec?`; tool `run_command` (command, explanation, background, name).
3. **main.ts**: IPC `ai:clearSession`; `performGracefulShutdown` → `claudeBridgeService.killAll()`.
4. **preload.ts / electron.d.ts**: `clearAISession(sessionId)`, `commandTimeoutSec`.
5. **useAIStudioStore.ts**: `clearSession`/`closeSession` вызывают `clearAISession`, сбрасывают `isStreaming`, если чистится активный стрим, и убирают pendingApprovals этой сессии.
6. **tests/unit/claudeBridgeService.test.ts** (vitest, `vi.mock('electron')`): отклонение одобрений при abort, таймаут и лимит вывода `executeSubprocess`, завершение подагентов, очистка CLI-id.
7. `npx tsc --noEmit`, `npm test`, `npm run lint:docs`, `npm run pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Решения по ходу работы:
- Обработчик чанков `streamChat` — async-колбэк без await, поэтому отклонённый промис `requestApproval` ловится внутри (`handleApiToolCall` в try/catch): `ApprovalCancelledError` → `tc.status='rejected'`, прочие ошибки → `'error'`. Раньше любая ошибка инструмента (например, `applyDiff`) была бы unhandled rejection.
- В `getAnthropicTools` не было `run_command`, хотя мост его обрабатывал; объявлен с `background`/`name` — иначе AC #3 недостижим для API-пути. В CLI-пути команды выполняет сам Claude Code, мост туда не вмешивается.
- Убийство процессов переведено на `tree-kill`: при `shell: true` `child.kill()` убивал только оболочку (cmd/powershell), а `claude`/`npm` оставались жить.
- `setProjectStatus(..., 'idle')` удаляет запись из `projectStatuses` (геттер и так отдаёт idle по умолчанию) — реестр больше не растёт с числом проектов.
- Прерванная CLI-сессия завершается как `idle` + «(Отменено пользователем)» через `abortedSessions`, а не как `error` с «кодом null».
- Известное ограничение (вне задачи): если стрим API завершился, пока инструмент ждёт одобрения, статус проекта уже `done`; отклонение при abort всё равно работает по sessionId одобрения.

Проверка: `npx tsc --noEmit` — чисто; `npm test` — 27/27 (в т.ч. 10 новых); `npm run lint:docs` — ок; `npm run pack:win` — собран `release/win-unpacked/ProjectHub.exe`.

Нюанс тестов на Windows: `executeSubprocess` запускает PowerShell, путь к `node.exe` в кавычках вызывается через `&`, а `-Command` сводит ненулевой код нативной команды к 1 (см. TASK-40).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано

**claudeBridgeService.ts**
- `pendingApprovals` хранит `{sessionId, projectPath, resolve, reject}`. `rejectPendingApprovals(sessionId?, reason?)` отклоняет ожидания `ApprovalCancelledError` и переводит статус проекта из `waiting_approval` в `idle`; вызывается из `abortSession`, `clearSession`, `killAll`.
- Реестр `activeSessions` (sessionId → projectPath) и единая точка завершения `finishSession(done|error|aborted)`: статус проекта, подагенты, снятие с учёта. Прерванная сессия (API и CLI) завершается как `idle`/«Отменено пользователем», а не `error`.
- `executeSubprocess` стал публичным, возвращает `{output, exitCode, timedOut, truncated}`; таймаут по умолчанию 5 мин (`autoApproveRules.commandTimeoutSec` переопределяет), лимит вывода 1 МБ с усечением до «хвоста», убийство дерева процессов через `tree-kill`; `onProgress` получает уже ограниченный снимок (раньше вызывающий код копил `liveOutput` без лимита). Дочерние процессы учитываются по сессии и гибнут в `abortSession`/`killAll`.
- Два дублирующихся блока запуска команды → `runCommandTool`; `background: true` запускает команду через `processManager.startProcess` и сразу возвращает pid/id, не блокируя цикл агента.
- `finishSessionSubagents(sessionId, completed|failed)`: работающие подагенты получают итоговый статус с событием `subagentUpdated`, затем все подагенты сессии удаляются из `activeSubagents`.
- `clearSession` чистит `sessionClaudeCliIds`, процессы, одобрения, подагентов; `killAll()` — для выхода из приложения. `idle` не хранится в `projectStatuses`.

**aiAgentService.ts** — `AutoApproveRules.commandTimeoutSec?`; объявлен инструмент `run_command` (command, explanation, background, name) — раньше мост обрабатывал его, но модель не могла его вызвать.

**main.ts / preload.ts / electron.d.ts** — IPC `ai:clearSession` (`window.api.clearAISession`), `performGracefulShutdown` вызывает `claudeBridgeService.killAll()`.

**useAIStudioStore.ts** — `closeSession`/`clearSession` вызывают `clearAISession`, сбрасывают `isStreaming`, если чистится активный стрим, и убирают `pendingApprovals` этой сессии.

## Тесты
`tests/unit/claudeBridgeService.test.ts` (10 тестов, `vi.mock('electron')`): резолв/отклонение одобрений по сессии, `killAll`, вывод и код выхода, таймаут с tree-kill и снятием с учёта, усечение вывода и ограниченный `onProgress`, убийство команд при `abortSession`, завершение и удаление подагентов, очистка CLI-id. Итого `npm test` — 27/27, `tsc --noEmit` чисто, `lint:docs` ок, `pack:win` собран.

## Риски / follow-up
- Настройка `commandTimeoutSec` есть в конфиге, но без UI (можно добавить в настройки авто-одобрения, если понадобится).
- Реальный HITL для CLI-режима — TASK-42; PowerShell-специфика команд — TASK-40.
<!-- SECTION:FINAL_SUMMARY:END -->
