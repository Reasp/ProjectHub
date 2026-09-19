---
id: TASK-103
title: AI Studio переходит на общий исполнитель API-инструментов apiToolExecutor
status: To Do
assignee: []
created_date: '2026-09-19 12:30'
labels:
  - hitl
  - ai-studio
dependencies: []
references:
  - >-
    backlog/decisions/decision-46 -
    Исполнитель-инструментов-API-агента-Swarm-с-HITL-лимит-шагов-и-бюджет-по-шагам.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Долг из decision-46 п. 1. AI Studio исполняет API-инструменты своим кодом (claudeBridgeService.executeApiTool/handleApiToolCall) с политикой-ветвлениями, отличной от evaluateToolRequest: чтение вне корня отклоняется, allowFileRead=false игнорируется, карточки и статусы идут в onChunk чата, есть подагенты и фоновые команды. Перевести на apiToolExecutor с адаптером чата и проверить UI карточек.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AI Studio и Swarm исполняют API-инструменты одним исполнителем с одной политикой
- [ ] #2 Карточки с диффом, вопросы, фоновые команды и статусы проекта в AI Studio работают как раньше
<!-- AC:END -->
