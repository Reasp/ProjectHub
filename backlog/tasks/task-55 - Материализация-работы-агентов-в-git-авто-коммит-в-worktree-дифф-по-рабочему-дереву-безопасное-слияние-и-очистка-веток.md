---
id: TASK-55
title: >-
  Материализация работы агентов в git: авто-коммит в worktree, дифф по рабочему
  дереву, безопасное слияние и очистка веток
status: To Do
assignee: []
created_date: '2026-09-10 07:14'
labels:
  - ade-roadmap
  - swarm
  - worktree
  - git
  - P0
dependencies: []
references:
  - electron/services/agentFleetService.ts
  - electron/services/worktreeService.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/components/git/WorktreeCompleteModal.tsx
documentation:
  - >-
    backlog/decisions/decision-8 -
    Результаты-агентов-материализуются-в-git-авто-коммит-в-worktree-и-безопасное-слияние.md
  - >-
    backlog/decisions/decision-6 -
    Git-worktree-как-единица-изоляции-задачи-и-агента.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-8) показала, что Swarm Arena и Pick Winner теряют работу агентов.

**Что не так сейчас**
- Агенты (`claude -p`, `codex`, API-движок) пишут файлы в worktree, но не коммитят. `agentFleetService` нигде не вызывает commit/stash.
- `worktreeService.getWorktreeDiff` считает `git diff base...branch` из основного репозитория и видит только коммиты, поэтому дифф кандидата почти всегда пустой.
- `pickWinner` делает `merge --no-ff` пустой ветки, а затем `removeWorktree(..., force=true)` удаляет незакоммиченные изменения агента.
- `mergeWorktree` не проверяет чистоту основного дерева, не использует `--no-commit`, при конфликте не делает `merge --abort` и не возвращает исходную ветку.
- Проигравшие агенты помечаются `stopped`, но процессы не убиваются (`killProcessTree` не вызывается), ветки `swarm/*` и `handoff/*` не удаляются никогда, worktree `handoff/*` тоже.
- Нет сборки мусора осиротевших worktree и веток после перезапуска.

**Что сделать**
1. В `agentFleetService` после завершения агента (успех/ошибка/остановка) выполнять в его worktree `git add -A` и коммит `agent(<role>): <taskId|sessionId>` от технического автора `ProjectHub Agent <agent@projecthub.local>`; при отсутствии изменений помечать результат «без изменений». Настройка `autoCommitAgentResults` (по умолчанию включена); при выключении создавать снапшот `git stash create` и хранить hash в сессии.
2. Уважать `.gitignore`; никогда не коммитить `.worktrees/`, `node_modules/`, `dist/`.
3. `getWorktreeDiff` считать внутри worktree: `git diff <base>` плюс untracked (`git add -N` во временном индексе или `--no-index` для новых файлов), чтобы дифф был виден и до авто-коммита.
4. `mergeWorktree`: проверка чистого дерева (иначе предложить stash), `merge --no-ff --no-commit`, при конфликте `merge --abort`, восстановление исходной ветки и возврат списка конфликтных файлов; UI-диалог конфликта с кнопками «Открыть в редакторе», «Отменить», «Создать PR вместо слияния».
5. Частичное принятие: `git checkout <branch> -- <paths>` из UI арены и диалога завершения worktree.
6. Проигравшие: `killProcessTree`, удаление worktree только если есть коммит/снапшот, затем `git branch -D`; hash последнего коммита сохраняется в истории сессии для отката.
7. GC: при старте и по кнопке `worktree prune`, поиск worktree/веток `swarm/*`, `handoff/*`, `task/*` без активной сессии и задачи в работе, предложение удалить.
8. Unit-тесты на `worktreeService` (дифф с untracked, merge с конфликтом и abort) и на авто-коммит в `agentFleetService`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После завершения любого агента Swarm/Handoff в его worktree существует коммит с изменениями либо явный статус «без изменений»; настройка autoCommitAgentResults работает, при выключении сохраняется stash-снапшот
- [ ] #2 Дифф кандидата в Swarm Arena и в диалоге завершения worktree показывает изменения рабочего дерева, включая новые файлы, до и после авто-коммита
- [ ] #3 Слияние с конфликтом не оставляет основное дерево в состоянии merge: выполняется abort, восстанавливается исходная ветка, пользователь видит список конфликтных файлов и варианты действий
- [ ] #4 Pick Winner убивает процессы проигравших, удаляет их worktree и ветки, worktree не удаляется без коммита или снапшота; hash последнего коммита проигравшего сохранён в сессии
- [ ] #5 Из арены можно принять отдельные файлы кандидата без слияния всей ветки
- [ ] #6 GC при старте и по кнопке находит осиротевшие worktree и ветки swarm/handoff/task и удаляет их после подтверждения
- [ ] #7 Добавлены unit-тесты: дифф с untracked-файлами, merge с конфликтом и abort, авто-коммит агента; npm run build проходит
<!-- AC:END -->
