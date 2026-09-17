---
id: TASK-91
title: Живая проверка thinking в API-пути Anthropic на актуальной модели
status: To Do
assignee: []
created_date: '2026-09-17 09:44'
labels:
  - ai
  - model-agnostic
  - verification
dependencies:
  - TASK-88
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вынесено из TASK-88 (AC#2 «проверено хотя бы на одной актуальной модели»). На машине разработки нет API-ключа Anthropic (`~/.projecthub/ai-config.json`: `apiKeySet: false`), поэтому в TASK-88 AC#2 закрыт unit-тестами сборки тела запроса (`tests/unit/anthropicRequest.test.ts`) и разбора ответа Models API, а живой прогон не выполнялся. Через Claude CLI проверять нельзя — API-путь намеренно идёт мимо CLI.

## Что проверить при наличии ключа

1. AI Studio, провайдер `anthropic`, модель `claude-opus-5` (или `claude-sonnet-5`), Thinking Budget > 0: запрос `GET /v1/models/{id}` проходит, в теле `POST /v1/messages` уходит `thinking: {type: "adaptive", display: "summarized"}`, в интерфейсе появляется блок рассуждений, ответа 400 нет.
2. Та же модель с сохранённой `temperature` (например, 0.7): запрос проходит без 400, в `main.log` на уровне info есть пояснение, что temperature не отправлена.
3. `claude-haiku-4-5`, Thinking Budget 2048: уходит `thinking: {type: "enabled", budget_tokens: 2048}`, рассуждения приходят.
4. Модель `default` в API-пути: понятная ошибка «Модель не выбрана», а не 404 от API.
5. Длинный ответ агента не обрывается на 4096 токенах (`stop_reason` не `max_tokens`).

Связано: decision-33.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Для adaptive-модели (claude-opus-5 или claude-sonnet-5) с Thinking Budget > 0 рассуждения приходят и отображаются, ответа 400 нет
- [ ] #2 С сохранённой temperature запрос к модели без sampling-параметров проходит без 400
- [ ] #3 Для claude-haiku-4-5 thinking уходит как enabled с budget_tokens и работает
- [ ] #4 Модель default в API-пути даёт понятную ошибку, а не ошибку API
- [ ] #5 Длинный ответ агента не обрезается на 4096 токенах
<!-- AC:END -->
