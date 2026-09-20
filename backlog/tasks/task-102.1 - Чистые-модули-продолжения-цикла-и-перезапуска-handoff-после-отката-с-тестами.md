---
id: TASK-102.1
title: Чистые модули продолжения цикла и перезапуска handoff после отката с тестами
status: Review
assignee: []
created_date: '2026-09-19 13:42'
updated_date: '2026-09-19 13:57'
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
decision-48 п. 1–3. Модуль electron/services/rewindContinuation.ts без Electron: доступность продолжения по режиму, пометка итераций rolledBack по чекпоинту, отрезки цикла и номер итерации внутри отрезка, промпт первой итерации отрезка, план инвалидации этапов handoff при откате и план перезапуска k…N, запрет отката этапа после невыполненного предыдущего. Unit-тесты.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Чистые функции плана done-loop и handoff покрыты unit-тестами
- [x] #2 decideNext и промпт повтора получают номер итерации внутри отрезка
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-48 п. 1–3.
- `electron/services/rewindContinuation.ts` (без Electron): `continueModeOf`, `normalizeInstruction`/`instructionBlock`, `rollbackMarkFor`/`applyRollbackMarks` (full/partial по run и виду чекпоинта, пересчёт целиком — работает и отмена отката через pre_rewind), `loopSegmentStart`/`loopSegmentNumber`/`iterationInSegment`, `doneLoopContinueBlockReason` (нужен откат, бюджет не исчерпан), `buildLoopContinuationPrompt`, `uncheckHarnessCriteria`, `cancelledSummaryText`, `handoffRewindBlockReason`, `stagesInvalidatedBy`, `invalidatedStage`, `planHandoffRerun`.
- `doneLoopService.run`: номер итерации внутри отрезка идёт в `decideNext` и `buildRetryPrompt`; итерация хранит `run` и `segment`; первая итерация отрезка — без продолжения сессии движка; при возобновлении первой итерации отрезка промпт пересобирается из записи продолжения (`note`, `instruction`).
- `src/lib/rewindContinueView.ts`: агент, ждущий продолжения, итерации текущего отрезка, подписи и тексты диалога по режиму.
- Тесты: `rewindContinuation.test.ts` (11), `rewindContinueView.test.ts` (3, ru и en).
<!-- SECTION:NOTES:END -->
