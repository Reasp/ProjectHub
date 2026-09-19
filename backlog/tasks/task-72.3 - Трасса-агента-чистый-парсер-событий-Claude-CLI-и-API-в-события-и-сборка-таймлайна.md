---
id: TASK-72.3
title: >-
  Трасса агента: чистый парсер событий Claude CLI и API в события и сборка
  таймлайна
status: Review
assignee: []
created_date: '2026-09-19 11:12'
updated_date: '2026-09-19 11:44'
labels:
  - swarm
  - observability
dependencies: []
parent_task_id: TASK-72
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-45 п. 3, 6, 7. Модуль `agentTrace.ts`: события v1, парсер stream-json Claude CLI (склейка по message.id, timestamp, длительность tool_use→tool_result), чанки step/toolResult в streamChat, HITL и переключения модели, сборка таймлайна (ходы, инструменты, стоимость). Запись `<agentId>.trace.jsonl` в SwarmSessionStore. Исправление двойного учёта usage по message.id.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Парсер на фикстуре реального stream-json 2.1.275 даёт ходы, инструменты с длительностью, статусом и размером вывода, usage хода
- [x] #2 Трасса пишется в файл, переживает перезапуск и удаляется вместе с сессией
- [x] #3 Usage одного сообщения Claude CLI учитывается в бюджете один раз
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-45 п. 3, 6, 7.
- Сняты вживую (Claude CLI 2.1.275, haiku, Read+Write): `timestamp` есть у `assistant`/`user`, нет у `system`/`result`/`rate_limit_event`; одно сообщение = несколько `assistant` с общим `message.id` и одинаковым usage; `output_tokens` там частичный (1–4 против 439 в `result`); длительность инструмента = `user.timestamp − assistant(tool_use).timestamp`. Фикстура `tests/unit/fixtures/claude-cli-stream-2.1.275-tools.jsonl` (пути обезличены).
- `agentTraceTypes.ts` (типы, формат v1), `agentTrace.ts` (чистый): `consumeClaudeCliEvent` (ход = message.id, граница хода — старт запуска или последний tool_result, субагенты игнорируются, `turnCompleted` для чекпоинта), `consumeApiChunk`, `buildAgentTimeline` (ходы, инструменты, HITL, переключения, чекпоинты, откаты, стоимость; `active:false` закрывает оборванные запуски), `parseTraceJsonl`, `buildTraceExport`, `describeCheckpointPoint`.
- API: `StreamChatOptions.onToolBoundary` (шаг и результат инструмента с длительностью) — отдельный колбэк, а не чанк, чтобы не утекать в AI Studio/Remote Control. Факт: API-агент Swarm вызывает streamChat без `executeTool`, инструменты не исполняет — в трассе `toolsExecuted:false`, вызовы «не исполнены».
- HITL: одна подписка на процесс (шина `hitl:*` + локальное `hitlService` `autoDecided`), приёмник по `sessionId` агента; заголовки через `redactSecrets`.
- Хранилище: `<agentId>.trace.jsonl` рядом с транскриптом, очередь, ротация 5 МБ, удаляется вместе с каталогом сессии.
- Исправлено: usage Claude CLI `add` один раз на message.id (бюджет не завышается), лимит ходов роли считает сообщения; `continueAgent` ставит базу usage (живой прогон показал затирание стоимости первого запуска).
- Тесты: `agentTrace.test.ts` (14), фейковый claude.cmd с фикстурой в `agentCheckpointsFleet.test.ts` (3 add + 1 replace, 85/60 мс, чекпоинт хода 2).
<!-- SECTION:NOTES:END -->
