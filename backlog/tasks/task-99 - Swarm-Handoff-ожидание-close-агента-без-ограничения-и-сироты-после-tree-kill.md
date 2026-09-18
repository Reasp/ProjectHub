---
id: TASK-99
title: 'Swarm/Handoff: ожидание close агента без ограничения и сироты после tree-kill'
status: Review
assignee: []
created_date: '2026-09-18 06:05'
updated_date: '2026-09-18 12:02'
labels:
  - agent
  - swarm
dependencies: []
references:
  - electron/services/agentFleetService.ts
  - electron/services/processSweep.ts
  - electron/services/claudeBridgeService.ts
  - tests/unit/agentFleetOrphans.test.ts
  - tests/unit/processSweep.test.ts
  - tests/unit/agentFleetPersistence.test.ts
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено при TASK-97 (decision-37). `agentFleetService` запускает агентов (`spawn('claude', …)` и `spawn(cmd, invocation.args, …)`, строки около 1499, 1750, 1890), завершает их только по событию `close` (строки 1636, 1820, 1936) и останавливает через собственный `killProcessTree` (tree-kill, на Windows `taskkill /T /F` по снимку дерева). Это тот же механизм, из-за которого в TASK-97 зависал `executeSubprocess`: потомок, созданный после снимка, переживает kill, держит stdio, и `close` не приходит.

Сделать по decision-37: завершение по `exit` с ограниченным ожиданием `close` и уничтожением потоков, добивание потомков через `electron/services/processSweep.ts` после остановки. Перед правкой проверить impact через GitNexus.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Остановка агента Swarm/Handoff завершает ожидание за ограниченное время, даже если stdio держит потомок
- [x] #2 Пережившие tree-kill потомки добиваются через processSweep.ts
- [x] #3 Сценарий покрыт unit-тестом с подменённым tree-kill
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Возможен ли сценарий (факты, 2026-09-18)
- Все три CLI-пути (`runClaudeCliAgent`, `runCodexCliAgent`, `runGeminiCliAgent`) запускаются через `spawn(..., { shell: true })`: корень — `cmd.exe /d /s /c`, движок — его потомок. Завершение шло только по `close`, остановка — `killProcessTree` (tree-kill). Точки остановки: `killAgentProcess` (стоп агента, бюджет), `stopSwarm`, `killAll` (выход из приложения), лимит ходов роли, ошибка записи промпта.
- Тест с подменённым tree-kill («убить только этот PID»): на старом коде зависают все 6 сценариев (3 движка × остановка/обычный выход с фоновым потомком, держащим stdio), таймаут 30 с.
- Настоящий tree-kill на цепочке `cmd.exe` → `node` (скрипт scratchpad race.cjs, 30 прогонов, остановка через 0–300 мс после запуска): сирот 0, `close` приходит всегда — node стартует раньше, чем `taskkill` делает снимок. Риск в продукте остаётся для потомков, которые движок порождает в момент остановки (инструменты, MCP-серверы), и для фоновых процессов с унаследованным stdio. Установлен нативный `claude.exe`; как он порождает потомков (наследование stdio, Job Object), не проверялось — это требует живого запуска с расходом квоты.
- Попутно: в окружении агента выставлен `NoDefaultCurrentDirectoryInExePath=1`, cmd.exe не ищет команду в cwd — тест кладёт фейковые CLI в начало PATH.

## Impact (GitNexus, индекс пересобран)
`killProcessTree` (agentFleetService, модульная функция): CRITICAL, 23 символа, 6 прямых (`killAgentProcess`, три `run*CliAgent`, `stopSwarm`, `killAll`), выше — `performGracefulShutdown`, `stopAgentForBudget`, `discardSwarm`, `pickWinner`, `dispatchRpc`. Поэтому `killProcessTree` не менялся.

## Исправление (decision-37, раздел «Дополнение»)
- `processSweep.ts`: общий хелпер `superviseChildExit` — результат не позже `CHILD_CLOSE_GRACE_MS` (1500 мс) после `exit`, затем destroy потоков; `kill()` — tree-kill живого процесса или добивание потомков вышедшего, ожидание начинается после добивания. `executeSubprocess` переведён на него (`SUBPROCESS_CLOSE_GRACE_MS` = `CHILD_CLOSE_GRACE_MS`), тесты TASK-97 зелёные.
- `agentFleetService`: три CLI-пути завершаются через `superviseAgentChild` вместо `close`; все точки остановки идут через `stopAgentChild` (обработчик под надзором из WeakMap, иначе `killProcessTree`).

## Тесты
- `tests/unit/agentFleetOrphans.test.ts`: 3 движка × (остановка добивает потомка и завершает ожидание; обычный выход с фоновым detached-потомком не висит и потомка не трогает). Старый код — 6/6 зависают, новый — 6/6 проходят.
- `tests/unit/processSweep.test.ts`: 5 тестов `superviseChildExit` на фейковом процессе.

## Найдено попутно: рекурсивный vitest в agentFleetPersistence.test.ts
Сироты тестов (`long-lived.cjs` TASK-97 с 14:11, мои `agent.cjs`) оставлял не код, а тест `agentFleetPersistence.test.ts`: после fan-out срабатывал автосудья и через `processManager.runOnce` выполнял в репозитории настоящий `npm run test` — вложенный vitest, чьи воркеры делали то же самое. Вложенные прогоны обрывались по таймауту, и их тесты оставляли процессы. Найдено наблюдателем процессов и подменой `child_process.spawn` в setup-файле (временно, откатано). Исправлено: `runJudge` подменён в `beforeEach` этого файла. После исправления 3 полных `npm test` подряд: 101/101 файлов, 1103/1103 тестов, 0 сирот и 0 вложенных vitest после каждого прогона. Прежние сироты (61 процесс) убиты.

## Сборка
`pack:win` 2026-09-18: ProjectHub.exe 20:02:09, app.asar 20:02:08, dist-electron/main.js 20:01:31.
<!-- SECTION:NOTES:END -->
