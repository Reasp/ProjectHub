---
id: "task-13"
title: "AI-ассистент генерации описаний задач, коммитов и PR (Local LLM & Assistant Widget)"
status: "Done"
assignee: []
created_date: "2026-08-31"
labels:
  - ai
  - ollama
  - assistant
  - git
  - pr
  - backlog
dependencies: []
priority: "medium"
type: "feature"
---

# task-13: AI-ассистент генерации описаний задач, коммитов и PR (Local LLM & Assistant Widget)

## Description
Разработать модуль AI-помощника для автоматической генерации структурированных описаний задач, критериев приемки (Acceptance Criteria), форматированных сообщений Git-коммитов и описаний Pull Request с поддержкой локальной Ollama и встроенных шаблонов.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Сервис взаимодействия с локальной Ollama (`http://localhost:11434/api/generate`) с автоматическим фоллбэком на локальные эвристики и шаблоны при отсутствии запущенного сервера Ollama.
- [x] #2 Кнопка AI-генерации критериев приемки и описания в окне создания/редактирования задачи `TaskDetailModal.tsx`.
- [x] #3 Кнопка AI-генерации сообщения коммита в Git-инспекторе `GitInspector.tsx` на основе незакоммиченных изменений и активной задачи.
- [x] #4 Кнопка AI-генерации описания Pull Request в модальном окне `CreatePRModal.tsx`.
<!-- AC:END -->
