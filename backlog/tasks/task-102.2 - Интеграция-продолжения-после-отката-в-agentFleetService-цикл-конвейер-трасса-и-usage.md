---
id: TASK-102.2
title: >-
  Интеграция продолжения после отката в agentFleetService: цикл, конвейер,
  трасса и usage
status: Done
assignee: []
created_date: '2026-09-19 13:42'
updated_date: '2026-09-20 01:52'
labels:
  - swarm
  - git
dependencies: []
parent_task_id: TASK-102
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-48 п. 1–5. swarm:continueAgent выбирает режим по сессии; rewindAgent помечает итерации и инвалидирует этапы; doneLoopService.run продолжает отрезок, отменяет итог прошлого успеха в файле задачи; executeHandoff в режиме rerun; session.continuations, событие трассы continue, таймлайн, экспорт; база usage для этапов handoff. Тесты на AgentFleetService во временном git-репозитории.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После отката в done-loop continueAgent запускает новую итерацию с пояснением, история итераций сохранена
- [x] #2 После отката этапа handoff continueAgent перезапускает этап и последующие
- [x] #3 Остановка, бюджет и накопление usage работают при продолжении
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-48 п. 1–5.
- Зонд до изменений (временный тест на настоящем AgentFleetService, удалён): done-loop после отката оставался completed/success с отмеченной задачей, continueAgent и resumeSwarm отказывали; в handoff откат этапа 1 стирал коммит этапа 2 в общем worktree, а этап 2 оставался completed со старым commitHash. Факты — в Context ADR.
- `continueAgent` выбирает режим по сессии и возвращает `mode`; `continueBlockReason` общий (сессия/агент не активны, не прервана, worktree есть) плюс проверки режима из `rewindContinuation`.
- `rewindAgent` → `applyRewindToController`: done-loop — `applyRollbackMarks`; handoff — этапы k…N `invalidatedStage`, агенты после k — pending без finalOutput/diff/commitHash/pendingRewindNote. `rewindBlockReason` в handoff запрещает откат этапа после невыполненного предыдущего (проверка раньше «агент работает»: отменённый агент в статусе pending).
- `continueDoneLoop`: `doneLoopService.reopenAfterRewind` (снимает свои отметки критериев, возвращает `previousStatus`, Final Summary «отменён откатом»), запись продолжения, `executeDoneLoop(session, 'continue')`.
- `rerunHandoff`: `executeHandoff(session, k, 'rerun', { instruction })` — общий worktree, `rerunCount`, событие `continue` для последующих этапов; база usage перед каждым этапом (заодно исправляет затирание usage при возобновлении handoff).
- `session.continuations[]`, событие трассы `continue` (добавлено в `KNOWN_TYPES` разбора JSONL — без этого события терялись при чтении), `timeline.continuations`; Markdown-экспорт: пометки итераций и этапов, раздел «Продолжения после отката».
- Тест `rewindContinuationFleet.test.ts` (3): цикл (отрезок с новым лимитом, отмена прошлого успеха, новая сессия движка на первой итерации отрезка, накопление usage, трасса, экспорт), остановка во время продолжения, handoff (инвалидация, запрет отката этапа 2, перезапуск обоих этапов, лог ветки).
<!-- SECTION:NOTES:END -->
