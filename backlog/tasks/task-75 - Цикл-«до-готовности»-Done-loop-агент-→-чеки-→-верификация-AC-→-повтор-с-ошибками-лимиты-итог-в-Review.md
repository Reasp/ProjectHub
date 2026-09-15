---
id: TASK-75
title: >-
  Цикл «до готовности» (Done-loop): агент → чеки → верификация AC → повтор с
  ошибками, лимиты, итог в Review
status: To Do
assignee: []
created_date: '2026-09-15 03:11'
labels:
  - swarm
  - arena
  - quality
  - agent-loop
  - backlog
milestone: m-0
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Главное отличие лучшего harness от «обёртки над CLI» — замкнутый контур проверки: агент не считается закончившим, пока объективные проверки и критерии приёмки не выполнены. Сейчас в ProjectHub чеки (`arenaChecks`: lint/test/build в worktree) и судья запускаются один раз после Arena (decision-20), а AC задачи агент отмечает сам, без верификации. Задача добавляет режим одиночного слота «до готовности» (engine-agnostic: Claude CLI, Codex, API), см. doc-10.

## Контур
1. Запуск роли (по умолчанию `implementer`) в worktree задачи с контекстом (`contextBuilder`) и явным списком AC.
2. По завершении хода агента: авто-коммит (decision-8), запуск чеков из `.projecthub.json`/`defaultChecksFromProject` (lint, test, build, опционально `lint:docs`, `check-index`), сбор хвостов ошибок (`tailOutput`).
3. Верификация AC: агент возвращает структурированный отчёт (JSON-схема: `acId`, `status`, `evidence`); ProjectHub сверяет с файлом задачи и не даёт отметить AC без evidence; чек-лист задачи обновляется только ProjectHub'ом.
4. Если чеки упали или AC не закрыты — повторный ход с хвостом ошибок и списком незакрытых AC в той же сессии (Claude — `--resume`, Codex — тот же thread, API — та же история), пока не достигнут лимит итераций (по умолчанию 5) или бюджет слота.
5. Итог: задача → `Review` с `finalSummary` (что сделано, какие AC закрыты, результаты чеков, стоимость, число итераций), уведомление `agentFinished`; при исчерпании лимита — уведомление `agentFailed` с причиной. `Done` автоматически не выставляется (правило 5).

## Что сделать
- `electron/services/doneLoop.ts` (чистая машина состояний `run → check → verify → retry | finish`, лимиты, unit-тесты) + `doneLoopService.ts` (оркестрация поверх `agentFleetService`, `arenaChecks`, записи в Backlog).
- Схема отчёта агента и промпт-инструкция в `contextBuilder` (единая для всех движков; для API — `response_format`, для CLI — JSON-блок в финальном сообщении с валидацией zod).
- UI: кнопка «Выполнить до готовности» в `TaskDetailModal`/`NewSwarmModal` (режим `done_loop` рядом с `fan_out`/`handoff`), прогресс итераций и результаты чеков в Arena-панели.
- Настройки: лимит итераций, бюджет, набор чеков, автоперевод в Review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Режим done_loop запускается из карточки задачи и NewSwarmModal для любого движка (claude-cli, codex-cli, api)
- [ ] #2 После каждого хода автоматически выполняются чеки из конфига проекта; хвосты ошибок и незакрытые AC передаются в следующий ход той же сессии
- [ ] #3 AC задачи отмечаются только ProjectHub'ом по структурированному отчёту агента с evidence; отчёт валидируется схемой (unit-тесты парсера)
- [ ] #4 Машина состояний цикла — чистый модуль с тестами на лимит итераций, бюджет, успех с первой попытки, остановку человеком
- [ ] #5 При успехе задача переводится в Review с finalSummary (AC, чеки, стоимость, итерации); при неудаче — уведомление agentFailed с причиной; Done автоматически не выставляется
- [ ] #6 Прогресс итераций и результаты чеков видны в UI; i18n ru/en
- [ ] #7 ADR о контуре «до готовности» и правиле «AC отмечает только harness»; lint/test зелёные, pack:win собран
<!-- AC:END -->
