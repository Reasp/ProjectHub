---
id: TASK-92
title: >-
  OpenAI-совместимый потоковый путь: вендорский fallback модели и temperature
  0.7 по умолчанию
status: Done
assignee: []
created_date: '2026-09-17 09:44'
updated_date: '2026-09-18 13:05'
labels:
  - bug
  - ai
  - model-agnostic
dependencies: []
references:
  - electron/services/openAICompatibleRequest.ts
  - electron/services/aiAgentService.ts
  - src/components/ai/AISettingsModal.tsx
  - tests/unit/openAICompatibleRequest.test.ts
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
- [x] #1 Вендорского fallback модели в requestOpenAICompatible нет; при незаданной модели возвращается понятная ошибка
- [x] #2 temperature отправляется только при явном значении
- [x] #3 AIStreamRequest.maxTokens учитывается OpenAI-совместимым путём
- [x] #4 Сборка тела запроса вынесена в чистую функцию и покрыта unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Исправление (decision-38, 2026-09-18)
- `electron/services/openAICompatibleRequest.ts` — чистый модуль по образцу `anthropicRequest.ts`: `resolveOpenAICompatibleModelId` (пустая модель или `default` → ошибка «Модель не выбрана: укажите идентификатор модели провайдера …»; `isUnsetModelId` переиспользован из `anthropicRequest`) и `buildOpenAICompatibleChatBody`.
- `temperature` уходит только при явном конечном значении (включая 0), `max_tokens` — только при явном положительном `AIStreamRequest.maxTokens`. Без значения действует предел провайдера: потолки моделей OpenAI-совместимых провайдеров до каталога TASK-70 неизвестны, завышенный дефолт дал бы 400. Поле `max_tokens` (не `max_completion_tokens`) — вариант для конкретных провайдеров оставлен флагу совместимости TASK-70.
- Поля учёта usage без изменений (`stream_options` кроме Ollama, `usage.include` для OpenRouter).
- `aiAgentService.requestOpenAICompatible` использует функцию; вендорский fallback `deepseek/deepseek-chat` и `temperature ?? 0.7` удалены.

## AISettingsModal.handleProviderChange — исправлено здесь же
При смене провайдера модель сбрасывается в пустую (при повторном клике по тому же провайдеру — сохраняется); `MODEL_PRESETS` остаются подсказками datalist. Отдельная задача не нужна: правка в две строки, а пустая модель уже даёт понятную ошибку в API-путях (п. выше, `resolveAnthropicModelId`), в Claude CLI-пути означает «без `--model`» (`claudeBridgeService` и `roleEngineAdapter` не передают флаг для пустой модели). Убран и фиктивный fallback `'custom'` как имя модели.

## TASK-70 не мешает
П. 2 TASK-70 («без выбора — первая доступная локальная, затем облачная») — разрешение модели по профилям до сборки тела; функция получит уже выбранный id. Флаги совместимости профиля (`reasoning_effort`, usage в стриме, `max_completion_tokens`) расширят вход функции вместо проверок по имени провайдера. Зафиксировано в decision-38.

## Проверки
`tests/unit/openAICompatibleRequest.test.ts` — 8 тестов. Полный `npm test` 2 раза: 102/102 файлов, 1111/1111. ESLint 0 ошибок, 501 предупреждение (baseline 502). lint:docs и check-index — ок после index-docs.

## Сборка
`pack:win` 2026-09-18 (build: lint 0 ошибок, 102/102 файлов, 1111/1111 тестов, check-bundle ✅): ProjectHub.exe 20:09:44, app.asar 20:09:43, dist-electron/main.js 20:09:10. В main.js нет строки `deepseek/deepseek-chat`, есть новое сообщение «укажите идентификатор модели провайдера».
<!-- SECTION:NOTES:END -->
