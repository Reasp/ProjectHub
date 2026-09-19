---
id: TASK-101
title: 'API-агент Swarm исполняет инструменты через tool-loop и HITL, как в AI Studio'
status: To Do
assignee: []
created_date: '2026-09-19 11:47'
labels:
  - swarm
  - hitl
  - providers
dependencies: []
references:
  - >-
    backlog/decisions/decision-45 -
    Чекпоинты-ходов-агента-в-worktree-откат-таймлайн-инструментов-и-трасса-JSONL.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Долг из decision-45 (TASK-72). `agentFleetService.runApiAgent` вызывает `aiAgentService.streamChat` без `executeTool`: модель получает описания инструментов, но Swarm их не исполняет — вызов пишется в лог, в таймлайне он «не исполнен». Tool-loop с исполнением есть только в AI Studio (`claudeBridgeService.executeApiTool`, TASK-82). Нужно дать API-слотам Swarm исполнитель с единым HITL-контуром (decision-10: права роли, аудит, `workspaceRoot` = worktree слота) и лимитом шагов; границы шага и результата инструмента для трассы уже есть (`StreamChatOptions.onToolBoundary`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 API-слот Swarm исполняет инструменты в своём worktree, результаты возвращаются модели
- [ ] #2 Каждый вызов проходит HITL с правами роли и попадает в аудит
- [ ] #3 В таймлайне у API-агента есть длительности и статусы инструментов, чекпоинты по ходам
<!-- AC:END -->
