---
id: TASK-70.5
title: >-
  Профиль провайдера в слотах Swarm, ролях и Arena; выбор модели по профилям в
  AI Studio
status: Review
assignee: []
created_date: '2026-09-18 12:54'
updated_date: '2026-09-18 13:47'
labels:
  - ai
  - model-agnostic
  - swarm
dependencies:
  - TASK-70.1
  - TASK-70.2
references:
  - >-
    backlog/decisions/decision-40 -
    Провайдер-слота-Swarm-роли-и-ревьюера-Arena-профиль-без-вендорских-fallback.md
modified_files:
  - electron/services/slotProvider.ts
  - electron/services/agentFleetService.ts
  - electron/services/arenaJudgeService.ts
  - electron/services/arenaConfig.ts
  - electron/services/arenaTypes.ts
  - electron/services/actionConfigService.ts
  - electron/services/swarmExport.ts
  - electron/services/swarmTypes.ts
  - electron/services/roleService.ts
  - electron/services/roleTypes.ts
  - electron/services/llmProfiles.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - src/lib/providerSelect.ts
  - src/components/ai/ProviderProfileSelect.tsx
  - src/components/ai/ModelSelectorDropdown.tsx
  - src/components/ai/AIStudioView.tsx
  - src/components/ai/AISettingsModal.tsx
  - src/components/ai/roles/RolesSettingsModal.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/components/ai/swarm/ArenaSettingsModal.tsx
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/types/electron.d.ts
  - tests/unit/slotProvider.test.ts
  - tests/unit/providerSelect.test.ts
  - tests/unit/llmProfiles.test.ts
  - tests/unit/swarmExport.test.ts
  - tests/unit/roleService.test.ts
  - tests/unit/agentFleetPersistence.test.ts
  - >-
    backlog/decisions/decision-40 -
    Провайдер-слота-Swarm-роли-и-ревьюера-Arena-профиль-без-вендорских-fallback.md
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
- [x] #1 Слот и роль с profileId работают в Swarm и Arena, экспорт содержит профиль
- [x] #2 ModelSelectorDropdown группирует модели по профилям, с поиском и пометкой «локальная»
- [x] #3 Вендорские fallback-модели codex/gemini удалены
- [ ] #4 Проверено вживую на локальной и облачной модели
- [x] #5 Прежние провайдеры мигрированы в профили или решение оформлено ADR
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-40, 2026-09-18)
- `electron/services/slotProvider.ts` — чистый модуль: `resolveProfileRef` (id, затем однозначное имя), `providerConfigFromSpec` (профиль важнее провайдера; только модель — без `anthropic`), `resolveSlotProviderConfig` (AI Studio / профиль / только модель / тот же прежний провайдер / Ollama без ключа / иной прежний провайдер — ошибка), `reviewerProviderSpec`, `apiConfigProblem`, `describeProviderInfo`.
- Цепочка ключа: при `profileId` ключ берёт `llmProfileService.resolveRequestTarget` — проверено вживую. Слот с прежним облачным провайдером ≠ провайдеру AI Studio раньше падал на отсутствии ключа, теперь понятная ошибка с советом создать профиль.
- `agentFleetService.runApiAgent` разрешает провайдера слота, пишет снимок `AgentSlotState.providerInfo` и строку в лог; `startAssignedAgent` строит слот из роли без fallback `anthropic`/`default`. Запасной путь Codex/Gemini CLI — `runCliApiFallback` с настройками AI Studio; `openai/gpt-4o` и `google/gemini-2.0-flash-001` удалены.
- Роль: поле `profile` (имя или id) во frontmatter, редактор ролей пишет имя. Arena: `arena.reviewer.profile`, `DEFAULT_REVIEWER_MODEL = 'claude-sonnet-5'` удалён, провайдер ревьюера — настройки → роль → AI Studio.
- `AgentSlotConfig.providerConfig` стал `Partial<AIProviderConfig>`. Пресеты NewSwarmModal нейтральны к вендору (без `deepseek-chat`, `openai/gpt-4o`, `temperature`), смена провайдера слота сбрасывает модель.
- Экспорт: колонка «Провайдер · модель», строка профиля с id и «локальная», JSON — `providerInfo`; стоимость уже была.
- UI: `ProviderProfileSelect` (+ `useLlmProfiles`, `useProfileModels`) в слоте, редакторе ролей и настройках ревьюера; подсказки модели из каталога профиля. `ModelSelectorDropdown` — группы Claude Code CLI + профили (локальные первыми, пометка local), поиск по id/имени/профилю, подпись триггера «модель · профиль». Бейдж провайдера на карточке агента. Чистые функции UI — `src/lib/providerSelect.ts`.
- Прежние провайдеры (AC#5): оставлены, решение — decision-40; кнопка «Перенести в профиль» в AISettingsModal (`profileFromLegacyConfig`, IPC `llmProfiles:importLegacy`): профиль из сохранённых настроек, адрес/заголовки/флаги как у прежнего провайдера, `ai-config.json` меняется только по «Сохранить».

## Живая проверка на Ollama 0.34 (qwen2.5:7b-instruct), 2026-09-18
Временный тест через настоящие сервисы (удалён): fan-out из двух API-слотов с профилем по имени и по id → оба «Париж», `providerInfo` = профиль «Ollama», local; слот codex-cli без установленного CLI → failed с «Запасной API-путь недоступен: в AI Studio выбран Anthropic без API-ключа», OpenRouter в логах нет; автосудья с `reviewer.profile: 'ollama'` (другой регистр) → ревью status done, модель qwen; роль с `profile: Ollama` через `startAssignedAgent` → completed, `providerInfo.profileId` верный; экспорт Markdown содержит «профиль «Ollama» (локальная)».
Замечено: Ollama не отдаёт usage в стриме (флаг `streamUsage` пресета выключен), поэтому у локальных агентов токены — оценка, стоимость «—». Это зона TASK-70.4.

## Не проверено
**AC#4 не отмечен**: облачную модель проверить нечем — API-ключа облачного провайдера нет. Кнопка «Перенести в профиль» в UI вживую не нажималась (нужен сохранённый прежний провайдер с ключом); функция переноса покрыта unit-тестами на совпадение адреса с прежним `llmEndpoint`.

## Проверки
Unit: `slotProvider.test.ts`, `providerSelect.test.ts`, дополнения в `llmProfiles.test.ts`, `swarmExport.test.ts`, `roleService.test.ts`; `agentFleetPersistence.test.ts` переведён на профили (слоты deepseek/custom при anthropic в AI Studio теперь намеренно падают). Полный `npm test` 2 раза: 106/106 файлов, 1176/1176, сирот 0 (13 node-процессов MCP-серверов до и после). ESLint 0 ошибок, 499 предупреждений (baseline 501). lint:docs, index-docs — ок.
`pack:win` 2 раза (build зелёный, check-bundle ✅), последний exe 21:45:59, app.asar 21:45:57. Скриншоты собранного exe на копии userData и временном HOME (копии удалены): меню моделей с группой Ollama и пометкой local, поиск «qwen», триггер «qwen2.5:7b-instruct · Ollama», провайдер «Ollama · local» в редакторе роли, слот Swarm с профилем и подсказками модели. По скриншоту исправлен вылезающий ряд слота (flex-wrap).
<!-- SECTION:NOTES:END -->
