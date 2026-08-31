---
id: TASK-15
title: >-
  Графическая панель AI-ассистента (Claude AI Studio & Multi-Provider Agent) с
  визуальными Diff и согласованием действий
status: To Do
assignee: []
created_date: '2026-08-31 13:59'
labels:
  - ai
  - claude
  - gui
  - agent
  - openrouter
  - ollama
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Реализация полноценного графического UI-ассистента (в стиле Cline / Roo Code / Cursor) прямо в интерфейсе ProjectHub с поддержкой прямого Anthropic API, а также альтернативных провайдеров (OpenRouter, DeepSeek, Ollama), интерактивными визуальными карточками согласования правок (Diffs) и интеграцией с задачами Backlog.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Графическая боковая панель / вкладка чата с AI-ассистентом прямо в интерфейсе ProjectHub
- [ ] #2 Поддержка прямого Anthropic API (Claude 3.7 Sonnet / 3.5 Sonnet / 3.5 Haiku) с сохранением API-ключа в защищенном локальном хранилище
- [ ] #3 Поддержка альтернативных провайдеров для РФ и гибкого доступа (OpenRouter, DeepSeek, локальная Ollama / OpenAI-compatible API)
- [ ] #4 Интерактивные карточки действий агента (Tool Use): чтение файлов, выполнение команд, визуальные Diff-блоки изменений с кнопками 'Принять' / 'Отклонить'
- [ ] #5 Интеграция с контекстом проекта: быстрое прикрепление задач Backlog.md, документации, ADR и файлов репозитория
- [ ] #6 Потоковый вывод ответов (Streaming) с поддержкой Markdown, подсветки синтаксиса и блоков рассуждений (Thinking blocks)
<!-- AC:END -->
