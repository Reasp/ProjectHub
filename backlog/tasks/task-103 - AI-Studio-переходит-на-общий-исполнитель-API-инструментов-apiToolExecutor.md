---
id: TASK-103
title: AI Studio переходит на общий исполнитель API-инструментов apiToolExecutor
status: Done
assignee: []
created_date: '2026-09-19 12:30'
updated_date: '2026-09-19 13:34'
labels:
  - hitl
  - ai-studio
dependencies: []
references:
  - >-
    backlog/decisions/decision-46 -
    Исполнитель-инструментов-API-агента-Swarm-с-HITL-лимит-шагов-и-бюджет-по-шагам.md
  - >-
    backlog/decisions/decision-47 -
    AI-Studio-на-общем-исполнителе-API-инструментов-адаптер-чата-и-политика.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Долг из decision-46 п. 1. AI Studio исполняет API-инструменты своим кодом (claudeBridgeService.executeApiTool/handleApiToolCall) с политикой-ветвлениями, отличной от evaluateToolRequest: чтение вне корня отклоняется, allowFileRead=false игнорируется, карточки и статусы идут в onChunk чата, есть подагенты и фоновые команды. Перевести на apiToolExecutor с адаптером чата и проверить UI карточек.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AI Studio и Swarm исполняют API-инструменты одним исполнителем с одной политикой
- [x] #2 Карточки с диффом, вопросы, фоновые команды и статусы проекта в AI Studio работают как раньше
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ADR: decision-47 (accepted). Подзадачи 103.1–103.3 в Review.
- AI Studio и Swarm исполняют API-инструменты одним `ApiToolExecutor` с политикой `evaluateToolRequest`; старый исполнитель AI Studio удалён.
- Чат AI Studio получает события через колбэки контекста и чистый `studioToolAdapter.ts`; формат чанков прежний, статусы проекта сохранены, фоновые команды — флаг `allowBackground`.
- Изменения для пользователя — decision-47 п. 2 (карточка при чтении вне корня и при выключенном «Чтении файлов», error при ненулевом коде, отказ spawn_subagent, статус running после ответа, заголовки карточек).
- Рендерер: одна строка на вызов в списке шагов (`upsertToolCall`).
- Трасса AI Studio и перевод голоса — не цели (decision-47 п. 5, 6).
- Проверки: снимок чанков до/после, живой прогон на qwen2.5 с одобрением через MCP, скриншоты собранного exe. lint 0 ошибок (494 предупреждения при baseline 499), 1429 тестов, check-bundle ок.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AI Studio переведена на общий исполнитель API-инструментов (decision-47): одна политика с Swarm и Claude CLI, адаптер чата studioToolAdapter с прежним форматом чанков, фоновые команды флагом allowBackground, одна строка на вызов в списке шагов. Проверено снимком чанков до/после, живым прогоном на qwen2.5 с одобрением через MCP и скриншотами собранного exe. Коммит 6f747c0.
<!-- SECTION:FINAL_SUMMARY:END -->
