---
id: TASK-70
title: >-
  Универсальный OpenAI-совместимый провайдер для любой LLM: каталог моделей,
  capability-флаги, reasoning_effort, редактируемые цены
status: To Do
assignee: []
created_date: '2026-09-15 03:05'
updated_date: '2026-09-19 01:50'
labels:
  - ai
  - providers
  - model-agnostic
  - local-llm
  - cost
milestone: m-0
dependencies: []
references:
  - 'https://openrouter.ai/docs/api-reference/list-available-models'
  - 'https://platform.openai.com/docs/api-reference/models/list'
  - 'https://github.com/ollama/ollama/blob/main/docs/openai.md'
  - >-
    backlog/decisions/decision-26 -
    Независимость-от-вендора-LLM-Codex-app-server-универсальный-OpenAI-совместимый-провайдер-и-тиры-моделей.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ProjectHub должен работать с **любой** LLM — облачной или локальной — без привязки к вендору и без обязательных «флагманов» ([[decision-26]] п. 0, doc-10 §0). Сейчас `aiAgentService` знает пять провайдеров (`anthropic`, `openrouter`, `deepseek`, `ollama`, `custom`), но `custom` — это голый эндпоинт без каталога моделей, без capability-флагов, без параметра усилия рассуждений и без стоимости; новые сервисы (Mistral, Groq, xAI, Together, Fireworks, LM Studio, vLLM, llama.cpp server, Jan) приходится «притворять» custom-ом, а цены не считаются.

## Что сделать
1. **Обобщить `custom` в «OpenAI-совместимый провайдер» с профилями.** Профиль = имя, `baseUrl`, ключ (через `secretStorageService`), заголовки, флаги совместимости (поддержка `tools`, `reasoning_effort`/`reasoning`, `response_format`, стриминг usage, vision). Встроенные пресеты: OpenAI, Mistral, Groq, xAI, Together, Fireworks, DeepSeek, OpenRouter, Ollama (`/v1`), LM Studio, vLLM, llama.cpp server, Jan. Несколько профилей одновременно; любой можно назначить по умолчанию. Провайдер `anthropic` остаётся отдельным (Messages API).
2. **Каталог моделей от провайдера**: `GET /v1/models` (с кэшем и ручным обновлением) + ручной ввод id; в `ModelSelectorDropdown` — группировка по профилю, поиск, пометка «локальная». Ни одна модель не является обязательной или дефолтной «из коробки»: дефолт выбирает пользователь, при отсутствии выбора — первая доступная локальная (Ollama), затем первая настроенная облачная.
3. **Усилие рассуждений** как универсальный параметр слота/сессии (`none|low|medium|high|max`), который адаптер провайдера транслирует в его формат (`reasoning_effort`, `reasoning: {effort}`, `thinking.budget_tokens` у Anthropic, `think` у Ollama) или молча игнорирует, если модель не поддерживает. Дельты рассуждений (`reasoning_content`, `reasoning`, `thinking_delta`) — в поток `thought`.
4. **Цены — редактируемая таблица**, а не хардкод: `<userData>/agent-pricing.json` уже поддерживается `agentCost`; добавить UI-редактор (модель → вход/выход/кэш, порог и множитель длинного контекста), импорт цен из OpenRouter API для облачных моделей, «0» для локальных. Встроенная таблица обновляется датой `updatedAt: "2026-09-15"` для актуальных семейств Claude 5, GPT-5.6/6, Gemini, DeepSeek, Mistral — как справочник, а не как требование.
5. Usage из ответов OpenAI-совместимых серверов (`usage`, `prompt_tokens_details.cached_tokens`) → `AgentUsage`; для серверов без usage — оценка по токенайзеру с пометкой `costSource: 'unknown'`.
6. Swarm-слот `api` с любым профилем работает в Arena; экспорт содержит профиль, модель и стоимость.

## Вне scope
Codex app-server (TASK-71), тиры и fallback (TASK-79), computer use (TASK-78).

## Справочно (не требование)
GPT-6 Astra (`gpt-6-astra`): контекст 1,05 млн, $10/$50, `reasoning_effort` до `max`, наценка ×2/×1,5 при входе > 272K — просто одна из строк каталога и таблицы цен; ProjectHub не должен её ни требовать, ни предпочитать.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Провайдер «OpenAI-совместимый» с профилями (baseUrl, ключ в secretStorage, флаги совместимости) и встроенными пресетами (не менее 10, включая LM Studio, vLLM, llama.cpp, Ollama /v1); несколько профилей одновременно
- [ ] #2 Каталог моделей загружается из /v1/models профиля с кэшем и ручным обновлением; ручной ввод id сохранён; ни одна модель не захардкожена как обязательная или дефолтная
- [ ] #3 Универсальный параметр усилия рассуждений транслируется адаптером в формат провайдера (OpenAI-совместимые, Anthropic thinking, Ollama think) или игнорируется без ошибки; дельты рассуждений показываются как thought
- [ ] #4 Таблица цен редактируется в UI (вход/выход/кэш, порог и множитель длинного контекста), импортируется из OpenRouter; локальные модели считаются по нулевой цене; расчёт покрыт unit-тестами
- [ ] #5 Usage из ответов OpenAI-совместимых серверов (включая cached_tokens) попадает в AgentUsage; без usage — оценка с пометкой unknown
- [ ] #6 Слот Swarm с любым профилем работает в Arena; проверено минимум на одной локальной модели (Ollama или LM Studio) и одной облачной
- [x] #7 Ошибки доступа/отсутствия модели показываются понятно и не роняют сессию; i18n ru/en; lint/test/check-bundle зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-19, AC#7 закрыт TASK-70.6 (decision-43): классификатор ошибок провайдера `providerErrors.ts` (auth, quota, model_not_found, rate_limit, unavailable, bad_request, config, unknown; retryable, retry-after), сообщение «что случилось — где — что сделать», ключи вырезаются. AI Studio — локализованная карточка ошибки ru/en с «Повторить», чат остаётся рабочим; слот Swarm — failed со снимком `providerError`, остальные слоты работают, вид ошибки в экспорте; ревьюер Arena — `review.providerError`; ошибки внутри SSE-потока больше не теряются. Проверено вживую на Ollama 0.34/0.31.2 (несуществующая модель, выключенный порт, fan-out с одним сломанным слотом) и 401 облачных сервисов без ключа; 429/402/5xx облака — фикстуры по документации (ключей нет). lint 0/499, test 111/1311, check-bundle ✅, pack:win собран (exe 09:47:40).
<!-- SECTION:NOTES:END -->
