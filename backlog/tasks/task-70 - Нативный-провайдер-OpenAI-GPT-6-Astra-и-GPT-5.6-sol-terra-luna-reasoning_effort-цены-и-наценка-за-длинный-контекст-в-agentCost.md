---
id: TASK-70
title: >-
  Нативный провайдер OpenAI: GPT-6 Astra и GPT-5.6 (sol/terra/luna),
  reasoning_effort, цены и наценка за длинный контекст в agentCost
status: To Do
assignee: []
created_date: '2026-09-15 03:05'
labels:
  - ai
  - openai
  - gpt-6-astra
  - providers
  - cost
milestone: m-0
dependencies: []
references:
  - 'https://openai.com/index/gpt-6-astra/'
  - 'https://openrouter.ai/openai/gpt-6-astra'
  - >-
    https://codex.danielvaughan.com/2026/09/03/gpt-6-astra-codex-cli-configuration-context-notes-safety/
  - >-
    backlog/decisions/decision-26 -
    Codex-app-server-как-протокол-интеграции-нативный-провайдер-OpenAI-и-тиры-моделей-вместо-жёстких-id.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас `aiAgentService` не имеет провайдера `openai` (есть `anthropic`, `openrouter`, `deepseek`, `ollama`, `custom`), поэтому GPT-6 Astra доступна только через OpenRouter или `custom`-эндпоинт — без `reasoning_effort`, без учёта кэш-цен и наценки за длинный контекст. Задача добавляет прямой провайдер и корректный учёт стоимости (см. [[decision-26]], doc-10).

## Факты о моделях (сентябрь 2026)
- `gpt-6-astra`: контекст 1 050 000 токенов, вход до 922 000, выход до 128 000, knowledge cutoff 2026-04-30; `reasoning_effort` ∈ `low|medium|high|xhigh|max`.
- Цены: $10 вход / $50 выход / $1 кэш-чтение за 1 млн; вход свыше 272 000 токенов — ×2 вход, ×1,5 выход на весь запрос; batch/flex −50 %, fast ×2.
- Линейка GPT-5.6: `gpt-5.6-sol` (сильная), `gpt-5.6-terra` (баланс), `gpt-5.6-luna` (быстрая/дешёвая); `gpt-5.4`/`gpt-5.4-mini` сняты 2026-08-31.
- Доступ к Astra поэтапный (Trusted Access → Plus/Pro/Business/Enterprise); при 403/404 по модели нужен понятный fallback.

## Что сделать
1. `AIProviderConfig.provider` += `'openai'`; эндпоинт `https://api.openai.com/v1/chat/completions` (Responses API — отдельно, если понадобится computer use), ключ через `secretStorageService` (`openaiApiKey`), поле в `AISettingsModal`.
2. Параметр `reasoningEffort` в конфиге и в `AISettingsModal`/`ModelSelectorDropdown`; передавать `reasoning_effort` для моделей OpenAI (и через OpenRouter, где поддерживается). Парсинг `reasoning`/`reasoning_content` дельт в поток `thought`.
3. Каталог моделей OpenAI в `ModelSelectorDropdown` (Astra, sol, terra, luna) с подсказкой цены и контекста; при ошибке «model not found / no access» — сообщение и предложение выбрать sol.
4. `agentCost`: цены Astra/5.6 в встроенной таблице (`updatedAt: "2026-09-15"`), поля `cacheRead`, правило наценки для входа > 272K (новое поле `longContextThreshold`/`longContextMultiplier` в `ModelPrice`), unit-тесты на расчёт.
5. Usage из ответа OpenAI (`usage.prompt_tokens_details.cached_tokens`) → `AgentUsage.cacheReadTokens`.
6. Swarm-слот `api` с провайдером `openai` работает в Arena наравне с остальными; экспорт сессии содержит модель и стоимость.

## Вне scope
Codex app-server (отдельная задача), тиры моделей (отдельная задача), computer use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В aiAgentService добавлен провайдер openai с ключом в secretStorageService и полем в AISettingsModal; запрос к gpt-6-astra и gpt-5.6-* проходит со стримингом и tool use
- [ ] #2 Параметр reasoning_effort (low|medium|high|xhigh|max) настраивается в UI и передаётся в запрос; дельты рассуждений отображаются как thought
- [ ] #3 agentCost считает стоимость Astra/5.6 с кэш-чтением и наценкой за вход > 272K; покрыто unit-тестами (tests/unit)
- [ ] #4 Каталог моделей OpenAI в ModelSelectorDropdown с подсказкой цены/контекста; ошибка доступа к модели показывается понятно и не роняет сессию
- [ ] #5 Слот Swarm с провайдером openai работает в Arena, стоимость и модель видны в карточке и экспорте
- [ ] #6 i18n ru/en, npm run lint/test/check-bundle зелёные, npm run pack:win собран
<!-- AC:END -->
