---
id: TASK-110
title: >-
  env-tools: isAlive не отличает переиспользованный PID — старые записи реестра
  видны как работающие
status: Review
assignee: []
created_date: '2026-09-28 00:20'
updated_date: '2026-09-28 00:53'
labels:
  - infra
  - env-tools
dependencies: []
modified_files:
  - scripts/env/state.mjs
  - scripts/env/process-manager.mjs
  - scripts/env/env-server.mjs
  - tests/unit/envProcessManager.test.ts
  - >-
    backlog/decisions/decision-59 -
    env-tools-идентичность-процесса-в-реестре-по-времени-старта-и-чистка-мёртвых-записей.md
priority: low
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено в TASK-109 (decision-58, раздел Consequences). `scripts/env/state.mjs` → `isAlive(pid)` проверяет только `process.kill(pid, 0)`. Записи `.env-state/processes.json` из прошлых сессий, чей PID ОС уже отдала другому процессу, `list_processes` показывает как «работает» (2026-09-28: t70-pack, pack-win-72c, shot-81b). Отсюда же: `start_process` с таким именем откажет как дубликату, а `stop_process` вызовет `taskkill /T /F` по чужому PID — **опасно**.

Варианты: хранить в реестре время старта процесса и сверять его (на Windows — `Get-CimInstance Win32_Process` CreationDate или `wmic`, на POSIX — `ps -o lstart`); либо сверять имя образа (powershell.exe для обёртки). Реестр в хабе накопил ~90 мёртвых записей — нужна и чистка (например, `list_processes` удаляет записи, мёртвые больше N дней).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 isAlive/stop_process не принимают переиспользованный PID за процесс из реестра (сверка времени старта или образа)
- [x] #2 stop_process никогда не убивает чужой процесс с переиспользованным PID — покрыто тестом
- [x] #3 Есть способ очистить мёртвые записи реестра
- [x] #4 Старые записи без идентичности: pid, занятый процессом новее записи, — dead; иначе unknown (stop_process только удаляет запись, start_process не считает дубликатом)
- [x] #5 Фикс перенесён в F:\ProjectTemplate (scripts/env/*, тест node:test), npm test там зелёный
- [x] #6 Тот же паттерн в electron/services/processManager.ts и projectScanner.ts найден и записан в отдельную задачу
- [x] #7 ADR decision-59 (формат идентичности, политика старых записей, чистка)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Диагностика 2026-09-28: 86 записей в .env-state/processes.json хаба, kill(pid,0) считает живыми 3. pack-win-72c (pid 28024) теперь conhost.exe, shot-81b (pid 38880) — backlog.exe (MCP-сервер текущей сессии), t70-pack (28540) уже освобождён. Пакетный запрос: CIM Win32_Process ~480 мс, Get-Process -Id a,b,c ~240 мс, пустой powershell ~100 мс. Get-Process.StartTime и CIM CreationDate совпадают до миллисекунды у всех 650 процессов (у двух системных StartTime недоступен).

Решение (decision-59): поле pidCreatedAt — время создания процесса по ОС, мс Unix. Windows: обёртка пишет в pid-файл `pid,ms` из Process.StartTime (атомарно через .tmp + Move-Item). POSIX: ps -o pid=,lstart= сразу после spawn. Проверка — один Get-Process -Id a,b,c / ps -p a,b,c на вызов инструмента и только по pid, которые kill(0) считает живыми; допуск 1 с. Статусы running/dead/unknown; stop_process убивает только running, при неудачном запросе к ОС — ошибка без удаления записи. Чистка: list_processes удаляет dead-записи без активности (max(startedAt, mtime лога)) > 7 дней вместе с логом и файлами обёртки. start/stop/prune перечитывают реестр перед записью (updateRegistry).

Проверки: tests/unit/envProcessManager.test.ts — 3 теста (в т.ч. «PID переиспользован»: живой посторонний node-процесс под записями с чужой/отсутствующей идентичностью переживает stop_process). Мутация: старое поведение stopProcess → тест падает. Живая проверка C:\Temp\ph-110\live-env-server.cjs (stdio-клиент MCP SDK, копия скриптов и реестра хаба): pack-win-72c (pid 28024, conhost) и shot-81b (pid 38880, backlog.exe) → dead, stop_process их не тронул; первый list_processes удалил 49 записей за 20 мс; новый start/дубль/stop корректны; реестр хаба не изменён. Реестр хаба почистится сам при первом list_processes в новой сессии (MCP env-tools текущей сессии — на старом коде). POSIX-ветка вживую не проверялась (в WSL нет node); разбор вывода ps -o pid=,lstart= покрыт тестом на реальном формате из WSL.

Пункт 5: тот же паттерн в приложении — electron/services/processManager.ts (stopEnvToolsProcess: treeKill по pid из реестра после kill(0); listProcessesForProject) и projectScanner.ts (runningCount). Заведена TASK-111.

ProjectTemplate: scripts/env/state.mjs, process-manager.mjs, env-server.mjs синхронизированы (ссылки как «ProjectHub decision-59»), process-manager.test.mjs — те же сценарии на node:test; npm test 29/29. Не закоммичено.

Итоговые проверки 2026-09-28: npm run lint — 0 ошибок, 494 предупреждения (baseline; ошибка preserve-caught-error в state.mjs исправлена через { cause }); index-docs + lint:docs — ок; pack:win — 176 файлов / 1982 теста, check-bundle ок, release/win-unpacked/ProjectHub.exe собран. ProjectTemplate: npm test 29/29. Стенд C:\Temp\ph-110 (node_modules — junction на хаб, удалять через rmdir на junction). Не закоммичено ни в хабе, ни в шаблоне.
<!-- SECTION:NOTES:END -->
