---
id: TASK-70.5
title: >-
  Профиль провайдера в слотах Swarm, ролях и Arena; выбор модели по профилям в
  AI Studio
status: To Do
assignee: []
created_date: '2026-09-18 12:54'
labels:
  - ai
  - model-agnostic
  - swarm
dependencies:
  - TASK-70.1
  - TASK-70.2
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AC#2 (часть про ModelSelectorDropdown), AC#6 и AC#7 TASK-70. Слот `api` и роль ссылаются на `profileId` (decision-39); экспорт сессии содержит профиль, модель и стоимость. `ModelSelectorDropdown` группирует модели по профилям, с поиском и пометкой «локальная». Убрать вендорские fallback-модели codex/gemini-путей agentFleetService (`openai/gpt-4o`, `google/gemini-2.0-flash-001`, decision-26 п. 0). Живая проверка на одной локальной и одной облачной модели; решить судьбу прежних провайдеров openrouter/deepseek/ollama/custom (миграция в профили).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Слот и роль с profileId работают в Swarm и Arena, экспорт содержит профиль
- [ ] #2 ModelSelectorDropdown группирует модели по профилям, с поиском и пометкой «локальная»
- [ ] #3 Вендорские fallback-модели codex/gemini удалены
- [ ] #4 Проверено вживую на локальной и облачной модели
- [ ] #5 Прежние провайдеры мигрированы в профили или решение оформлено ADR
<!-- AC:END -->
