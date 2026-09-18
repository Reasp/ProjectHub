---
id: TASK-70.4
title: >-
  Редактор цен, нулевая цена локальных моделей и usage OpenAI-совместимых
  серверов
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
AC#4 и AC#5 TASK-70. UI-редактор `agent-pricing.json` (вход/выход/кэш, порог и множитель длинного контекста), импорт цен из OpenRouter, нулевая цена для профилей с `local` (decision-39). Usage из ответов серверов (включая `prompt_tokens_details.cached_tokens`) → AgentUsage; без usage — оценка с `costSource: 'unknown'`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Расчёт цен и импорт покрыты unit-тестами
- [ ] #2 Таблица цен редактируется в UI
- [ ] #3 Локальные модели считаются по нулевой цене
- [ ] #4 cached_tokens попадают в AgentUsage; без usage — оценка с пометкой unknown
<!-- AC:END -->
