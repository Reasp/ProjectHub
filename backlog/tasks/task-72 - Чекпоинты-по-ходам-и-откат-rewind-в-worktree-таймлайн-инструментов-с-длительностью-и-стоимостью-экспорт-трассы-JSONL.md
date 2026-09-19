---
id: TASK-72
title: >-
  Чекпоинты по ходам и откат (rewind) в worktree, таймлайн инструментов с
  длительностью и стоимостью, экспорт трассы JSONL
status: Review
assignee: []
created_date: '2026-09-15 03:08'
updated_date: '2026-09-19 11:50'
labels:
  - swarm
  - git
  - observability
  - ui
milestone: m-0
dependencies: []
modified_files:
  - electron/services/checkpointGit.ts
  - electron/services/checkpointService.ts
  - electron/services/agentTrace.ts
  - electron/services/agentTraceTypes.ts
  - electron/services/agentFleetService.ts
  - electron/services/aiAgentService.ts
  - electron/services/hitlService.ts
  - electron/services/swarmSessionStore.ts
  - electron/services/swarmExport.ts
  - electron/services/swarmTypes.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/lib/agentTimelineView.ts
  - src/components/ai/swarm/AgentTimelinePanel.tsx
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/checkpointGit.test.ts
  - tests/unit/agentTrace.test.ts
  - tests/unit/agentCheckpointsFleet.test.ts
  - tests/unit/agentTimelineView.test.ts
  - tests/unit/swarmExport.test.ts
  - tests/unit/fixtures/claude-cli-stream-2.1.275-tools.jsonl
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude Code делает снимок состояния перед каждым изменением и умеет `/rewind`; Codex app-server отдаёт `item/*` с границами каждого инструмента. В ProjectHub есть авто-коммит результата в worktree (decision-8, TASK-55) и логи слота, но нет отката к конкретному ходу и нет таймлайна «что агент делал, сколько это заняло и стоило». Задача добавляет чекпоинты и наблюдаемость на уровне harness, одинаково для всех движков (doc-10).

## Что сделать
1. **Чекпоинты**: после каждого хода агента (событие `assistant`/`turn/completed`/ответ API) — `git add -A && git commit` в worktree с сообщением `checkpoint(turn N)` в служебной ветке слота либо `git stash create`-снимок с ref `refs/projecthub/checkpoints/<slot>/<n>` (не засорять историю); при слиянии победителя чекпоинты схлопываются (squash) — согласовать с `worktreeService`/decision-8.
2. **Rewind**: в Arena/Task — список ходов; «Откатить к ходу N» = `git checkout` снимка в worktree + пометка в сессии; для Claude — новая сессия с контекстом «откатились к ходу N», для Codex — `thread/fork` с ранней точки, если доступно.
3. **Таймлайн**: для каждого хода — вызовы инструментов (имя, аргументы кратко, длительность, статус, размер вывода), токены и стоимость хода (`agentCost`), HITL-решения; источник — `stream-json` Claude (`tool_use`/`tool_result` c таймстампами), события app-server, tool-loop API-движка. Вид: горизонтальная шкала + таблица; фильтр по инструменту.
4. **Экспорт**: трасса сессии в JSONL (совместимо с `swarmExport`), для вложения в задачу/PR.
5. Лимиты хранения: чекпоинты старше N сессий чистятся вместе с worktree (decision-16).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После каждого хода агента в worktree создаётся чекпоинт (служебный ref), не засоряющий историю ветки победителя после слияния
- [x] #2 В UI доступен откат к ходу N с подтверждением (DialogHost); состояние файлов worktree соответствует снимку, сессия помечена
- [x] #3 Таймлайн ходов и инструментов с длительностью, статусом, токенами и стоимостью работает для claude-cli и api (для codex — после app-server)
- [x] #4 Парсер событий в записи таймлайна — чистый модуль с unit-тестами
- [x] #5 Экспорт трассы JSONL из карточки сессии; чистка чекпоинтов вместе с worktree
- [x] #6 ADR о формате чекпоинтов и трассы; i18n; lint/test зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ADR: decision-45 (accepted). Подзадачи 72.1–72.5 — Review. Долги: TASK-101 (API-агент Swarm не исполняет инструменты — в таймлайне «не исполнен»), TASK-102 (продолжение после отката в handoff и done-loop).

Решения (decision-45):
1. Чекпоинт — коммит-объект вне истории ветки: временный индекс (копия индекса worktree) → `add -A` → `write-tree` → `commit-tree -p HEAD`, ref `refs/projecthub/checkpoints/<swarmId>/<agentId>/<n>`. `git stash create` отвергнут: проверено вживую, неотслеживаемые файлы не берёт.
2. Чекпоинты — везде в git, откат — только в worktree слота неактивного и не влитого агента.
3. Ход: Claude CLI — сообщение модели (`message.id`), чекпоинт после результатов всех инструментов хода; API — запрос к модели (шаг); done-loop — запуск = итерация; `start`/`end` на каждый запуск.
4. Откат: снимок `pre_rewind` («отмена отката»), ветка к родителю снимка, файлы — к снимку, фиксация `rewind(<роль>): чекпоинт #n (после хода T)`, новая сессия движка с пояснением.
5. Ref удаляются с сессией и worktree, у проигравших при Pick Winner, осиротевшие при старте; лимит 50 на агента.
6. Трасса JSONL v1 (`<agentId>.trace.jsonl`), экспорт с header, совместимым с JSON-экспортом сессии.

Живые проверки: stream-json Claude CLI 2.1.275 (поля времени, повтор usage, частичный output_tokens); git 2.53 (временный индекс, откат); настоящий Claude CLI haiku через AgentFleetService во временном репозитории. Итог: 4 хода, чекпоинты только у Write, откат к #2 убрал c.txt, продолжение новой сессией, $0.0567. Живой прогон нашёл баг: продолжение затирало стоимость первого запуска. Исправлено базой usage, закреплено тестом.

Исправления попутно: usage Claude CLI в бюджете раньше считался дважды на сообщение (add на каждое событие assistant); лимит ходов роли считал события.

Скриншоты собранного exe (EN/RU): вкладка «Таймлайн», фильтр, подтверждение отката в DialogHost. По ним исправлены шкала, частичный выход, разделители запусков, i18n статуса и единиц.

Проверки: lint 0 ошибок / 499 предупреждений (baseline), 1383 теста, check-bundle, index-docs, lint:docs; pack:win — exe и app.asar 19:47; осиротевших node-процессов нет, в F:\ProjectHub ref чекпоинтов нет.
<!-- SECTION:NOTES:END -->
