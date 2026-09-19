---
id: TASK-101.2
title: >-
  Интеграция исполнителя в runApiAgent: tool-loop, лимит шагов, бюджет по шагам,
  остановка
status: Review
assignee: []
created_date: '2026-09-19 12:30'
updated_date: '2026-09-19 13:00'
labels:
  - swarm
  - hitl
  - providers
dependencies: []
parent_task_id: TASK-101
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-46 п. 3, 4, 5, 7. runApiAgent передаёт executeTool и maxSteps (maxTurns роли), граница step_usage для бюджета, step_limit для лога, abortSession по контроллеру слота, toolActivity по исполнению.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 API-слот исполняет инструменты в worktree, результаты возвращаются модели
- [x] #2 Бюджет слота проверяется между шагами tool-loop, остановка прерывает стрим, карточки и команды
- [x] #3 Fallback модели запрещается только после исполненного инструмента
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-46 п. 3, 4, 5, 7.
- `runApiAgent`: `executeTool` (общий исполнитель), `maxSteps` = maxTurns роли, `computerTools` по правилу 20; правила — AI Studio, суженные `applyRolePermissions`; лог «[HITL] Инструменты исполняются в …».
- `aiAgentService.streamChat`: новые границы `step_usage` (usage запроса) и `step_limit`; `onToolBoundary` может вернуть промис — tool-loop его ждёт; после `step_usage` проверка отмены.
- Бюджет: `step_usage` → `recordUsage('add')` → `enforceBudget` между шагами; итог streamChat — `replace` как раньше.
- Остановка: найден дефект — AbortController слота не был связан со streamChat. Теперь abort → `claudeBridgeService.abortSession(swarm-<id>)` (стрим, карточки, команды); прерванный streamChat без колбэков завершает ход сам (только при сработавшей отмене).
- `toolActivity` ставит исполнитель в момент исполнения, а не чанк toolCall: отклонённый вызов fallback не блокирует.
- `ENGINE_CAPABILITIES.api.maxTurns = true` (main и зеркало `src/lib/engineCapabilities.ts`).
- Тесты: `apiAgentToolsFleet.test.ts` (6): исполнение и аудит, привязка HITL, maxTurns/step_limit, бюджет с abortSession, fallback по исполнению, чекпоинт хода до следующего шага.
<!-- SECTION:NOTES:END -->
