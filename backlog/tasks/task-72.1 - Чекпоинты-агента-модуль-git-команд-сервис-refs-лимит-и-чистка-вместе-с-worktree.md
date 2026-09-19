---
id: TASK-72.1
title: >-
  Чекпоинты агента: модуль git-команд, сервис, refs, лимит и чистка вместе с
  worktree
status: Review
assignee: []
created_date: '2026-09-19 11:12'
updated_date: '2026-09-19 11:44'
labels:
  - swarm
  - git
dependencies: []
parent_task_id: TASK-72
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-45 п. 1, 2, 5. Чистый модуль `checkpointGit.ts` (снимок через временный индекс + commit-tree, ref refs/projecthub/checkpoints/<swarmId>/<agentId>/<n>, откат, удаление ref), `checkpointService.ts` (очередь по агенту, дедупликация по дереву, лимит 50), интеграция в agentFleetService (start/turn/end), чистка в discardSwarm/pickWinner/restoreFromDisk.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Снимок включает неотслеживаемые файлы, соблюдает .gitignore и не меняет HEAD, индекс и git status worktree (тест на настоящем git)
- [x] #2 Чекпоинты start/turn/end создаются по ходам Claude CLI и API, одинаковые деревья не дублируются, лимит 50 на агента
- [x] #3 Ref удаляются при discardSwarm, у проигравших при Pick Winner и для исчезнувших сессий при восстановлении
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-45 п. 1, 2, 5.
- `electron/services/checkpointGit.ts` (чистый, git через execFile): `snapshotTree` — копия индекса worktree во временный файл (`rev-parse --git-path index`, путь относительный к cwd — без `--path-format`, совместимо со старым git) → `GIT_INDEX_FILE` `add -A` → `write-tree`; `createCheckpoint` — `commit-tree -p HEAD` + `update-ref refs/projecthub/checkpoints/<swarmId>/<agentId>/<n>`, `skipIfTree` для дедупликации; `rewindWorkTree`; `deleteRefs*`, `listRefs`, `checkpointsToPrune`, `filesToRemoveAfterCheckout` (без каталогов и путей за пределами дерева).
- `checkpointService.ts`: очередь операций по агенту, `whenIdle`, номера из `AgentSlotState.trace.checkpoints`, лимит 50 (старые ref удаляются), `rewind` со снимком `pre_rewind` внутри той же очереди, «удалено файлов» — дифф деревьев pre_rewind → снимок, `deleteSession/deleteAgent/pruneOrphans`.
- Флот: `start` перед запуском движка, `turn` после результатов всех инструментов хода (Claude CLI и API), `end` перед авто-коммитом; вне git — одна строка в логе. Сервис чекпоинтов передаётся в конструктор явно: боевой синглтон — с ним, `new AgentFleetService()` в тестах — без (существующие тесты используют `projectPath: 'F:/ProjectHub'`, иначе писали бы ref в настоящий репозиторий).
- Чистка: `discardSwarm` (весь префикс сессии, и при `useWorktrees: false`), Pick Winner (проигравшие), `restoreFromDisk` → `pruneOrphanCheckpoints` в фоне.
- Проверено вживую на git 2.53 (скрипт в scratchpad) и тестами `checkpointGit.test.ts` (9) на временных репозиториях: неотслеживаемые и staged в снимке, `.gitignore` соблюдён, HEAD/индекс (sha1)/status не меняются, `stash create` новый файл не берёт.
- Найдено тестом: при мгновенной выдаче событий снимок хода может захватить часть следующего хода (git идёт в очереди) — записано в ADR как ограничение.
<!-- SECTION:NOTES:END -->
