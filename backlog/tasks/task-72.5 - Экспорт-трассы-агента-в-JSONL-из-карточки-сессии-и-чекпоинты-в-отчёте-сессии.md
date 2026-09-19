---
id: TASK-72.5
title: Экспорт трассы агента в JSONL из карточки сессии и чекпоинты в отчёте сессии
status: Review
assignee: []
created_date: '2026-09-19 11:13'
updated_date: '2026-09-19 11:44'
labels:
  - swarm
  - observability
dependencies:
  - TASK-72.3
parent_task_id: TASK-72
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-45 п. 6. `swarm:exportTrace` с системным диалогом: строка header (format projecthub-agent-trace v1, totals как у JSON-экспорта сессии, сводка агентов), затем события с agentId. Markdown-отчёт сессии — строки о чекпоинтах и откатах.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 JSONL: каждая строка — валидный JSON, первая — header с версией формата и totals как у JSON-экспорта
- [x] #2 Экспорт доступен из карточки агента и из шапки сессии
- [x] #3 Markdown-отчёт показывает число чекпоинтов и откаты агента
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-45 п. 6.
- `agentFleetService.exportTrace(swarmId, agentId?)`, IPC `swarm:exportTrace` с системным диалогом (`*.trace.jsonl`), preload `exportAgentTrace`.
- Первая строка `{type:"header", format:"projecthub-agent-trace", v:1, sessionFormat:"projecthub-swarm-session", sessionVersion:1, totals (как у JSON-экспорта), agents:[id, name, engine, role, model, status, branch, usage, costUsd, durationMs, checkpoints, rewinds, trace]}`, далее события с `agentId`.
- UI: кнопка «Трасса .jsonl» в карточке агента (вкладка «Таймлайн») и «.jsonl» в шапке сессии (все агенты).
- Markdown-отчёт: `checkpointLines` — «Чекпоинты: N (последний #n, …)» и строка на каждый откат; JSON-экспорт включает `checkpoints`/`rewinds`/`trace` агента. Тест в `swarmExport.test.ts`.
- Вживую: трасса сессии из 2 запусков — 33 строки, каждая валидный JSON.
<!-- SECTION:NOTES:END -->
