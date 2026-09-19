---
id: TASK-79.3
title: >-
  Fallback слота по providerError в agentFleetService: API-слоты и Claude CLI,
  лог и уведомление
status: Done
assignee: []
created_date: '2026-09-19 06:18'
updated_date: '2026-09-19 07:57'
labels:
  - ai
  - routing
  - errors
milestone: m-0
dependencies:
  - TASK-79.2
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
modified_files:
  - electron/services/agentFleetService.ts
  - electron/services/providerErrors.ts
  - electron/services/hitlTypes.ts
  - electron/services/notificationTypes.ts
  - electron/services/notificationRules.ts
  - src/components/notifications/NotificationSettingsModal.tsx
  - src/types/electron.d.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/modelFallback.test.ts
parent_task_id: TASK-79
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-44 п. 6–7. Цикл переключения в `runSingleAgent` для API и Claude CLI: правила decision-43 §8, лимит 2, ожидание retryAfterMs с прерыванием, только до первого вызова инструмента. Классификация API-ошибок Claude CLI из stream-json (`assistant.error`, `result.api_error_status`, `rate_limit_event`). Событие шины `agent:modelFallback` и тип уведомления `modelFallback`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Переключение только по виду ошибки decision-43 §8, не больше 2 раз, ожидание retryAfterMs; auth/config/bad_request кроме context не переключают
- [x] #2 Claude CLI с API-ошибкой — failed с providerError, а не completed
- [x] #3 Лог агента, событие шины и уведомление modelFallback
- [x] #4 Unit-тесты на фикстурах provider-errors.json и локальном HTTP-сервере с 429 Retry-After; живая проверка цепочки на Ollama и 401 Anthropic
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-44 п. 6–7.
- Цикл в `runSingleAgent` → `runEngineTurn` (один проход) + `tryModelFallback` (`decideFallback`): ожидание `retryAfterMs` ≤ `maxWaitMs` с прерыванием остановкой, лимит ≤ 2 за ход, переключение только до первого вызова инструмента (`toolActivity`), вывод упавшего звена стирается (остаётся в транскрипте). Исчерпание — ошибка слота с «Цепочка моделей: …». Номер звена липкий между ходами цикла «до готовности».
- Claude CLI: `parseClaudeCliErrorEvent` + `classifyClaudeCliError` (providerErrors.ts): `assistant.error`/`is_api_error_message`, `result.is_error` + `api_error_status`, `rate_limit_event` rejected → `retryAfterMs`. Раньше ход с несуществующей моделью был `completed` с текстом ошибки в выводе; теперь `failed` с `providerError` (исправление, вживую).
- Шина `agent:modelFallback`, уведомление `modelFallback` (трей, ОС, Remote Control), строка настройки уведомлений ru/en.
- Codex/Gemini: не классифицируются (схема не проверена, CLI не установлены) — decision-44 п. 7.
- Тесты `modelFallback.test.ts` (10): цепочка, лимит, auth без переключения, явная модель + спуск в младший тир, без тира, ожидание Retry-After; настоящий `aiAgentService.streamChat` против локального HTTP-сервера с 429 `Retry-After: 1`; фейковый `claude.cmd` в PATH (события 2.1.275) — failed без тира и перезапуск с `--model` по тиру.
- Живая проверка (временный тест, удалён): Ollama `no-such-model:1b` (404) → профиль `Dead` на порту 11999 (ECONNREFUSED) → `qwen2.5:7b-instruct` «Париж» за 2 переключения, 2 события шины; 4 звена с тремя неудачами → failed «исчерпан лимит переключений модели (2)»; `ornith:35b` на 192.168.1.11 → «Paris»; Anthropic с неверным ключом → 401 auth без переключения, ключа в тексте нет; настоящий Claude CLI 2.1.275 `no-such-model-xyz` → `haiku` «Париж».
- Не воспроизведено вживую: 429/503 облака (ключей нет) — фикстуры и локальный сервер.
<!-- SECTION:NOTES:END -->
