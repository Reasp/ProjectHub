---
id: decision-58
title: "env-tools на Windows: PowerShell-обёртка через cmd start /b, а не прямой detached-spawn"
date: "2026-09-28 08:20"
status: accepted
section: "Процессы и env-tools"
---
## Context

`scripts/env/process-manager.mjs` (движок MCP-сервера env-tools) на Windows запускает команду через сгенерированную PowerShell-обёртку `.env-state/wrappers/<name>.ps1`. Обёртка пишет свой `$PID` в pid-файл и перенаправляет вывод в лог средствами PowerShell. Связка `shell: true` + `detached: true` у Node теряет редирект, поэтому обходится без неё. Саму обёртку ProjectHub с 2026-08-28 запускает так: `spawn('cmd.exe', ['/c', 'start', '/b', '""', 'powershell.exe', ..., '-WindowStyle', 'Hidden', '-File', wrapper], { stdio: 'ignore', windowsHide: true })`.

В ProjectTemplate и ProxiHorror запуск заменён на прямой `spawn('powershell.exe', [...], { detached: true, stdio: 'ignore' })`, без `windowsHide`. Обоснование, записанное в шаблоне: «`cmd /c start /b` нестабилен при закрытии терминала/потере stdin (TASK-1)». Сверка в TASK-107 выявила расхождение, разбор вели в TASK-109 (Windows 10 19045, Windows PowerShell 5.1.19041, Node 22.16):

1. **Вариант шаблона не запускается.** `powershell.exe` с `detached: true` (в libuv это `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, процесс без консоли) завершается с кодом 0 за 100–250 мс и не выполняет ни `-File`, ни `-Command`. Вывода нет ни в stdout, ни в stderr, даже если они перенаправлены в пайпы. С `windowsHide` и без него результат один. Без `detached` тот же скрипт выполняется. Итог для env-tools: pid-файл не появляется, `start_process` падает через 5 с с ошибкой «PowerShell-обёртка не стартовала».
2. **В ProxiHorror он не работал ни разу.** Замена сделана в коммите c2f6504 от 2026-08-26 («dynamic port selection for backlog-web»). После неё ни у одной обёртки в `.env-state/wrappers/` нет pid-файла (test-proc, test, backlog-web), а их логи пустые. pid-файлы есть только у запусков 2026-08-24, сделанных ещё через `cmd /c start /b`. TASK-1 ProxiHorror — установка Godot, про env-tools в ней ничего нет. Объяснение про «нестабильность» записано задним числом и фактами не подтверждено.
3. **Вариант ProjectHub проверен вживую** на изолированном стенде с копией скриптов и зондом, который сообщает о консольном окне, его видимости и членстве в job:
   - старт за ~0,4 с, лог пишется, `stop_process` (`taskkill /T /F`) убивает обёртку и всех её потомков;
   - после обычного выхода родителя процесс продолжает работать;
   - `taskkill /PID <родитель> /T /F` обёртку не задевает: её родитель — уже завершившийся `cmd.exe`, поэтому она вне дерева родителя. При прямом spawn родителем обёртки был бы сам env-server, и tree-kill хоста убил бы dev-сервер;
   - после закрытия консольного окна родителя (`WM_CLOSE`, то есть `CTRL_CLOSE_EVENT`) процесс продолжает работать. Причина: `windowsHide` при `stdio: 'ignore'` даёт `cmd.exe` флаг `CREATE_NO_WINDOW`, то есть собственную консоль без окна, и через `start /b` её наследуют PowerShell и потомки. У зонда `GetConsoleWindow() = 0`, окна не всплывают;
   - процессы не входят в job-объекты: libuv создаёт свой job с `SILENT_BREAKAWAY_OK`, и внуки из него выходят;
   - настоящий `env-server.mjs`, запущенный через stdio-клиент MCP SDK, как это делает Claude Code: процесс переживает и `TerminateProcess` сервера, и `taskkill /T /F` по нему. Новый экземпляр сервера видит процесс в `list_processes`, отдаёт `tail_log` и останавливает дерево.

Рассмотренные альтернативы:
- перенести вариант шаблона — отвергнуто по пп. 1–2;
- прямой spawn без `detached`, но с `windowsHide`: PowerShell стартует, но попадает в job-объект libuv с `KILL_ON_JOB_CLOSE` и погибает вместе с env-server. Нарушено главное требование — переживать перезапуск MCP-сервера;
- `pwsh` (PowerShell 7): не входит в поставку Windows, зависимость ради одного запуска не нужна.

## Decision

1. В ProjectHub остаётся запуск обёртки через `cmd /c start /b` с `windowsHide: true` и `-WindowStyle Hidden`. Прямой `spawn('powershell.exe', ..., { detached: true })` не используется; причина записана комментарием в `startWindows`.
2. Регрессионный тест `tests/unit/envProcessManager.test.ts` запускает настоящий процесс через копию скриптов во временном `INFRA_ROOT`. Он проверяет лог, реестр, отказ при дубликате, остановку всего дерева, а на Windows ещё и то, что родитель обёртки не вызывающий процесс. С вариантом шаблона тест падает на старте.
3. В ProjectTemplate возвращается вариант ProjectHub, заметка `feedback_windows_detached_process.md` исправляется. ProxiHorror не правится без отдельного запроса владельца, но о поломке его env-tools сообщено.

## Consequences

- env-tools в ProjectHub не меняется; новый тест защищает от повторного «переноса» detached-варианта.
- В шаблоне и в проектах, развёрнутых из него после 2026-09-18, `start_process` на Windows не работал. Исправление шаблона появится в них только после повторной синхронизации `scripts/env/process-manager.mjs`.
- Остаётся зависимость от `cmd.exe` и 5-секундного ожидания pid-файла. Под сильной нагрузкой старт PowerShell может его превысить (как в decision-57); ошибка тогда явная, и её можно повторить.
- Отдельный долг, не в этом решении: `isAlive` через `process.kill(pid, 0)` не отличает переиспользованный PID, поэтому старые записи реестра `.env-state/processes.json` иногда показываются как «работает». А `stop_process` по такой записи убил бы чужой процесс — TASK-110.
- Реализация — TASK-109. Связано: [[decision-57]].
