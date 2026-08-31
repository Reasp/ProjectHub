---
id: task-5
title: Менеджер фоновых процессов и живой терминал логов (Process Manager & Terminal)
status: Done
assignee: []
created_date: ''
updated_date: '2026-08-31 02:21'
labels:
  - process
  - terminal
  - logs
  - env-tools
  - xterm
dependencies: []
---

# task-5: Менеджер фоновых процессов и живой терминал логов (Process Manager & Terminal)

## Description
Интегрировать управление фоновыми процессами и вывод логов dev-серверов в интерфейс ProjectHub.

## Acceptance Criteria
- [x] Интеграция с локальным `env-server` / `process-manager.mjs` проекта.
- [x] Кнопки быстрого запуска / остановки dev-сервера и фоновых скриптов в шапке проекта.
- [x] Встроенная нижняя панель терминала на базе `@xterm/xterm` с поддержкой цветного ANSI-вывода.
- [x] Потоковая передача stdout/stderr из запущенных дочерних процессов в реальном времени через IPC.
- [x] Корректное завершение дерева процессов при остановке (через `tree-kill` для предотвращения зависших портов на Windows).
- [x] Сохранение состояния процессов между перезапусками приложения Hub.
