---
id: TASK-19
title: Встроенный HTTP/SSE MCP-сервер для внешнего управления приложением и GUI
status: Done
assignee: []
created_date: '2026-09-02 05:37'
updated_date: '2026-09-02 05:41'
labels:
  - mcp
  - remote-control
  - api
  - electron
  - claude-studio
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Реализация встроенного в Electron приложение MCP-сервера по протоколу HTTP/SSE для удаленного управления интерфейсом, проектами, процессами и сессиями Claude Studio из внешних агентов (Claude Code, Cursor, Windsurf, Antigravity, внешние скрипты).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Встроенный в Electron легковесный HTTP/SSE MCP-сервер на 127.0.0.1:42042 с поддержкой @modelcontextprotocol/sdk
- [x] #2 Набор MCP-инструментов удаленного управления GUI: переключение проектов, вкладок (studio, kanban, git, docs, terminal), отправка промптов в Claude Studio, согласование действий Human-in-the-Loop
- [x] #3 Инструменты управления фоновыми процессами и получение логов в реальном времени
- [x] #4 Безопасность: ограничение 127.0.0.1, генерация сессионного токена авторизации
- [x] #5 Виджет в настройках/шапке с кнопкой включения/выключения и копированием конфигурации для Claude Desktop / Cursor / Claude Code
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализован встроенный легковесный HTTP/SSE MCP-сервер на 127.0.0.1:42042 на базе @modelcontextprotocol/sdk. Поддерживаются инструменты удаленного управления GUI (переключение проектов, вкладок, отправка промптов, согласование карточек Human-in-the-Loop), запуск/остановка процессов и чтение бэклога. Добавлен виджет в шапку с копированием конфигурации в один клик и Toast-уведомления при внешнем управлении. Приложение успешно собрано.
<!-- SECTION:FINAL_SUMMARY:END -->
