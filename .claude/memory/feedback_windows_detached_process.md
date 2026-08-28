---
name: feedback-windows-detached-process
description: На Windows Node's shell:true + detached:true ломает stdout/stderr редирект в файл
metadata:
  type: feedback
---

В Node.js на Windows связка `spawn(command, {shell: true, detached: true, stdio: ['ignore', fd, fd]})`
не пишет вывод дочернего процесса в файл — процесс запускается и остаётся "живым"
(`process.kill(pid, 0)` подтверждает существование), но лог остаётся пустым. Проверено
изолированно: `shell:true` без `detached` — работает; `detached:true` без `shell` (прямой
spawn исполняемого файла, без shell-обёртки) — тоже работает; именно комбинация обоих
флагов ломает редирект. Не важно, передаётся ли редирект через `stdio: [_, fd, fd]` или
через `> file 2>&1` в самой команде — результат один.

**Why:** нужно было для `env-tools` MCP-сервера (`scripts/env/env-server.mjs` в
`F:\ProjectTemplate`) — процесс должен переживать перезапуск/выход самого MCP-сервера
(значит, нужен `detached`), но и логи должны реально писаться в файл.

**How to apply:** на Windows для detached-процесса с надёжным логом в файл — не полагаться
на `shell:true + detached:true`. Рабочая схема: сгенерировать `.ps1`-обёртку, которая (1)
пишет `$PID | Out-File -FilePath <pidfile> -Encoding ascii -NoNewline` первой строкой
(единственный надёжный способ узнать PID изнутри — PowerShell даёт `$PID` из коробки,
батник — нет), затем (2) выполняет саму команду с редиректом через сам PowerShell:
`<command> 2>&1 | Out-File -FilePath <logfile> -Append -Encoding utf8` (именно так, не через
`*>>`, у которого на Windows PowerShell 5.1 кодировка по умолчанию UTF-16LE, а не UTF-8).
Запускать обёртку через `spawn('cmd.exe', ['/c','start','/b','""','powershell.exe',
'-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File', wrapperPath],
{stdio:'ignore'})` — `start /b` даёт настоящую ОС-независимость от родителя без нужды в
Node-флаге `detached` на этом шаге (сам launcher-процесс cmd.exe завершается почти сразу).
После спавна нужно подождать появления pid-файла (poll с `Atomics.wait`, не спавнить
процессы ради sleep). Останавливать — `taskkill /PID <pid> /T /F` (флаг `/T` убивает всё
дерево процессов, это компенсирует то, что реальный PID — это PowerShell, а не конечная
команда). Полностью проверено: лог пишется, процесс переживает выход родителя, taskkill
корректно убивает всё дерево. См. код в `F:\ProjectTemplate\scripts\env\process-manager.mjs`.
На POSIX (mac/linux) стандартная идиома `shell:true + detached:true + fd` не тестировалась
на реальной машине в этой сессии (сессия только на Windows), но это документированный
рабочий паттерн Node.js — проблема специфична для Windows.
