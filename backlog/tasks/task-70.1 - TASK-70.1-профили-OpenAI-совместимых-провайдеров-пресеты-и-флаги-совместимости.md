---
id: TASK-70.1
title: 'Профили OpenAI-совместимых провайдеров, пресеты и флаги совместимости'
status: Review
assignee: []
created_date: '2026-09-18 12:40'
updated_date: '2026-09-18 13:00'
labels:
  - ai
  - model-agnostic
dependencies: []
references:
  - electron/services/llmProfiles.ts
  - electron/services/llmProfileService.ts
  - electron/services/openAICompatibleRequest.ts
  - electron/services/aiAgentService.ts
  - electron/ipc/aiIpc.ts
  - src/components/ai/LlmProfilesSection.tsx
  - src/components/ai/AISettingsModal.tsx
  - tests/unit/llmProfiles.test.ts
  - tests/unit/llmProfileService.test.ts
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Часть AC#1 TASK-70 (decision-26 п. 1). Профиль = имя, baseUrl, ключ (secretStorage, в renderer не отдаётся), флаги совместимости. Встроенные пресеты (не менее 10, включая Ollama /v1, LM Studio, vLLM, llama.cpp, Jan). Несколько профилей одновременно. Новый провайдер `openai-compatible` + `profileId` в AIProviderConfig; потоковый путь и `complete` используют эндпоинт и флаги профиля. Старые провайдеры openrouter/deepseek/ollama/custom продолжают работать. UI: создание/редактирование/удаление профилей в AISettingsModal, i18n ru/en.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Пресеты (>= 10) и профили описаны чистыми модулями и покрыты unit-тестами
- [x] #2 Профили хранятся на диске, ключ зашифрован и не возвращается в renderer
- [x] #3 Провайдер openai-compatible с profileId работает в streamChat и complete; тело запроса учитывает флаги профиля
- [x] #4 В AISettingsModal можно создать, изменить и удалить профиль и выбрать его; i18n ru/en
- [x] #5 Решение оформлено ADR
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-39, 2026-09-18)
- `llmProfiles.ts` — чистый модуль: 14 пресетов (OpenAI, OpenRouter, DeepSeek, Mistral, Groq, xAI, Together, Fireworks, Ollama /v1, LM Studio, vLLM, llama.cpp, Jan, Custom), флаги совместимости (`tools`, `vision`, `streamUsage`, `openRouterUsage`, `maxTokensField`, `reasoning`, `responseFormat`), `normalizeProfile` (проверка id и адреса, флаги из пресета, фильтр заголовков: без `Authorization` и переводов строки), `buildProfileHeaders`, `legacyProviderCompat` (прежнее поведение openrouter/deepseek/ollama/custom).
- `llmProfileService.ts` — `~/.projecthub/llm-profiles.json`, ключ шифруется `secretStorageService`, в renderer — только `hasApiKey`; запись атомарная и последовательная; испорченный профиль пропускается.
- `AIProviderConfig`: провайдер `openai-compatible` + `profileId`. `aiAgentService.resolveOpenAICompatibleTarget` — общий для потокового пути и `complete`; `buildOpenAICompatibleChatBody` принимает флаги вместо имени провайдера; tools не отправляются профилю без `tools`, изображения из результатов инструментов — только при `vision`.
- IPC `llmProfiles:*`, preload, типы renderer; UI `LlmProfilesSection` в AISettingsModal (выбор, создание из пресета, редактирование, удаление с подтверждением, флаги), i18n ru/en.

## Не проверено вживую
Флаги облачных пресетов взяты из документации сервисов; вживую проверен только Ollama (TASK-70.2). Живая проверка облачного профиля — TASK-70.5.

## Проверки
Unit: `llmProfiles.test.ts`, `llmProfileService.test.ts`, обновлённый `openAICompatibleRequest.test.ts`. Полный `npm test` 2 раза: 104/104 файлов, 1139/1139, сирот 0. ESLint 0 ошибок, 501 предупреждение (= baseline). lint:docs, check-index — ок.
`pack:win` 2026-09-18 (build зелёный, check-bundle ✅). Скриншот собранного exe на копии userData с временным USERPROFILE (копия удалена): кнопка «OpenAI-compatible», создание профиля Ollama из пресета, профиль выбран, каталог «models: 3».
<!-- SECTION:NOTES:END -->
