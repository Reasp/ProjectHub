---
id: TASK-92
title: >-
  OpenAI-совместимый потоковый путь: вендорский fallback модели и temperature
  0.7 по умолчанию
status: To Do
assignee: []
created_date: '2026-09-17 09:44'
labels:
  - bug
  - ai
  - model-agnostic
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Смежный дефект, найденный в ходе TASK-88 и не исправленный там (вне scope).

`aiAgentService.requestOpenAICompatible` собирает тело запроса inline:
- `model: req.config.model || 'deepseek/deepseek-chat'` — вендорский дефолт модели, противоречит decision-26 п. 0: при незаданной модели нужна понятная ошибка;
- `temperature: req.config.temperature ?? 0.7` — подставляется всегда, даже если пользователь её не задавал (в TASK-88 для Anthropic это исправлено: параметр уходит только при явном значении, см. decision-33);
- `max_tokens` не передаётся вовсе, поле `AIStreamRequest.maxTokens` (добавлено в TASK-88) этим путём игнорируется.

Кроме того, в `AISettingsModal.handleProviderChange` модель при смене провайдера берётся как первый элемент `MODEL_PRESETS[provider]`, то есть подсказка каталога становится выбранной моделью.

Сборку тела стоит вынести в чистую функцию по образцу `electron/services/anthropicRequest.ts` и покрыть unit-тестами. Возможно, разумнее решать вместе с универсальным провайдером с профилями (TASK-70, decision-26 п. 1) — там появятся флаги совместимости.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Вендорского fallback модели в requestOpenAICompatible нет; при незаданной модели возвращается понятная ошибка
- [ ] #2 temperature отправляется только при явном значении
- [ ] #3 AIStreamRequest.maxTokens учитывается OpenAI-совместимым путём
- [ ] #4 Сборка тела запроса вынесена в чистую функцию и покрыта unit-тестами
<!-- AC:END -->
