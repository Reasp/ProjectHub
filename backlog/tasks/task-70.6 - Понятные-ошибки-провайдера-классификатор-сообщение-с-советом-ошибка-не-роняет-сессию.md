---
id: TASK-70.6
title: >-
  Понятные ошибки провайдера: классификатор, сообщение с советом, ошибка не
  роняет сессию
status: Review
assignee: []
created_date: '2026-09-19 01:16'
updated_date: '2026-09-19 01:49'
labels:
  - ai
  - providers
  - errors
  - i18n
milestone: m-0
dependencies: []
references:
  - >-
    backlog/decisions/decision-26 -
    Независимость-от-вендора-LLM-Codex-app-server-универсальный-OpenAI-совместимый-провайдер-и-тиры-моделей.md
  - >-
    backlog/decisions/decision-40 -
    Провайдер-слота-Swarm-роли-и-ревьюера-Arena-профиль-без-вендорских-fallback.md
  - >-
    backlog/decisions/decision-41 -
    Усилие-рассуждений-единая-шкала-и-трансляция-в-формат-провайдера.md
modified_files:
  - electron/services/providerErrors.ts
  - electron/services/aiAgentService.ts
  - electron/services/agentFleetService.ts
  - electron/services/arenaJudgeService.ts
  - electron/services/arenaTypes.ts
  - electron/services/swarmTypes.ts
  - electron/services/swarmExport.ts
  - electron/services/slotProvider.ts
  - electron/services/llmProfileService.ts
  - electron/services/llmModelCatalogService.ts
  - electron/services/llmEndpoint.ts
  - electron/services/openAICompatibleRequest.ts
  - electron/services/reasoningEffort.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/remoteControlService.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - src/lib/providerErrorView.ts
  - src/components/ai/ProviderErrorCard.tsx
  - src/components/ai/AIStudioView.tsx
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/store/useAIStudioStore.ts
  - src/types/electron.d.ts
  - src/types/remote.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/providerErrors.test.ts
  - tests/unit/providerErrorView.test.ts
  - tests/unit/fixtures/provider-errors.json
  - tests/unit/agentFleetPersistence.test.ts
  - tests/unit/llmProfileService.test.ts
  - tests/unit/reasoningEffort.test.ts
  - >-
    backlog/decisions/decision-43 -
    Ошибки-провайдера-LLM-классификатор-сообщение-с-советом-и-снимок-для-fallback.md
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Закрывает AC#7 TASK-70: «ошибки доступа/отсутствия модели показываются понятно и не роняют сессию; i18n ru/en».

Сейчас ошибка OpenAI-совместимого пути — «API Error (status): сырое тело», сетевая — «fetch failed», ошибка внутри SSE-потока (OpenRouter шлёт её со статусом 200) молча игнорируется, Anthropic-путь — «Anthropic API Error (status): тело». Карточка агента Swarm показывает причину только во всплывающей подсказке, вида ошибки нет ни в снимке слота, ни в экспорте — TASK-79 (fallback при 429/503/model-not-found, decision-26 п. 6) не на что опереться.

Сделать: чистый классификатор ошибок провайдера (HTTP-статус + тело + сетевые ошибки + ошибки конфигурации), сообщение «что случилось / где / что сделать», структурированный снимок ошибки для AI Studio, слота Swarm, ревьюера Arena и complete(); ключ и Authorization не попадают в сообщения и логи. Сам fallback — не здесь (TASK-79).

Решение — decision-43.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Чистый классификатор ошибок провайдера (HTTP-статус + тело + сетевые ошибки + ошибки конфигурации) → вид auth, quota, model_not_found, rate_limit (retry-after), unavailable (5xx, ECONNREFUSED, DNS, таймаут), bad_request (tools, reasoning, контекст, неподдерживаемый режим), config, unknown; покрыт unit-тестами на реальных телах ответов (Ollama 0.34/0.31.2, OpenRouter, OpenAI, DeepSeek, Groq, Mistral, Anthropic) и фикстурах по документации для 429/5xx/контекста
- [x] #2 Сообщение пользователю: что случилось, какой профиль/адрес/модель, что сделать (ключ профиля, каталог моделей, запуск Ollama и т.п.); в UI (AI Studio, карточка агента Swarm) заголовок и совет локализованы ru/en
- [x] #3 Ошибка не роняет сессию: AI Studio (чат остаётся, есть повтор), слот Swarm (failed с причиной, остальные слоты работают), ревьюер Arena, complete(); ошибка внутри SSE-потока не теряется; ключ и Authorization не попадают в сообщения и логи
- [x] #4 Снимок ошибки (вид, статус, код, retry-after, признак retryable) в слоте Swarm, ревьюере Arena и экспорте Markdown/JSON — для решения о fallback в TASK-79
- [x] #5 ADR decision-43; живая проверка через настоящие сервисы (Ollama: несуществующая модель, выключенный порт; fan-out с одним сломанным слотом); скриншот собранного exe; lint/test/check-bundle зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-43, 2026-09-19)
- `electron/services/providerErrors.ts` — чистый классификатор: `classifyHttpError` (статус + тело + `Retry-After`), `classifyStreamError` (ошибка внутри SSE при 200), `classifyNetworkError` (`cause.code` fetch, AggregateError localhost, TimeoutError, `terminated`), `providerConfigError`, `timeoutError`, `toProviderErrorInfo`. Виды: auth, quota, model_not_found, rate_limit, unavailable, bad_request, config, unknown + причина (`tools|reasoning|context|unsupported|moderation`, `refused|dns|timeout|tls|network|server|overloaded`, `forbidden`, `endpoint|no_model|no_key|no_profile|provider`). Снимок `ProviderErrorInfo` сериализуем: статус, код, `retryable`, `retryAfterMs`, провайдер, profileId, адрес без логина/пароля/query, модель, local, усилие, ответ сервера ≤ 500 символов, сообщение. Ключи вырезаются (значения заголовков авторизации, ключ Anthropic, шаблоны `Bearer`/`sk-…`).
- `aiAgentService`: `fetchProvider` в потоковом и одноразовом пути, OpenAI-совместимом и Anthropic; ошибки внутри потока больше не теряются (раньше глотались вместе с ошибками разбора чанков); обрыв чтения — сетевая ошибка; таймаут `complete()` — `unavailable/timeout`, внешняя отмена остаётся отменой. `streamChat(…, onError(message, info?))` — второй аргумент необязательный, прежние вызовы не менялись (impact GitNexus: 4 прямых вызывающих, CRITICAL). `reasoningErrorHint` удалён — его заменила причина `reasoning` (совет только если усилие ушло в тело).
- Ошибки настройки — `providerConfigError` с прежним текстом: slotProvider (профиль не найден/неоднозначен, чужой прежний провайдер), llmProfileService, «Модель не выбрана», нет ключа OpenRouter/DeepSeek/Anthropic, запасной API-путь CLI. Каталог моделей: «fetch failed» → «сервер не принимает подключения (ECONNREFUSED)» с советом; заголовки профиля собираются внутри try (профиль без ключа — ошибка каталога, а не исключение).
- AI Studio: IPC `ai:error:<id>` передаёт снимок вторым аргументом; ответ получает `error`/`providerError`, текст ошибки больше не дописывается в `content` (раньше уходил модели как её ответ). `ProviderErrorCard`: локализованные заголовок и совет, «Подробнее» (провайдер, модель, адрес, код, ответ сервера), «Повторить» (`retryFailedMessage`: убирает пару вопрос/упавший ответ и отправляет вопрос с текущими настройками). `messagesForModel` не отправляет пустой упавший ответ.
- Swarm: `AgentSlotState.providerError`, строка в логе агента с кратким видом, полоса ошибки на карточке агента, вывод упавшего агента — полный текст ошибки вместо «Ожидание старта». Ревьюер Arena — `review.providerError`. Экспорт Markdown: «Вид ошибки: `model_not_found (HTTP 404, код not_found_error, повтор без изменения настроек не поможет)`», «Ревьюер недоступен: …»; JSON — `providerError` целиком. Remote Control: `errorKind` в событии `ai:error`.
- i18n: секция `providerErrors` в ru/en (виды, причины, советы, подписи), чистые функции renderer — `src/lib/providerErrorView.ts`.

## Живая проверка, 2026-09-19
- curl: Ollama 0.34.0 и 0.31.2 — несуществующая модель 404 `not_found_error` (одинаково), tools/thinking/xhigh/эмбеддинг-модель — 400, адрес без /v1 — 404 «404 page not found»; длинный контекст (≈180 тыс. токенов) Ollama не отвергает, а обрезает (200, prompt_tokens 2050) — ошибку контекста не воспроизвести. 401 без ключа и с неверным ключом: OpenRouter, OpenAI, DeepSeek (текст «Authentication Fails (governor)»), Groq, Mistral (`detail`), Anthropic. Node 22 fetch: ECONNREFUSED, AggregateError для localhost, ENOTFOUND, DEPTH_ZERO_SELF_SIGNED_CERT, UND_ERR_CONNECT_TIMEOUT. Реальные тела — `tests/unit/fixtures/provider-errors.json` (source=live).
- Временный тест через настоящие `aiAgentService`/`llmProfileService`/`llmModelCatalogService`/`AgentFleetService` (удалён, вывод сохранён): несуществующая модель у Ollama 0.34 и 0.31.2 → model_not_found с советом `ollama pull`; повтор после исправления модели → «Париж»; выключенный порт → unavailable/refused (ECONNREFUSED, retryable, «Запустите локальный сервер»); qwen2.5 + усилие high → bad_request/reasoning; bge-m3 → bad_request/unsupported; OpenRouter с неверным ключом → auth 401 «User not found.», Anthropic с неверным ключом → auth 401 `authentication_error`, ключей нет ни в сообщениях, ни в снимке, ни в console.warn; `complete()` → model_not_found и refused; каталог выключенного порта — причина без «fetch failed»; fan-out из двух слотов — сломанный failed с `providerError.kind = model_not_found`, второй completed «Париж», вид ошибки в Markdown и JSON.
- Скриншоты собранного exe (копия userData без models/Cache/Crashpad/Code Cache/GPUCache/Dawn*, без computer-use*.json, remote-control.json, audit/, hitl/, logs/; временный HOME с профилем Ollama и ai-config на несуществующую модель; копии и junction удалены): AI Studio в Chat — карточка «Model not found · Ollama» / «Модель не найдена · Ollama» с советом и «Подробнее», смена модели на qwen2.5 и «Повторить» → «Париж», карточки ошибки больше нет; Swarm Arena — сессия, записанная настоящим прогоном в копию userData: у сломанного слота бейдж «Ошибка» и полоса «Агент остановлен: Модель не найдена» с советом, второй слот «Париж». По скриншотам исправлено: команды в `…` рендерятся как код, вывод упавшего агента — текст ошибки вместо «Ожидание старта»; совет при 401 различает профиль и прежний провайдер/Anthropic.

## Не проверено
Облачных ключей нет: 429, 402, 5xx, отказ по контексту, модерация и ошибка посреди потока облачных сервисов — фикстуры по документации (source=docs), вживую не воспроизводятся. Fallback не делался (TASK-79).

## Проверки
- Unit: `providerErrors.test.ts` (65: 39 фикстур HTTP — 18 live, 21 docs, 3 потоковые, сеть, редактирование ключей, retry-after), `providerErrorView.test.ts` (7), дополнения `agentFleetPersistence.test.ts` (fan-out: сломанный слот + профиль не найден, экспорт), `llmProfileService.test.ts` (каталог: 503 и ECONNREFUSED), `reasoningEffort.test.ts` (тест `reasoningErrorHint` перенесён в классификатор).
- Полный `npm test`: 111/111 файлов, 1311/1311; сирот нет (14 node-процессов до и после). ESLint 0 ошибок, 499 предупреждений (baseline). check-bundle ✅. lint:docs, index-docs, check-index — ок, `search_docs` находит decision-43.
- `pack:win` 2 раза (build зелёный), последний exe 09:47:40, app.asar 09:47:39.
- GitNexus: индекс перестроен `analyze --force` (инкрементальный упал на FTS-расширении), CLAUDE.md/AGENTS.md откатаны, `.claude/skills/gitnexus` удалён.
<!-- SECTION:NOTES:END -->
