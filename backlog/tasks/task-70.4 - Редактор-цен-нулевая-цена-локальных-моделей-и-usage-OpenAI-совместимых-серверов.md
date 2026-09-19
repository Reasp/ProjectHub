---
id: TASK-70.4
title: >-
  Редактор цен, нулевая цена локальных моделей и usage OpenAI-совместимых
  серверов
status: Done
assignee:
  - '@claude'
created_date: '2026-09-18 12:54'
updated_date: '2026-09-19 07:57'
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
- [x] #1 Расчёт цен и импорт покрыты unit-тестами
- [x] #2 Таблица цен редактируется в UI
- [x] #3 Локальные модели считаются по нулевой цене
- [x] #4 cached_tokens попадают в AgentUsage; без usage — оценка с пометкой unknown
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-42, 2026-09-19)
- `agentCost.ts`: `CostSource` + `local`; `AgentUsage.estimated`; `priceUsage(usage, model, table, { local })` — provider не перетирается → local = 0 → оценка у платной модели = unknown без стоимости → таблица/unknown; `estimateUsage` (~4 символа/токен); `addUsage` сохраняет `estimated`, ранг unknown < local < price-table < provider; `mergePriceTables` отбрасывает отрицательные/нечисловые цены; `formatUsd` для < $0.0001 — две значащие цифры (было «$0.0000»).
- `agentPricing.ts` (чистый): `sanitizePriceOverrides`, `parseOpenRouterModels` (USD/токен → USD/1M, кэш, пропуск `:`-вариантов, цены -1, дублей; `overrides` длинного контекста не импортируются), `applyImportedPrices`.
- `pricingService.ts` (main): одна таблица на процесс для Swarm (`agentFleetService.getPriceTable`, `setPriceTable` — тесты), API-пути AI Studio (`aiAgentService.streamChat` считает стоимость итогового usage той же функцией, это же получает ревьюер Arena) и Claude CLI (`claudeBridgeService`, раньше — встроенная таблица без переопределений). Сохранение атомарное и сразу меняет таблицу в памяти. IPC `pricing:get|save|fetchOpenRouter`.
- Локальность — по провайдеру: профиль `local`, прежний провайдер — `legacyProviderIsLocal` (ollama всегда, custom — localhost); Swarm берёт `providerInfo.local` снимка слота, AI Studio — `local` цели запроса.
- Ollama: `streamUsage: true` в пресете и `legacyProviderCompat('ollama')`; сохранённые профили не мигрируются.
- Без usage: `aiAgentService` оценивает каждый ответ без usage (запрос + tools, ответ + рассуждения + аргументы вызовов); Swarm — ход агента без usage (CLI без итоговой строки).
- UI: вкладка «Цены» в настройках AI Studio (`PricingEditorSection`, чистые функции в `src/lib/pricingEditor.ts`): встроенные/переопределённые/свои/OpenRouter с метками, правка, сброс к встроенной, удаление своей, поиск, добавление, импорт OpenRouter по кнопке с выбором галочками, сохранение отдельной кнопкой. Карточка агента: «$0.00 (локальная)», `~` у оценённых токенов с пояснением. Экспорт: «$0.00 (локальная)», источник стоимости по-русски, пометка оценки. i18n ru/en.
- Длинный контекст в `ModelPrice` не добавлен — обоснование в decision-42 (usage суммируется по ходам; у текущих моделей Anthropic надбавки нет по скиллу claude-api).

## Живая проверка, 2026-09-19
- curl: Ollama 0.34.0 и 0.31.2 принимают `stream_options.include_usage` (usage в последнем чанке); 0.34 отдаёт `prompt_tokens_details.cached_tokens` (повтор с тем же префиксом: 1679 из 1680), 0.31.2 кэш не сообщает; без флага usage в стриме нет.
- Временный тест через настоящие `aiAgentService`/`llmProfileService`/`pricingService`/`AgentFleetService` (удалён): qwen2.5:7b-instruct локально — в теле `stream_options`, usage не оценка, `cacheReadTokens` 1888, `local` $0; ornith:35b (192.168.1.11) с усилием low и tools — 461 символ thought, вызов инструмента, usage из стрима (2364/180), `local` $0; тот же ornith через профиль без local + цена в переопределениях — `price-table` $0.000129; профиль без streamUsage — `estimated`, у локального $0, у облачного `unknown` без стоимости; слот Swarm с локальным профилем по имени — `local` $0, экспорт «$0.00 (локальная)».
- Импорт OpenRouter вживую без ключа: 446 моделей, 339 к импорту (96 вариантов, 5 роутеров, 6 дублей), у 49 — тариф длинного контекста.
- Скриншоты собранного exe (копия userData, временный HOME с профилем Ollama; реальный `projects.json` не менялся — реестр проектов читает домашний каталог через Electron): вкладка «Цены» (en/ru), правка claude-opus-5 («4,5» → 4.5), своя модель, импорт gpt-4o-mini, сохранение → agent-pricing.json с `source`, сброс к встроенной; Swarm Arena с реальной сессией (прогон на Ollama записан в копию userData): «$0.00 (local)» / «$0.00 (локальная)», у той же модели без local — цена по таблице. По скриншоту исправлен вывод долей цента («$0.0000» → «$0.000040»).

## Не проверено
Облачных ключей нет: usage и `cached_tokens` OpenAI/DeepSeek, `cost` OpenRouter вживую не проверены — разбор покрыт unit-тестами на форматы из документации.

## Проверки
- Unit: `tests/unit/agentPricing.test.ts` (22 теста, фикстура `tests/unit/fixtures/openrouter-models.json` из живого ответа OpenRouter), дополнения `agentFleetPersistence.test.ts` (локальный профиль → $0.00 (локальная); без usage → оценка), `llmProfiles.test.ts`, `openAICompatibleRequest.test.ts` (Ollama теперь со stream_options), `swarmExport.test.ts`, `agentCost.test.ts`.
- Полный `npm test`: 109/109 файлов, 1238/1238; сирот нет (14 node-процессов до и после). ESLint 0 ошибок, 499 предупреждений (baseline). check-bundle ✅. lint:docs, index-docs — ок, `search_docs` находит decision-42.
- `pack:win` 2 раза (build зелёный), последний exe 08:37:20, app.asar 08:37:18. Копии userData/HOME и junction удалены.
- Замечание по UI: в ru длинные id (claude-3-5-sonnet) в таблице цен обрезаются из-за метки «ВСТРОЕННАЯ»; полный id — во всплывающей подсказке.
<!-- SECTION:NOTES:END -->
