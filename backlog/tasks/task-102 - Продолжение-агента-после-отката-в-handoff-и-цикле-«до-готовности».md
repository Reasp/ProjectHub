---
id: TASK-102
title: Продолжение агента после отката в handoff и цикле «до готовности»
status: Review
assignee: []
created_date: '2026-09-19 11:47'
updated_date: '2026-09-20 00:52'
labels:
  - swarm
  - git
dependencies: []
references:
  - >-
    backlog/decisions/decision-45 -
    Чекпоинты-ходов-агента-в-worktree-откат-таймлайн-инструментов-и-трасса-JSONL.md
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Долг из decision-45 п. 4 (TASK-72). Откат к чекпоинту работает во всех режимах, но «Продолжить агента» из карточки есть только у fan-out: в handoff этапами управляет конвейер, в done-loop — контроллер цикла (итерации, критерии, бюджет). Нужно решить, как продолжать после отката: для done-loop — новая итерация с пояснением об откате и сохранением истории итераций; для handoff — перезапуск этапа с откатанного состояния и повтор последующих этапов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После отката в done-loop можно запустить следующую итерацию с пояснением об откате
- [x] #2 После отката в handoff можно перезапустить этап и последующие этапы
- [x] #3 Решение зафиксировано в ADR
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Решение — decision-48 (accepted), подзадачи 102.1–102.3.
- Один IPC: `swarm:continueAgent` выбирает режим по сессии (`agent` | `loop` | `handoff`) и возвращает `mode`; доступность приходит в `swarm:getTimeline` с `mode` и `fromStage`.
- Цикл «до готовности»: откат помечает итерации `rolledBack` (`full`/`partial`, пересчёт целиком — работает и отмена отката), продолжение открывает отрезок с полным лимитом `maxIterations`, номера итераций сквозные, бюджет накопительный; итог прошлого успеха отменяется в файле задачи (снятие отметок, возврат статуса, Final Summary «отменён откатом»).
- Handoff: worktree общий, поэтому откат этапа k инвалидирует этапы k…N, откат этапа после невыполненного предыдущего запрещён, перезапуск идёт с k до конца тем же конвейером; база usage теперь применяется и при возобновлении handoff.
- Запись: `session.continuations[]`, событие трассы `continue`, `timeline.continuations`, строки в Markdown-экспорте.
- UI: кнопка по режиму в «Таймлайне», баннер «Продолжить после отката» в заголовке сессии, пометки отменённых итераций и этапов, ru/en.
- Проверено: 17 новых unit-тестов (`rewindContinuation`, `rewindContinueView`, `rewindContinuationFleet`), живой прогон на qwen2.5:7b-instruct с одобрениями через MCP, скриншоты собранного exe. Полный прогон: ESLint 0 ошибок / 494 предупреждения (baseline), 1446 тестов, check-bundle, `lint:docs`, `check-index`.
<!-- SECTION:NOTES:END -->
