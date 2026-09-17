---
id: TASK-88
title: >-
  API-режим aiAgentService: жёсткий max_tokens, мёртвый thinkingBudget и
  устаревший дефолт модели
status: Done
assignee: []
created_date: '2026-09-16 09:37'
updated_date: '2026-09-17 09:51'
labels:
  - bug
  - ai
  - model-agnostic
dependencies: []
modified_files:
  - electron/services/anthropicRequest.ts
  - electron/services/aiAgentService.ts
  - electron/services/agentFleetService.ts
  - src/types/electron.d.ts
  - src/store/useAIStudioStore.ts
  - src/components/ai/AISettingsModal.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/anthropicRequest.test.ts
  - >-
    backlog/decisions/decision-33 -
    Anthropic-API-путь-возможности-модели-из-Models-API-потолок-max_tokens-и-условная-отправка-temperature.md
  - .rag-index/
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Дефекты потокового API-пути `aiAgentService.requestAnthropic` — подтверждены чтением кода в ходе TASK-83. Затрагивают всех пользователей API-провайдеров (не Claude CLI).

## Найденное

1. Жёсткий потолок ответа. В теле запроса `max_tokens: 4096` захардкожен, поля для переопределения нет ни в `AIProviderConfig`, ни в `AIStreamRequest`. Длинные ответы агента обрезаются молча.

2. Extended thinking не включается ни на одной актуальной модели. Условие — `req.config.thinkingBudget > 0 && req.config.model.includes('3-7')`, то есть истинно только для `claude-3-7-*`. Для `sonnet`, `opus`, `claude-sonnet-5`, `claude-opus-5` и любых новых моделей `thinking` мёртв, хотя дефолт конфига ставит `thinkingBudget: 2048`, а UI показывает слайдер по той же подстроке.

3. `thinking` и `temperature` связаны взаимоисключающим `if/else`. Из-за этого `temperature` подставляется со значением по умолчанию 0.7 даже там, где вызывающему коду нужен детерминизм, а получить thinking вместе с заданной температурой невозможно в принципе.

4. Устаревший дефолт модели в двух местах: `claude-3-7-sonnet-20250219` как fallback в `getConfig()` и как fallback в теле запроса. Модель снята с обслуживания. Родственные места с теми же устаревшими значениями — `agentFleetService` (API-агент роя) и `NewSwarmModal`. Это прямо противоречит decision-26 п. 0: вендорских дефолтов быть не должно, при незаданной модели нужна понятная ошибка.

## Чего это НЕ касается

`aiAgentService.complete()` (добавлен в TASK-83) этих проблем не имеет: он писался с нуля, без вендорских дефолтов, со своим `max_tokens` и таймаутом. Чинить надо старый потоковый путь.

## Вне scope

Универсальный провайдер с профилями, каталог моделей и тиры — TASK-70 и TASK-79 (decision-26 п. 1, п. 5). Сюда же относится известное расхождение: `baseUrl` игнорируется для `deepseek` и `openrouter` — текущее поведение зафиксировано тестами `llmEndpoint`, менять его следует вместе с профилями, а не здесь.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 max_tokens задаётся вызывающим кодом; значение по умолчанию не обрезает длинные ответы агента
- [ ] #2 Extended thinking включается по явному признаку возможностей модели, а не по подстроке 3-7 в имени; проверено хотя бы на одной актуальной модели
- [ ] #3 thinking и temperature развязаны: можно задать температуру независимо от режима рассуждений
- [ ] #4 Вендорских дефолтов модели не осталось ни в getConfig(), ни в теле запроса; при незаданной модели возвращается понятная ошибка (decision-26 п. 0)
- [ ] #5 Устаревшие claude-3-7-* убраны из agentFleetService и NewSwarmModal
- [ ] #6 Сборка тела запроса вынесена в чистую функцию и покрыта unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

- Новый чистый модуль `electron/services/anthropicRequest.ts`: `buildAnthropicMessagesBody(input, capabilities)` (тело + `notes` о том, что не отправлено и почему), `parseAnthropicModelCapabilities` (ответ `GET /v1/models/{id}`), `resolveAnthropicModelId`/`isUnsetModelId` (пустая модель и `default` → понятная ошибка), `modelAcceptsTemperature` (закрытый allow-список семейств до Opus 4.7). Тесты: `tests/unit/anthropicRequest.test.ts`, 23 теста.
- `aiAgentService`: `requestAnthropic` собирает тело через модуль; возможности модели берутся из Models API один раз на модель (успех кэшируется на время жизни процесса, ошибка — на 60 с; при ошибке запрос идёт без thinking). `AIStreamRequest.maxTokens` добавлен в обе копии типов. `getConfig()` без файла → `{provider:'anthropic', model:'default'}`. `complete()` тоже считает `default` незаданной моделью.
- `agentFleetService.runApiAgent`: без `providerConfig` слота берутся настройки AI Studio (`getConfig()`), а не `claude-3-7-sonnet-latest`.
- `NewSwarmModal`: `claude-3-7-sonnet-latest` → `default` (5 мест), имена пресетов без «3.7».
- `AISettingsModal`: `MODEL_PRESETS` без снятых `claude-3-*`, с `claude-fable-5-1`/`claude-opus-5`/`claude-sonnet-5`/`claude-haiku-4-5` (согласовано с владельцем); слайдер Thinking Budget показывается для `anthropic` без условия на `3-7`; у temperature появилось состояние «по умолчанию модели» и сброс; подсказки ru/en. `DEFAULT_CONFIG` рендерера — без `temperature: 0.7` и `thinkingBudget: 2048`.
- `agentCost.ts` не тронут: `claude-3-7-sonnet` там — ключ таблицы цен для старых сессий.

## Согласованные отклонения от формулировок AC

- AC#2: живой проверки не было — на машине нет API-ключа Anthropic. По согласованию с владельцем закрыт unit-тестами сборки тела и разбора Models API; живая проверка вынесена в TASK-91.
- AC#3: буквально невыполним из-за API — на Opus 4.7+/Sonnet 5/Fable/Mythos нестандартная temperature даёт 400 всегда, на старых моделях она несовместима с thinking. По согласованию реализована «честная развязка»: дефолт 0.7 больше не подставляется, temperature уходит только при явном значении, если модель её принимает и thinking в запросе не включён; иначе — пояснение в main.log. Решение — decision-33.

## Найдено попутно (не исправлялось)

- TASK-92: OpenAI-совместимый путь — `model || 'deepseek/deepseek-chat'`, `temperature ?? 0.7`, `maxTokens` игнорируется; `handleProviderChange` делает первую подсказку каталога выбранной моделью.
- `tsconfig.node.json` даёт TS6307 на импорты `src/utils` из `assignedTaskRules`/`remoteControlService` (существовало до задачи; основной `tsconfig.json` проходит).
- GitNexus не индексирует ProjectHub (в индексе Clinic, PlatOne, StarfallMetroidvania, RealmLoop) — impact проверялся grep по вызовам `getConfig`/`streamChat`.

## Проверки

lint — 0 ошибок, 502 предупреждения (было 503); npm test — 92 файла / 973 теста; check-bundle — ок; lint:docs — ок; index-docs — 415 чанков / 43 файла; pack:win — `release/win-unpacked/ProjectHub.exe` обновлён 2026-09-17 17:49:33, в `app.asar` есть запрос к Models API и нет `claude-3-7-sonnet-20250219`. GUI-прогон не выполнялся.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Потоковый API-путь Anthropic переведён на чистую функцию `buildAnthropicMessagesBody` (`electron/services/anthropicRequest.ts`, 23 unit-теста). Режим thinking выбирается по `capabilities.thinking.types` из Models API (adaptive → `{type:"adaptive", display:"summarized"}`, только enabled → `budget_tokens` в допустимых границах). `max_tokens` задаётся через `AIStreamRequest.maxTokens` (по умолчанию 64 000, ограничен потолком модели). `temperature` отправляется только при явном значении, если модель её принимает и thinking не включён. Вендорские дефолты моделей убраны из `getConfig()`, тела запроса, `agentFleetService` и `NewSwarmModal`; незаданная модель (`''`/`default`) даёт понятную ошибку. Каталог подсказок `AISettingsModal` обновлён. Решение — decision-33. AC#2 закрыт unit-тестами (живая проверка — TASK-91), AC#3 сужен из-за ограничений API по согласованию с владельцем. Смежный дефект OpenAI-совместимого пути — TASK-92.
<!-- SECTION:FINAL_SUMMARY:END -->
