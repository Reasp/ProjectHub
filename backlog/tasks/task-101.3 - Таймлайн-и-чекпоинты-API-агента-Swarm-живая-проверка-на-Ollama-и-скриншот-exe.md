---
id: TASK-101.3
title: 'Таймлайн и чекпоинты API-агента Swarm, живая проверка на Ollama и скриншот exe'
status: Review
assignee: []
created_date: '2026-09-19 12:30'
updated_date: '2026-09-19 13:00'
labels:
  - swarm
  - hitl
dependencies: []
parent_task_id: TASK-101
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-46 п. 8. toolsExecuted больше не false, usage хода, чекпоинт turn дожидается tool-loop. Живой прогон AgentFleetService на qwen2.5:7b-instruct во временном репозитории, HITL записи через MCP, скриншот таймлайна в собранном exe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В таймлайне API-агента длительности и статусы инструментов, usage и чекпоинты ходов
- [x] #2 Живой прогон на Ollama: чтение и запись файла в worktree, запрос записи в Центре решений и аудите с origin swarm
- [x] #3 Скриншот таймлайна в собранном exe
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-46 п. 8.
- `run_start` API больше без `toolsExecuted:false`; usage хода (`scope: turn`) по `step_usage`; снимок `turn` возвращается промисом в `onToolBoundary` — tool-loop ждёт его до следующего запроса.
- Найдено вживую и исправлено: два `write_file` одного шага получали оба решения HITL на второй вызов. Событие `hitl` теперь несёт `toolId` исполняемого вызова (`apiToolsInFlight`), таймлайн привязывает сначала по нему.
- Подсказка `notExecutedHint` (ru/en) теперь про старые трассы.
- Живые прогоны (временный тест, удалён): qwen2.5:7b-instruct — read (auto, 4 мс) → write (MCP, 499 мс), файл верный, 5 с; ornith:35b (192.168.1.11) — 3 хода, 93 с, файл верный. Аудит: origin swarm, agentId, role, decidedBy mcp, outcome executed. Адрес удалённой Ollama для прежнего провайдера берётся из AI Studio, не из слота.
- Скриншот собранного exe (копия userData, временный HOME, projectPath переписан на F:\ProjectHub): вкладка «Таймлайн» сессии ornith — scratchpad `shots/03-timeline-ornith.png`.
<!-- SECTION:NOTES:END -->
