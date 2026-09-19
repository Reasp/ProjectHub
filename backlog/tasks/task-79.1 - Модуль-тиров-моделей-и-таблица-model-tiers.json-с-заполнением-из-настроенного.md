---
id: TASK-79.1
title: Модуль тиров моделей и таблица model-tiers.json с заполнением из настроенного
status: Review
assignee: []
created_date: '2026-09-19 06:17'
updated_date: '2026-09-19 06:53'
labels:
  - ai
  - routing
milestone: m-0
dependencies: []
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
modified_files:
  - electron/services/modelTiers.ts
  - electron/services/modelTierService.ts
  - electron/services/llmModelCatalogService.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - tests/unit/modelTiers.test.ts
parent_task_id: TASK-79
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-44 п. 1–3, 5, 6. Чистый модуль `electron/services/modelTiers.ts` (схема, нормализация, цепочка, `decideFallback`) и сервис `modelTierService.ts` (чтение/атомарная запись `<userData>/model-tiers.json`, первичное заполнение из модели AI Studio, кэша каталогов профилей и алиасов Claude CLI), IPC и preload.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Чистый модуль: схема, нормализация битых записей, цепочка per-движок со спуском в младший тир, decideFallback по decision-43 §8; unit-тесты
- [x] #2 Сервис: чтение, атомарная запись, заполнение при отсутствии файла и по кнопке без вендорских дефолтов и без сети
- [x] #3 IPC и типы renderer без any
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-44 п. 1–3, 5, 6.
- `modelTiers.ts` (чистый): схема `ModelTierSettings`, `normalizeModelTierSettings` (битые записи и повторы пропускаются с пояснением, `maxSwitches` 0…2, `maxWaitMs` 0…120 с), `buildModelChain` (явная модель → тир → младшие тиры, повторы убираются), `fallbackRuleFor`/`decideFallback` по decision-43 §8, `seedModelTiers` (модель AI Studio → balanced, алиасы Claude CLI haiku/sonnet/opus, модели каталогов по размеру в id: <10B cheap, 10–30B balanced, >30B frontier; эмбеддинги и модели без размера не распределяются), снимок `ModelRoutingInfo`.
- `modelTierService.ts`: `<userData>/model-tiers.json`, атомарная запись по очереди, заполнение при отсутствии файла (и запись), «Заполнить из настроенного» — черновик без записи. Источники заполнения без сети: профили, `llmModelCatalogService.cachedModels()` (новый метод — кэш без запросов), `aiAgentService.getConfig`, `claudeBridgeService.ensureClaudeCliAvailable`.
- IPC `modelTiers:get|save|seed`, preload `getModelTiers/saveModelTiers/seedModelTiers`, типы в `electron.d.ts` без any.
- Живая проверка: заполнение на реальных профилях (Ollama localhost, LAN 192.168.1.11) дало qwen2.5 (AI Studio) в balanced, ornith:35b в frontier, llama3.1:8b/qwen3.5:9b/deepseek-coder:6.7b в cheap, алиасы CLI; модели LAN без размера (`claude-sonnet-4-6:latest` и т.п.) не распределены.
- Тесты: `tests/unit/modelTiers.test.ts` (23, включая правило по всем фикстурам `provider-errors.json`).
<!-- SECTION:NOTES:END -->
