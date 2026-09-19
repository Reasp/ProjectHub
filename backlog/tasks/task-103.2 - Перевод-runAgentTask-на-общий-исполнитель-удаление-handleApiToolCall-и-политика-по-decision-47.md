---
id: TASK-103.2
title: >-
  Перевод runAgentTask на общий исполнитель, удаление handleApiToolCall и
  политика по decision-47
status: Review
assignee: []
created_date: '2026-09-19 13:08'
updated_date: '2026-09-19 13:27'
labels:
  - hitl
  - ai-studio
dependencies: []
parent_task_id: TASK-103
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-47 п. 1, 2. runAgentTask API-пути вызывает ApiToolExecutor с контекстом AI Studio (origin studio, workDir = worktree, hitlProjectPath = корень проекта, allowBackground). Удалить executeApiTool/handleApiToolCall/executeReadOnlyApiTool/runCommandTool. Сравнить чанки до и после временным тестом.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AI Studio исполняет API-инструменты ApiToolExecutor, старый исполнитель удалён
- [x] #2 Чанки toolCall/approvalRequest и статусы проекта сверены до и после, расхождения — только из decision-47 п. 2
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-47 п. 1, 2.
- `runAgentTask` (API-путь): `executeTool` → `getApiToolExecutor().execute(tc, studioToolContext)`. Контекст: origin studio, engine api, workDir = worktree сессии, `hitlProjectPath` = корень проекта, `allowBackground`, `isActive` = сессия идёт и не прервана, колбэки адаптера чата.
- Удалены `executeApiTool`, `handleApiToolCall`, `executeReadOnlyApiTool`, `runCommandTool`, `formatSubprocessResult`, неиспользуемые импорты (`isInsideProject`, `processManager`, `searchProjectDocs`, `ToolExecutionResult`, `AutoApproveRules`, `os`).
- Impact (GitNexus, индекс пересобран): приватные методы вызывались только из `runAgentTask`; `runAgentTask` — HIGH по вызывающим (aiIpc, voiceIpc, dispatchRpc), сигнатура не менялась; `ApiToolExecutor` — Swarm и тесты, расширение обратно совместимо.
- Снимок чанков до/после временным тестом (14 сценариев): форма совпадает, отличия только из decision-47 п. 2.
- Тест `studioApiTools.test.ts` (7): карточка записи с вызовом и диффом, отказ, команда с выводом, вопрос, фоновая команда в worktree, общая политика (чтение вне корня, allowFileRead=false, spawn_subagent), worktree против корня проекта.
<!-- SECTION:NOTES:END -->
