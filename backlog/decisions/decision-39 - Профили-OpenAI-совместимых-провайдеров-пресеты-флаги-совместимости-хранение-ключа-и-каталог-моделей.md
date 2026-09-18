---
id: decision-39
title: "Профили OpenAI-совместимых провайдеров: пресеты, флаги совместимости, хранение ключа и каталог моделей"
date: "2026-09-18 20:55"
status: accepted
---
## Context

[[decision-26]] п. 1 требует обобщить провайдер `custom` в OpenAI-совместимый провайдер с профилями.
До TASK-70.1 `aiAgentService` знал пять провайдеров, и различия серверов были зашиты в код по имени:
`provider !== 'ollama'` решал, слать ли `stream_options`, а `provider === 'openrouter'` — слать ли `usage.include`.
Адрес `openrouter`/`deepseek` был захардкожен, `baseUrl` для них игнорировался (`llmEndpoint.ts`).
Один ключ `ai-config.json` на весь провайдер не позволял держать несколько серверов сразу. Слот Swarm с
`providerConfig` без ключа не мог работать ни с одним облачным провайдером, кроме глобально настроенного.

Рассмотренные варианты:

1. **Мигрировать прежние провайдеры в профили автоматически.** Отложено: у пользователей в
   `ai-config.json` лежит `provider: 'openrouter'` с ключом, и молчаливая миграция меняет их конфиг.
   Прежние провайдеры продолжают работать, их поведение описано флагами `legacyProviderCompat`.
2. **Хранить профили в `ai-config.json`.** Отвергнуто: конфиг целиком уходит в renderer (`ai:getConfig`)
   вместе с расшифрованным ключом, а ключи профилей туда попадать не должны.
3. **Отдельный файл профилей, ключ зашифрован, в renderer — только `hasApiKey`.** Выбрано.

## Decision

1. **Профиль** (`electron/services/llmProfiles.ts`) — это `id`, имя, пресет, `baseUrl` (к нему
   добавляются `/chat/completions` и `/models`), признак «локальный», необязательные заголовки и
   флаги совместимости: `tools`, `vision`, `streamUsage`, `openRouterUsage`, `maxTokensField`
   (`max_tokens` | `max_completion_tokens`), `reasoning` (`none` | `reasoning_effort` |
   `reasoning_object` | `ollama_think`, используется в TASK-70.3), `responseFormat`.
2. **Пресеты** — стартовые значения для 14 серверов: OpenAI, OpenRouter, DeepSeek, Mistral, Groq, xAI,
   Together, Fireworks, Ollama `/v1`, LM Studio, vLLM, llama.cpp server, Jan, Custom. После создания профиль
   редактируется целиком. Модели в пресетах нет ([[decision-26]] п. 0). Флаги консервативны: `streamUsage`
   включён только там, где поддержка известна. `vision` выключен везде, потому что зависит от модели, а не
   от сервиса. Флаги облачных пресетов взяты из документации и вживую не проверялись.
3. **Хранение**: `~/.projecthub/llm-profiles.json` рядом с `ai-config.json`, под той же изоляцией тестов
   ([[decision-29]]). Ключ шифруется `secretStorageService`, запись атомарная и по очереди. Испорченный
   профиль пропускается, а не ломает остальные. В renderer IPC отдаёт профиль без ключа, с `hasApiKey`.
   Ключ при сохранении: `undefined` — оставить, пустая строка — удалить. Заголовок `Authorization` в
   произвольных заголовках запрещён, как и перевод строки в значениях.
4. **Провайдер `openai-compatible` + `profileId`** в `AIProviderConfig`. `aiAgentService` получает адрес,
   заголовки и флаги через `resolveOpenAICompatibleTarget`: профиль или прежний провайдер. Потоковый путь и
   `complete` используют одно и то же. `buildOpenAICompatibleChatBody` ([[decision-38]]) принимает флаги
   вместо имени провайдера. `tools` не отправляются профилю без флага `tools`, изображения из результатов
   инструментов — только при `vision`.
5. **Каталог моделей** (`llmModelCatalog.ts`, `llmModelCatalogService.ts`): `GET {baseUrl}/models`
   (OpenAI-формат, на всякий случай и нативный формат Ollama), кэш в `~/.projecthub/llm-model-catalog.json`
   с TTL 24 ч по паре «профиль + адрес», ручное обновление. Ошибка сервера не стирает прежний список:
   он возвращается вместе с причиной. Каталог — подсказки поля модели, ручной ввод id сохраняется.

## Consequences

- Можно держать несколько серверов сразу, в том числе локальные без ключа. Различия серверов теперь данные
  профиля, а не ветки в коде.
- Прежние провайдеры в UI остаются рядом с новым, это временно. Миграция и удаление прежних веток — отдельный шаг.
  Ручной перенос в профиль и профиль в слотах Swarm, ролях и Arena — [[decision-40]].
- Не сделано в TASK-70.1/70.2 и вынесено в подзадачи TASK-70: усилие рассуждений по флагу `reasoning`,
  цены локальных моделей по признаку `local`, профиль в ролях и слотах Swarm, группировка по профилям в
  `ModelSelectorDropdown` AI Studio, живая проверка облачного профиля.
- Реализация и тесты: TASK-70.1, TASK-70.2 (`tests/unit/llmProfiles.test.ts`, `tests/unit/llmProfileService.test.ts`,
  `tests/unit/openAICompatibleRequest.test.ts`).
