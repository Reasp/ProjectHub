---
id: decision-38
title: "OpenAI-совместимый путь: тело запроса без вендорских дефолтов, temperature и max_tokens только явно"
date: "2026-09-18 20:04"
status: accepted
---
## Context

`aiAgentService.requestOpenAICompatible` (потоковый tool-loop для OpenRouter, DeepSeek, Ollama и custom)
собирал тело Chat Completions прямо в коде с тремя дефектами:

- `model: req.config.model || 'deepseek/deepseek-chat'`. Если модель не выбрана, запрос молча уходил в
  модель конкретного вендора, а это противоречит [[decision-26]] п. 0;
- `temperature: req.config.temperature ?? 0.7` подставлялась в каждый запрос, хотя пользователь её не задавал;
- `AIStreamRequest.maxTokens`, появившийся в TASK-88, этим путём игнорировался.

Для Anthropic то же самое исправлено в [[decision-33]] чистым модулем `anthropicRequest.ts`. Там же
`AISettingsModal.handleProviderChange` при смене провайдера записывал в выбранную модель первую подсказку
каталога `MODEL_PRESETS`.

Рассмотренные варианты для `max_tokens`:

1. **Всегда отправлять потолок по умолчанию**, как `DEFAULT_STREAM_MAX_TOKENS` в Anthropic-пути. Отвергнуто.
   Messages API требует `max_tokens`, а Chat Completions — нет. Потолок моделей OpenAI-совместимых
   провайдеров до каталога TASK-70 неизвестен, и завышенное значение даёт 400 на моделях с меньшим пределом.
2. **Отправлять только явно заданное значение.** Выбрано: без значения действует предел провайдера.

Поле названо `max_tokens`, а не `max_completion_tokens`. Его понимают OpenRouter, DeepSeek, Ollama и
большинство совместимых серверов. Для провайдеров, которым нужно второе поле, это будет флаг
совместимости профиля в TASK-70.

## Decision

1. Тело запроса собирает чистая функция `buildOpenAICompatibleChatBody` (`electron/services/openAICompatibleRequest.ts`)
   по образцу `anthropicRequest.ts`.
2. Модель обязательна. Если значение пустое или `default`, функция бросает понятную ошибку
   («Модель не выбрана: укажите идентификатор модели провайдера …»). Вендорского fallback нет.
3. `temperature` уходит только при явном конечном значении, включая 0. `max_tokens` — только при явном
   положительном `AIStreamRequest.maxTokens`.
4. Поля учёта usage не меняются: `stream_options.include_usage` для всех, кроме Ollama, и `usage.include`
   для OpenRouter.
5. `AISettingsModal`: при смене провайдера модель сбрасывается в пустую, `MODEL_PRESETS` остаются подсказками
   datalist. Пустая модель в API-путях даёт ошибку из п. 2, а в Claude CLI-пути означает «без `--model`».

## Consequences

- Запрос больше не уходит молча в DeepSeek, а sampling-параметры по умолчанию определяет модель, а не ProjectHub.
- Пользователь, который сменил провайдера и не выбрал модель, получает ошибку при первом запросе, а не
  случайную модель. Раньше при сохранении без правки поля выбиралась первая подсказка.
- Совместимость с TASK-70: разрешение модели по профилям и каталогу («без выбора — первая доступная
  локальная, затем облачная») происходит до сборки тела, и функция получает уже выбранный id. Флаги
  совместимости профиля (`reasoning_effort`, usage в стриме, `max_completion_tokens`) расширят вход функции
  вместо проверок по имени провайдера.
- Реализация и тесты: TASK-92 (`tests/unit/openAICompatibleRequest.test.ts`).
