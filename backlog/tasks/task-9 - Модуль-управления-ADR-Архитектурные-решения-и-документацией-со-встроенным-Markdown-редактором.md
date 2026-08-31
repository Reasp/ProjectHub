---
id: TASK-9
title: >-
  Модуль управления ADR (Архитектурные решения) и документацией со встроенным
  Markdown-редактором
status: Done
assignee: []
created_date: '2026-08-31 02:28'
updated_date: '2026-08-31 02:33'
labels:
  - docs
  - adr
  - decisions
  - markdown
  - editor
  - rag
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Разработать модуль создания, редактирования и навигации по архитектурным решениям (ADR) и документации проекта (backlog/docs/ и backlog/decisions/) со встроенным Markdown-редактором и автообновлением RAG.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Создание новых архитектурных решений (ADR) по стандартизированному шаблону в backlog/decisions/XXXX-title.md
- [x] #2 Создание и редактирование файлов пользовательской документации в backlog/docs/*.md
- [x] #3 Полноценный Markdown-редактор с режимами Edit / Split / Preview и подсветкой синтаксиса
- [x] #4 Сохранение изменений напрямую в файловую систему проекта через IPC Electron API
- [x] #5 Автоматическое уведомление и предложение переиндексировать Vector RAG после внесения изменений в документацию
<!-- AC:END -->
