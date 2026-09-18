---
id: TASK-70.3
title: 'Усилие рассуждений: универсальный параметр и трансляция в формат провайдера'
status: To Do
assignee: []
created_date: '2026-09-18 12:54'
labels:
  - ai
  - model-agnostic
dependencies:
  - TASK-70.1
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AC#3 TASK-70. Параметр `none|low|medium|high|max` слота/сессии; адаптер по флагу профиля `compat.reasoning` (decision-39) транслирует его в `reasoning_effort`, `reasoning: {effort}`, `think` (Ollama), а для Anthropic — в thinking (decision-33) или молча игнорирует. Дельты `reasoning_content`/`reasoning` — в поток thought.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Трансляция усилия для всех стилей compat.reasoning и Anthropic покрыта unit-тестами
- [ ] #2 Параметр задаётся в UI сессии и слота
- [ ] #3 Дельты рассуждений показываются как thought
<!-- AC:END -->
