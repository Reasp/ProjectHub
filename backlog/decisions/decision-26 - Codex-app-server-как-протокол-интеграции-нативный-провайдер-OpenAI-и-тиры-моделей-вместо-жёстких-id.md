---
id: decision-26
title: "Codex app-server как протокол интеграции, нативный провайдер OpenAI и тиры моделей вместо жёстких id"
date: "2026-09-15 02:33"
status: proposed
---
## Context

3–4 сентября 2026 OpenAI выпустила GPT-6 Astra (`gpt-6-astra`) и линейку GPT-5.6 (`gpt-5.6-sol`,
`gpt-5.6-terra`, `gpt-5.6-luna`), сняв с API `gpt-5.4`/`gpt-5.4-mini`. Ключевые факты для
харнесса (см. doc-10): контекст 1,05 млн токенов, выход до 128 тыс., цена $10/$50 за млн
(кэш-чтение $1, наценка ×2/×1,5 при входе более 272 тыс.), уровни `reasoning_effort`
`low|medium|high|xhigh|max`, сильнейший computer use (OSWorld 2.0 — 72,6 %), «context notes»
вместо сжатия контекста, первый «Critical» уровень по киберспособностям и деградировавшая
наблюдаемость цепочки рассуждений — OpenAI прямо рекомендует HITL-гейты и аудит, а не
чтение транскриптов.

Как ProjectHub работает с OpenAI сегодня:

- `aiAgentService` не имеет провайдера `openai`: есть `anthropic`, `openrouter`, `deepseek`,
  `ollama`, `custom`. Модели OpenAI доступны только через OpenRouter или `custom`-эндпоинт, без
  `reasoning_effort`, без учёта кэша и наценок в `agentCost`.
- Движок `codex-cli` запускается как `codex exec --json` ([[decision-4]], TASK-60): нет HITL
  (только `--ask-for-approval on-failure|never`), `ENGINE_CAPABILITIES` для него —
  `tools: false, maxTurns: false`, нет resume, нет выбора усилия рассуждений, схема событий
  JSONL «не документирована» (комментарий в `agentFleetService`).
- С 2026 года Codex перевёл все свои поверхности (CLI, VS Code, web) на **`codex app-server`** —
  долгоживущий процесс с двунаправленным JSON-RPC 2.0 по stdio/WebSocket: `initialize` →
  `thread/start` / `thread/resume` / `thread/fork` → `turn/start` (модель, `effort`, sandbox,
  структурированный вывод, skill inputs) → события `item/*` (started/delta/completed) →
  серверные запросы `execCommandApproval` / `applyPatchApproval`, на которые клиент отвечает
  `accept|decline|cancel`; есть `turn/steer`, `turn/interrupt`, `review/start`, `model/list`
  (каталог с `supportedReasoningEfforts`), `mcpServer/tool/call`, хуки (`PreToolUse`,
  `PermissionRequest`, `PostToolUse`, `Stop`) и субагенты (`.codex/agents/*.toml`).
- Роли ([[decision-9]]) хранят конкретные `model`-id. При смене поколения моделей (август 2026:
  ретайр 5.4) роли молча ломаются, а выбор «дёшево/сбалансированно/фронтир» приходится делать
  руками для каждого движка.

Рассмотренные и отвергнутые альтернативы: оставить `codex exec --json` (нет HITL — нарушает
[[decision-10]]); подключать Astra только через OpenRouter (нет `max` effort, кэш-цены и наценки
не учитываются, зависимость от посредника); OpenAI Agents SDK (Python) как рантайм — тянет Python.

## Decision

1. **Codex подключается через `codex app-server` (JSON-RPC), а не `codex exec`.** Один
   долгоживущий процесс на проект (broker-паттерн), `thread/start` на агента, `turn/start` на
   промпт. Запросы `execCommandApproval` и `applyPatchApproval` маршрутизируются в общую
   HITL-очередь ([[decision-10]]) наравне с `--permission-prompt-tool` Claude; `turn/interrupt`
   — остановка агента; `thread/resume` — восстановление после перезапуска ([[decision-16]]).
   `ENGINE_CAPABILITIES['codex-cli']` получает `tools: true` (через sandbox/`enabled_tools`) и
   `maxTurns: true` (счётчик `turn/completed`).
2. **Добавляется нативный провайдер `openai`** в `aiAgentService` (Chat Completions с
   `reasoning_effort`, каталог `gpt-6-astra` / `gpt-5.6-*`), ключ — через `secretStorageService`.
   Таблица цен `agentCost` дополняется ценами Astra/5.6, кэш-чтением и наценкой за длинный контекст.
3. **Роли и слоты ссылаются на тиры моделей** — `cheap | balanced | frontier` — а не на id.
   Тир резолвится в конкретную модель per-движок/провайдер из редактируемой таблицы
   (`<userData>/model-tiers.json`, по умолчанию: Claude — Haiku 4.5 / Sonnet 5 / Opus 5 или
   Fable 5.1; OpenAI — luna / sol / astra; Gemini — по каталогу). Явный id по-прежнему допустим
   как переопределение. Каталог доступных моделей берётся у движка (`model/list` Codex,
   `claude` — из настроек), а не хардкодится.
4. **Fallback-цепочка**: при 429/недоступности модели слот переключается на следующую модель того
   же тира (или тира ниже) с записью в лог и уведомлением; уже существующий
   `RateLimitWarningBanner` показывает причину.
5. **Политика безопасности для Astra-класса моделей**: автономные прогоны (Automations,
   autostart назначенных задач) выполняются только с sandbox `workspace-write` и HITL-политикой
   роли; `danger-full-access` недоступен для автозапуска. Аудит-лог HITL ([[decision-10]]) —
   обязательный источник правды вместо транскрипта.

## Consequences

- Плюс: Codex становится полноценным движком слота (HITL, resume, effort, структурированный
  вывод, `review/start` для ревью-роли), Astra доступна напрямую с корректным учётом стоимости.
- Плюс: роли переживают смену поколений моделей; маршрутизация «дёшево для рутины, фронтир для
  сложного» становится настройкой, а не правкой файлов ролей.
- Минус: новая реализация JSON-RPC-клиента с таймаутами, переподключением и версионированием
  протокола (app-server меняется; фиксировать минимальную версию `codex` и проверять в
  `initialize`). Пока Codex не оплачен/не установлен на машине разработки — реализация ведётся
  по документации и требует ручного smoke-теста (как TASK-60).
- Минус: `custom`/`openrouter` пути остаются для совместимости — три способа достучаться до
  одних и тех же моделей; таблица тиров должна быть единственным местом выбора по умолчанию.
- Реализация: TASK-70 (провайдер OpenAI), TASK-71 (app-server), TASK-79 (тиры и fallback).
  Статус ADR переводится в `accepted` после TASK-71.
