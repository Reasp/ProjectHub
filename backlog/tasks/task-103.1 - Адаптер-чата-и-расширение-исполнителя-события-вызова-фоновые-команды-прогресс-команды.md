---
id: TASK-103.1
title: >-
  Адаптер чата и расширение исполнителя: события вызова, фоновые команды,
  прогресс команды
status: Done
assignee: []
created_date: '2026-09-19 13:08'
updated_date: '2026-09-19 13:34'
labels:
  - hitl
  - ai-studio
dependencies: []
parent_task_id: TASK-103
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-47 п. 1, 3, 4, 7. ApiToolContext: onToolUpdate, onApprovalSettled, hitlProjectPath, allowBackground; зависимость startBackgroundProcess, прогресс вывода команды. Чистый studioToolAdapter.ts (чанки чата и статусы проекта), upsertToolCall в рендерере. Unit-тесты.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Исполнитель отдаёт события вызова и прогресс команды, Swarm без колбэков работает как раньше
- [x] #2 Фоновые команды разрешены флагом контекста, без флага — background-not-allowed
- [x] #3 Адаптер и upsertToolCall покрыты unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-47 п. 1, 3, 4, 7.
- `apiToolExecutor.ts`: колбэки контекста `onToolUpdate` (running, вывод команды, итог done/accepted/rejected/error), `onApprovalSettled`, `onApprovalRequest(request, call)`; поле `hitlProjectPath` (по умолчанию workDir — Swarm не меняется); флаг `allowBackground` и зависимость `startBackgroundProcess`; `runCommand` принимает `onOutput`. Итоговое событие шлёт только `execute`; у `computer_*` — текст с числом картинок (`chatResult`).
- `apiToolPolicy.ts`: `planApiToolCall(..., { allowBackground })` — фоновые команды идут по политике команд и помечаются `background: true`; без флага — `background-not-allowed`. Текст `unknown-tool` без «Swarm».
- `apiToolExecutorDeps.ts`: `onOutput` → `executeSubprocess`, `startBackgroundProcess` → `processManager.startProcess(projectPath, cmd, name, { workspaceRoot })`, прокси `computer_*` получает `projectPath: hitlProjectPath || workDir` и `origin` без сужения (studio допустим).
- `studioToolAdapter.ts` (чистый): чанки прежнего формата, объект вызова меняется на месте (итоговое сообщение), статусы проекта: карточка → waiting_approval, ответ → running «Обработка результатов...», команда → «Выполняется: …».
- `src/lib/aiToolCalls.ts`: `upsertToolCall` — одна строка на вызов в `useAIStudioStore` (раньше каждый чанк дописывал строку).
- Тесты: `studioToolAdapter.test.ts` (7), +5 в `apiToolExecutor.test.ts`, +1 в `apiToolPolicy.test.ts`.
<!-- SECTION:NOTES:END -->
