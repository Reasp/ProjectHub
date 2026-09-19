---
id: TASK-101.1
title: >-
  Общий исполнитель инструментов API с HITL для Swarm: чистая политика и сервис
  с тестами
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
decision-46 п. 1, 2, 6. Чистый модуль apiToolPolicy.ts (нормализация имени, алиасы Claude-имён для allow-списка роли, вердикт через evaluateToolRequest, выбор computer_*, maxSteps, форма вопроса) и сервис apiToolExecutor.ts с внедряемыми зависимостями (hitlService, запись файла, команда, поиск, прокси computer_*).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Политика API-инструмента — чистая функция поверх evaluateToolRequest, с unit-тестами
- [x] #2 Исполнитель ставит запросы HITL с origin, agentId, role и пишет auto-решения и outcome в аудит
- [x] #3 Запись вне worktree отклоняется, фоновые команды в Swarm не запускаются, computer_* только по правилу 20
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-46 п. 1, 2, 6.
- `apiToolPolicy.ts` (чистый): вид инструмента, allow-список роли с алиасами Claude Code (`read_file`↔`Read`, `write_file`↔`Write`/`Edit`, `run_command`↔`Bash`, `ask_question`↔`AskUserQuestion`), вердикт через `evaluateToolRequest` (как у Claude CLI в Swarm); `list_dir`/`search_rag` — как чтение; `background: true` → `background-not-allowed`; неизвестный инструмент → `unknown-tool`; `resolveApiMaxSteps` (maxTurns 1…100, иначе 25); `selectComputerTools` (только done_loop + label computer-use + включено в ProjectHub).
- `apiToolExecutor.ts`: сервис с внедряемыми зависимостями; запросы HITL с sessionId/origin/engine/agentId/agentName/role/tool, `projectPath` = рабочий каталог слота; авто-решения и outcome в аудит; перед инструментом проверка `isActive`; `onExecute` — для запрета fallback; вопрос — карточка, ответ модели.
- `apiToolExecutorDeps.ts`: боевые зависимости (hitlService, executeSubprocess по sessionId, applyDiff, searchProjectDocs, parseQuestionData, computerUseService.callTool).
- AI Studio остаётся на своём исполнителе — TASK-103.
- Тесты: `apiToolPolicy.test.ts` (11), `apiToolExecutor.test.ts` (8).
<!-- SECTION:NOTES:END -->
