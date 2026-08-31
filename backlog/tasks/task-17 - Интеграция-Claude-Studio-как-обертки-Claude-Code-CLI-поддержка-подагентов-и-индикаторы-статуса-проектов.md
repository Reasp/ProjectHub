---
id: TASK-17
title: >-
  Интеграция Claude Studio как обертки Claude Code CLI, поддержка подагентов и
  индикаторы статуса проектов
status: Review
assignee: []
created_date: '2026-08-31 23:20'
updated_date: '2026-08-31 23:28'
labels:
  - claude
  - agent
  - cli
  - subagents
  - status
  - studio
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Трансформация Claude Studio в нативную графическую обертку над движком Claude Code CLI (как официальное расширение для VS Code):
1. Движок Claude Studio на базе фонового управляемого процесса Claude CLI (PTY/IPC) с поддержкой автономного цикла, выполнения Bash/инструментов и интерактивных запросов подтверждения от пользователя (Human-in-the-loop).
2. Поддержка дерева подагентов и параллельных сессий диалогов.
3. Глобальные бейджи и индикаторы статуса работы агента на проектах в Sidebar и Header: 'Работает' (пульсирующий спиннер), 'Требует решения пользователя' (колокольчик/alert), 'Завершено' (галочка).
<!-- SECTION:DESCRIPTION:END -->
