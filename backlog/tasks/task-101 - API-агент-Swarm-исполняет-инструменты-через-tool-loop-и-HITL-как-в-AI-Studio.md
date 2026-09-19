---
id: TASK-101
title: 'API-агент Swarm исполняет инструменты через tool-loop и HITL, как в AI Studio'
status: Review
assignee: []
created_date: '2026-09-19 11:47'
updated_date: '2026-09-19 13:00'
labels:
  - swarm
  - hitl
  - providers
dependencies: []
references:
  - >-
    backlog/decisions/decision-45 -
    Чекпоинты-ходов-агента-в-worktree-откат-таймлайн-инструментов-и-трасса-JSONL.md
  - >-
    backlog/decisions/decision-46 -
    Исполнитель-инструментов-API-агента-Swarm-с-HITL-лимит-шагов-и-бюджет-по-шагам.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Долг из decision-45 (TASK-72). `agentFleetService.runApiAgent` вызывает `aiAgentService.streamChat` без `executeTool`: модель получает описания инструментов, но Swarm их не исполняет — вызов пишется в лог, в таймлайне он «не исполнен». Tool-loop с исполнением есть только в AI Studio (`claudeBridgeService.executeApiTool`, TASK-82). Нужно дать API-слотам Swarm исполнитель с единым HITL-контуром (decision-10: права роли, аудит, `workspaceRoot` = worktree слота) и лимитом шагов; границы шага и результата инструмента для трассы уже есть (`StreamChatOptions.onToolBoundary`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 API-слот Swarm исполняет инструменты в своём worktree, результаты возвращаются модели
- [x] #2 Каждый вызов проходит HITL с правами роли и попадает в аудит
- [x] #3 В таймлайне у API-агента есть длительности и статусы инструментов, чекпоинты по ходам
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ADR decision-46. Подзадачи 101.1 (политика и исполнитель), 101.2 (интеграция в runApiAgent, лимиты, бюджет, остановка), 101.3 (трасса, живая проверка, скриншот). Долг — TASK-103 (AI Studio на общий исполнитель).
Проверки: tsc чисто; ESLint 0 ошибок, 499 предупреждений (baseline); npm test 121 файл / 1409 тестов, осиротевших node-процессов нет; check-bundle ок; pack:win — exe и app.asar 20:57; index-docs и lint:docs ок; основное дерево F:\ProjectHub без ref и worktree от проверок.
Замечено, не исправлено: API-слот пишет строку лога на каждый чанк рассуждения (`[Thought] …`), у ornith это 132 строки лога за запуск.
<!-- SECTION:NOTES:END -->
