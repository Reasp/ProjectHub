---
id: decision-41
title: "Усилие рассуждений: единая шкала и трансляция в формат провайдера"
date: "2026-09-18 23:30"
status: accepted
---
## Context

[[decision-26]] п. 2 требует универсальный параметр усилия рассуждений `none|low|medium|high|max` для сессии и
слота. Адаптер провайдера переводит его в формат API или игнорирует. До TASK-70.3 такого параметра не было:

- в OpenAI-совместимом пути `buildOpenAICompatibleChatBody` ([[decision-38]]) флаг профиля `compat.reasoning`
  ([[decision-39]]) принимался, но не использовался. Поток разбирал только `delta.reasoning_content` (DeepSeek);
- в Anthropic-пути рассуждения включал только `thinkingBudget` ([[decision-33]]). Для adaptive-моделей бюджет не
  применяется, и выбрать глубину рассуждений было нечем. Это отмечено в decision-33 как долг;
- Claude CLI (AI Studio без ключа, слоты `claude-cli`) запускался без параметра усилия.

Факты, проверенные при реализации (2026-09-18):

- **Ollama через `/v1`** (0.34.0 локально, 0.31.2 на `ornith:35b` с thinking). Поле `think` в `/v1/chat/completions`
  молча игнорируется: с `think: false` модель рассуждает. `reasoning_effort` и `reasoning: {effort}` сервер читает:
  допустимы `none|low|medium|high|max`, а на `xhigh` приходит 400 `invalid reasoning value`. `none` выключает
  рассуждения. Модель без thinking (`qwen2.5:7b-instruct`) на любой уровень, кроме `none`, отвечает 400
  `does not support thinking`. Рассуждения в потоке приходят в `delta.reasoning`, в непотоковом ответе —
  в `message.reasoning`.
- **OpenAI** (тип `ReasoningEffort` официального SDK openai-node): `none|minimal|low|medium|high|xhigh|max`,
  «не все модели поддерживают все значения». Вживую не проверено: ключа нет.
- **OpenRouter** (документация Reasoning Tokens): `reasoning.effort` принимает `max|xhigh|high|medium|low|minimal|none`,
  неподдерживаемый моделью уровень сервис сам округляет до ближайшего, `none` выключает рассуждения. Текст
  рассуждений приходит в `delta.reasoning` и `reasoning_details`. Вживую не проверено: ключа нет.
- **Anthropic** (скилл claude-api, сентябрь 2026). Усилие задаётся полем `output_config.effort`
  (`low|medium|high|xhigh|max`, по умолчанию `high`). Какие уровни принимает модель, Models API публикует в
  `capabilities.effort.{low…max}.supported`. На Haiku 4.5 и Sonnet 4.5 параметра нет. `thinking: {type: "disabled"}`
  на Fable 5.x даёт 400, на Opus 5 разрешён только при effort ≤ `high` и ломает tool use: вызов инструмента может
  оказаться в тексте ответа. Признака «рассуждения можно выключить» в Models API нет.
- **Claude CLI** 2.1.275: флаг `--effort <level>` с уровнями `low|medium|high|xhigh|max`. Уровня `none` нет.

Рассмотренные варианты:

1. **Молча понижать уровень до поддерживаемого** (`max` → `high` для `reasoning_effort`). Отвергнуто: OpenAI
   и Ollama уже принимают `max`, а понижение скрыло бы выбор пользователя. Если модель уровень не принимает,
   пользователь видит ответ сервера и подсказку, как это исправить.
2. **Шестой уровень `xhigh`** (Anthropic, OpenAI, Claude CLI). Отложено: шкала decision-26 общая для всех
   провайдеров, а Ollama на `xhigh` отвечает 400. Если понадобится, уровень добавляется в `REASONING_EFFORTS`
   и в трансляцию.
3. **Для Anthropic переводить `none` в `thinking: {type: "disabled"}`.** Отвергнуто: без признака в Models API
   это 400 на Fable и скрытая поломка tool use на Opus 5. Для экономии рекомендуется `low`.
4. **Переводить усилие в `thinkingBudget` для всех моделей Anthropic.** Отвергнуто: на adaptive-моделях бюджет
   не применяется. Перевод в бюджет используется только там, где кроме `enabled` ничего нет.
5. **Усилие в роли (frontmatter).** Отложено. Роль описывает, кто работает (промпт, права, модель), а усилие —
   параметр конкретного запуска. Слот и сессия его уже задают. Поле роли можно добавить без изменения формата
   трансляции.

## Decision

1. **Шкала** — `ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max'` в чистом модуле
   `electron/services/reasoningEffort.ts`. Поле `AIProviderConfig.reasoningEffort` (сессия AI Studio) и
   `providerConfig.reasoningEffort` слота (`Partial<AIProviderConfig>`, [[decision-40]]). **Отсутствие значения —
   дефолт: ProjectHub ничего не отправляет**, глубину выбирает модель ([[decision-26]] п. 0). `none` означает
   явное «без рассуждений», это не то же самое, что «по умолчанию».
2. **OpenAI-совместимые серверы** — по флагу профиля `compat.reasoning`, значение уходит как есть:
   - `reasoning_effort` → `reasoning_effort: "<уровень>"` (включая `none` и `max`);
   - `reasoning_object` → `reasoning: { effort: "<уровень>" }`;
   - `ollama_think` → `reasoning_effort: "<уровень>"`. Проверено вживую: Ollama `/v1` читает это поле, а `think`
     игнорирует. Имя стиля сохранено ради совместимости с сохранёнными профилями и на случай нативного API Ollama;
   - `none` → поле не отправляется, в лог пишется пояснение.
   Если сервер ответил 400 и в тексте есть признак reasoning/thinking, ошибка дополняется подсказкой: выбрать
   другой уровень или «по умолчанию модели», либо поменять флаг профиля.
3. **Пресеты и прежние провайдеры**: пресет Ollama и прежний провайдер `ollama` получают `ollama_think`, прежний
   `openrouter` — `reasoning_object`, как пресет OpenRouter. Сохранённые профили не мигрируются: флаг меняется в
   редакторе профиля. Без выбранного усилия запросы не меняются.
4. **Anthropic** (`buildAnthropicMessagesBody`), если усилие задано, оно заменяет `thinkingBudget`
   (при конфликте пишется note):
   - `low…max`, модель поддерживает adaptive → `thinking: {type: "adaptive", display: "summarized"}` и
     `output_config.effort`, если уровень есть в `capabilities.effort`. Если уровня нет, берётся ближайший
     поддерживаемый уровень ниже с note. Если параметра нет совсем — только thinking с note;
   - модель поддерживает только `enabled` → `budget_tokens` по уровню: low 2048, medium 8192, high 16 384,
     max 32 768, в пределах `max_tokens − 1` (правила decision-33);
   - возможности неизвестны или рассуждений нет — ничего не отправляется, пишется note;
   - `none` → ни thinking, ни effort (режим модели по умолчанию) с note.
   Без усилия поведение `thinkingBudget` по decision-33 не меняется.
5. **Claude CLI**: `low…max` → `--effort <уровень>` в AI Studio (`claudeBridgeService`) и в слотах `claude-cli`
   (`buildEngineInvocation`). `none` не передаётся, UI предупреждает об этом. У Codex CLI и Gemini CLI
   усилие не передаётся: флаги в этой задаче не проверялись, придумывать их нельзя.
6. **Поток рассуждений**: разбор дельты — чистая функция `extractReasoningDelta`. Источники по порядку:
   `reasoning_content` (DeepSeek, vLLM), затем `reasoning` строкой (Ollama, OpenRouter), затем текст
   `reasoning_details[]`, если строки нет (без двойного показа). Результат идёт в `thought`.
7. **Слот**: своё усилие важнее унаследованного. Слот «как в AI Studio» и слот только с моделью наследуют
   усилие AI Studio. Слот с профилем или прежним провайдером Ollama получает только своё усилие, без него —
   дефолт модели. UI: выбор в настройках AI Studio (для всех провайдеров, с подсказкой по стилю и CLI) и в
   слоте Swarm (API и `claude-cli`).
8. **`complete()`** (служебные одноразовые запросы) усилие не отправляет: ответ нужен коротким, и дефолт модели
   для него подходит.

## Consequences

- Один параметр работает для профилей, прежних провайдеров, Anthropic API и Claude CLI. По умолчанию запросы
  байт в байт такие же, как раньше.
- Рассуждения локальных моделей Ollama (`delta.reasoning`) и OpenRouter теперь видны в AI Studio как thought,
  раньше они терялись.
- Минус: неподдерживаемый моделью уровень на OpenAI-совместимых серверах даёт 400 от сервера, хоть и с
  подсказкой. Возможности модели эти серверы не публикуют, в отличие от Models API Anthropic.
- Минус: для Anthropic «без рассуждений» не выключает thinking на моделях, где он включён по умолчанию
  (Opus 5, Sonnet 5, Fable).
- Долг: живая проверка OpenAI, OpenRouter и Anthropic API не выполнена, облачных ключей нет. Проверены Ollama
  0.34/0.31 и Claude CLI. Усилие в роли и Codex/Gemini CLI — отдельные задачи по запросу.
- `thinkingBudget` остаётся для совместимости со старыми конфигами. Слайдер показывается, только пока усилие
  не выбрано.
- Реализация и тесты: TASK-70.3 (`tests/unit/reasoningEffort.test.ts`, `reasoningEffortUi.test.ts`, дополнения
  `anthropicRequest.test.ts`, `slotProvider.test.ts`, `roleEngineAdapter.test.ts`, `providerSelect.test.ts`).
