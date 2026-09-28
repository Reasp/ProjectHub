---
id: TASK-109
title: >-
  Перенос process-manager.mjs env-tools из ProjectTemplate: прямой
  detached-запуск PowerShell
status: Review
assignee: []
created_date: '2026-09-27 23:49'
updated_date: '2026-09-28 00:25'
labels:
  - infra
  - template-sync
dependencies: []
references:
  - >-
    backlog/decisions/decision-58 -
    env-tools-на-Windows-PowerShell-обёртка-через-cmd-start-b-а-не-прямой-detached-spawn.md
  - tests/unit/envProcessManager.test.ts
  - scripts/env/process-manager.mjs
priority: low
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обнаружено при сверке в TASK-107: `scripts/env/process-manager.mjs` в F:\ProjectTemplate новее, чем в ProjectHub. Шаблон запускает PowerShell-обёртку напрямую (`spawn('powershell.exe', [...], { detached: true })`), а хаб — через `cmd /c start /b`, который, по заметке шаблона (его TASK-1), работал нестабильно при закрытии терминала и потере stdin. Нужно сравнить поведение, перенести вариант шаблона в хаб (или обосновать отказ) и проверить env-tools вживую: start_process/tail_log/stop_process, переживание закрытия родителя.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Различия process-manager.mjs хаба и шаблона разобраны, решение записано в задаче
- [x] #2 env-tools в хабе проверен вживую: запуск, лог, остановка, переживание завершения родителя
- [x] #3 npm test и npm run lint зелёные
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Решение: вариант шаблона НЕ переносим (decision-58)

**Разбор различий.** Отличается только запуск обёртки: хаб — `cmd /c start /b powershell -WindowStyle Hidden -File` с `windowsHide:true`; шаблон — `spawn('powershell.exe', ..., {detached:true, stdio:'ignore'})` без `windowsHide`. `state.mjs` и `env-server.mjs` совпадают.

**Вариант шаблона не работает.** powershell.exe 5.1 с `detached:true` (DETACHED_PROCESS, без консоли) выходит с кодом 0 за 100–250 мс, не выполнив скрипт; вывода нет даже в пайпах. start_process → «PowerShell-обёртка не стартовала за 5с». В ProxiHorror после замены (c2f6504, 2026-08-26, коммит про порт backlog-web) ни одна обёртка не записала pid-файл, логи пустые. TASK-1 ProxiHorror — установка Godot. Ссылка на «нестабильность» не подтверждена фактами.

**Вариант хаба проверен вживую** (стенд C:\Temp\ph-109, зонд сообщает GetConsoleWindow, IsWindowVisible и IsProcessInJob):
- старт ~0,4 с, лог пишется, stopProcess убивает обёртку и потомков;
- выход родителя — процесс живёт;
- `taskkill /T /F` по родителю — живёт (ppid обёртки — уже мёртвый cmd.exe);
- WM_CLOSE консоли родителя — живёт; консоль у зонда без окна (GetConsoleWindow=0), в job не входит;
- настоящий env-server.mjs через stdio-клиент MCP SDK: процесс пережил и TerminateProcess сервера, и tree-kill; новый сервер отдал list_processes, tail_log и stop_process, дерево мертво;
- env-tools этой сессии: start_process, tail_log и stop_process на зонде — ок.
- Альтернатива «без detached + windowsHide» проверена отдельно: PowerShell умирает вместе с родителем (job libuv с KILL_ON_JOB_CLOSE).

**Правки.** Хаб: комментарий в `startWindows`; регрессионный тест `tests/unit/envProcessManager.test.ts` — с вариантом шаблона падает на старте, проверено подстановкой; ADR decision-58. Шаблон F:\ProjectTemplate (не закоммичено): возвращён вариант хаба, добавлен `scripts/env/process-manager.test.mjs` (node --test 27/27), исправлена `.claude/memory/feedback_windows_detached_process.md`. ProxiHorror не трогал — env-tools там сломан, сообщено пользователю.

GitNexus переиндексирован (10 768 узлов), побочные правки откачены. ESLint: 0 ошибок / 494 предупреждения (baseline). index-docs и lint:docs — ок.

**Гейты (2026-09-28):** pack:win прошёл целиком: validate-docs, check-index, lint (0 ошибок / 494 предупреждения), vitest 176 файлов / 1980 тестов, tsc, vite build, check-bundle, exe 08:23. После правки ADR выполнены index-docs и lint:docs — индекс актуален. env-server перезапускать не нужно: логика process-manager.mjs не менялась, только комментарий. Долг с переиспользованными PID вынесен в TASK-110. Стенд живых проверок — C:\Temp\ph-109.
<!-- SECTION:NOTES:END -->
