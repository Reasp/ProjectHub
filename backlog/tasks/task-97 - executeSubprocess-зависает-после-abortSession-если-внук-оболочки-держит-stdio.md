---
id: TASK-97
title: 'executeSubprocess зависает после abortSession, если внук оболочки держит stdio'
status: Done
assignee: []
created_date: '2026-09-18 05:41'
updated_date: '2026-09-18 11:29'
labels:
  - tests
  - agent
  - flaky
milestone: m-0
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - tests/unit/claudeBridgeService.test.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено 2026-09-18 после живой проверки TASK-94. Тест `tests/unit/claudeBridgeService.test.ts:129` «abortSession убивает команды агента этой сессии» в полном `npm test` падает примерно в половине прогонов (2 из 4) с `Test timed out in 15000ms`. Отдельно файл проходит 6 раз из 6. Вероятно, это тот же случай, из-за которого 2026-09-17 однажды упал `pack:win` на этапе `npm run build` (см. TASK-93).

## Вероятная причина (не доказана)
`executeSubprocess` (`claudeBridgeService.ts`, около строки 1941) запускает команду через `powershell.exe -Command` и завершает промис только по событию `close`. Это событие приходит, когда закрыты **все** stdio-каналы, включая унаследованные внуками. Предполагаемый сценарий под нагрузкой:
1. `abortSession` → `killProcessTree` вызывает `tree-kill` для PID оболочки (на Windows это `taskkill /T /F`).
2. Если PowerShell порождает `node` уже после снимка дерева, внук остаётся жить и держит stdout.
3. `close` не приходит, и промис висит.
4. Таймер таймаута тоже зовёт `killProcessTree(child)`. Там стоит ранний выход при `exitCode !== null`, поэтому для мёртвой оболочки он ничего не делает, и промис может не завершиться никогда.

Последствие в продукте: прерванная команда агента может навсегда повиснуть в ожидании, а осиротевший процесс продолжает жить.

## Что сделать
- Сначала подтвердить гипотезу: прогнать полный `npm test` несколько раз, а в тесте или инструментированной копии залогировать `exit` и `close`, PID внука и то, жив ли он после abort.
- Завершать промис по `exit` оболочки с ограниченным ожиданием `close` (например, 1–2 с), затем принудительно уничтожать stdio-потоки.
- После abort или таймаута добивать остаток дерева: повторный `tree-kill` по сохранённому PID либо Job Object на Windows. Выбор оформить ADR, если он меняет модель процессов.
- Тест сделать детерминированным: не полагаться на `sleep 300`; проверить случай, когда внук стартует после kill.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Причина зависания подтверждена фактами (лог exit/close, PID внука) и записана в Implementation Notes
- [x] #2 После abortSession или таймаута промис executeSubprocess завершается за ограниченное время, даже если потомок держит stdio; осиротевшие процессы не остаются
- [x] #3 Полный npm test проходит 10 прогонов подряд без падений этого теста
- [x] #4 Сценарий «потомок стартует после kill» покрыт unit-тестом
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Причина подтверждена (2026-09-18)
Инструментированный тест (логи exit/close, потомки оболочки через Get-CimInstance до и после abort), 4 полных прогона `npm test`, 2 упали по таймауту 15 с. В упавших:
- abort через 9–13 мс после начала диагностики (около 300 мс после spawn), `exit` оболочки через 0,96–1,07 с, `close` не пришёл;
- внук `node.exe` (PID 43144 при оболочке 40716, PID 24252 при 25076) создан PowerShell после снимка `taskkill /T`, жил всё время теста с ParentProcessId мёртвой оболочки и держал stdout;
- в прошедших прогонах `close` приходил в ту же миллисекунду, что `exit`.
Сироты пережили и vitest: на машине нашлись 26 процессов `node -e "setInterval(() => {}, 1000)"` с 15.09 (все убиты). Гипотеза из описания верна полностью.

## Исправление (decision-37)
- `electron/services/processSweep.ts`: разбор снимка `Win32_Process` и обход потомков мёртвой оболочки по цепочке ParentProcessId с отсечкой по времени создания (защита от переиспользования PID) — чистые функции; `sweepOrphanedDescendants` только для Windows.
- `executeSubprocess`: промис завершается по `exit` + до `SUBPROCESS_CLOSE_GRACE_MS` (1500 мс) ожидания `close`, затем потоки уничтожаются. После abort/таймаута сначала добиваются потомки. Добивание подключено через собственный kill-обработчик команды (`subprocessKillers`), `killProcessTree` не менялся (GitNexus impact: HIGH, 13 зависимых).
- Impact до правки: `executeSubprocess` LOW (1 вызывающий, runCommandTool), `abortSession` LOW, `killProcessTree` HIGH. Для impact ProjectHub впервые проиндексирован (`gitnexus analyze`); побочные правки анализатора в CLAUDE.md/AGENTS.md и `.claude/skills/gitnexus/` откатаны, `.gitnexus/**` добавлен в игноры ESLint (там 15 no-undef в сгенерированном run.cjs).

## Тесты
- `tests/unit/executeSubprocessOrphans.test.ts`: tree-kill подменён на «убить только этот PID» — детерминированный аналог внука вне снимка. 3 сценария: abort, таймаут, обычный выход с фоновым потомком (detached, иначе libuv кладёт его в свой Job Object). На старом коде все три зависают (проверено, таймаут 30 с), на новом проходят.
- `tests/unit/processSweep.test.ts`: разбор снимка, обход, переиспользованный PID, циклы.
- Исходный тест оставлен с abort через 300 мс: он намеренно бьёт в гонку на реальном tree-kill.

## AC#3
10 полных `npm test` подряд: 10/10, 1062/1062 в каждом; после прогонов 0 сирот. Логи: scratchpad сессии e981af00…/t97-ac3/.

## Ограничение
Цепочка через уже умерший промежуточный процесс по ppid не находится — промис всё равно завершается, процесс может остаться (Job Object отложен, см. decision-37). Тот же дефект в agentFleetService вынесен в TASK-99.
<!-- SECTION:NOTES:END -->
