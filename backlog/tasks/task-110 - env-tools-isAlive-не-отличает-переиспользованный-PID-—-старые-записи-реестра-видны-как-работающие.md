---
id: TASK-110
title: >-
  env-tools: isAlive не отличает переиспользованный PID — старые записи реестра
  видны как работающие
status: To Do
assignee: []
created_date: '2026-09-28 00:20'
labels:
  - infra
  - env-tools
dependencies: []
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
- [ ] #1 isAlive/stop_process не принимают переиспользованный PID за процесс из реестра (сверка времени старта или образа)
- [ ] #2 stop_process никогда не убивает чужой процесс с переиспользованным PID — покрыто тестом
- [ ] #3 Есть способ очистить мёртвые записи реестра
<!-- AC:END -->
