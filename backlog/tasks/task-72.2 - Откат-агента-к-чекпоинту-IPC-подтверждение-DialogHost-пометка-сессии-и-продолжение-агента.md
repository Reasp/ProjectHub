---
id: TASK-72.2
title: >-
  Откат агента к чекпоинту: IPC, подтверждение DialogHost, пометка сессии и
  продолжение агента
status: Review
assignee: []
created_date: '2026-09-19 11:12'
updated_date: '2026-09-19 11:46'
labels:
  - swarm
  - git
  - ui
dependencies:
  - TASK-72.1
parent_task_id: TASK-72
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-45 п. 4. `swarm:rewind` (pre_rewind-снимок, reset к родителю, checkout снимка, удаление файлов по списку, фиксация rewind-коммитом, пересчёт диффа, rewinds[]), `swarm:continueAgent` для fan-out (новая сессия Claude без --resume, пустая история API, пояснение об откате в промпте). Откат только в worktree неактивного агента.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После отката файлы worktree совпадают со снимком, игнорируемые файлы не тронуты, отменённая работа доступна в чекпоинте pre_rewind
- [x] #2 Откат запрещён в основном дереве, у активного агента и у влитого победителя — с понятной причиной
- [x] #3 Продолжение после отката запускает агента в новой сессии с пояснением об откате
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-45 п. 4.
- `agentFleetService.rewindAgent(swarmId, agentId, n)` / IPC `swarm:rewind`: проверки (`rewindBlockReason`: только worktree слота, не основное дерево; worktree на диске; не влитый победитель; агент и сессия не активны; ref существует) → `whenIdle` → `checkpointService.rewind` (снимок `pre_rewind`, `reset --hard` к родителю снимка, `checkout <снимок> -- .`, удаление файлов по списку, `reset`) → `materializeAgentResult(..., 'rewind(<роль>): чекпоинт #n (после хода T)')` (новый необязательный параметр сообщения) → пересчёт диффа (`refreshAgentDiff`, вынесен из runSingleAgent) → `rewinds[]`, `pendingRewindNote`, сброс `cliSessionId` и истории API, событие трассы `rewind`, лог.
- `continueAgent(swarmId, agentId, instruction?)` / IPC `swarm:continueAgent`: только fan-out (в т. ч. assigned), без выбранного победителя; новый запуск в том же worktree; `runSingleAgent` добавляет пояснение об откате и принудительно начинает новую сессию движка; usage складывается с прошлыми запусками через базу (исправление по живому прогону). Handoff и done-loop — откат без продолжения из карточки (долг в ADR).
- UI: подтверждение `dialog.confirm` (DialogHost `z-[10001]`, проверено на собранном exe), продолжение — `dialog.prompt` с необязательным уточнением; бейдж «откат к #N» в шапке карточки.
- Тесты `agentCheckpointsFleet.test.ts`: откат к ходу 1 (two.txt удалён, ветка `rewind(...)` поверх `base`, removedFiles 1, pre_rewind #4), запрет в основном дереве с причиной, продолжение с пояснением и уточнением, накопление usage.
- Вживую (Claude CLI haiku, временный репозиторий): откат к #2 удалил c.txt, `git status` чистый, второй запуск — новый session_id, итог $0.0325 + $0.0242 = $0.0567.
<!-- SECTION:NOTES:END -->
