---
id: TASK-62
title: >-
  Многокорневой режим: активный worktree как контекст приложения, per-worktree
  процессы и порты
status: To Do
assignee: []
created_date: '2026-09-10 07:17'
labels:
  - ade-roadmap
  - worktree
  - processes
  - ui
  - P1
dependencies:
  - TASK-55
references:
  - src/store/useProjectStore.ts
  - electron/services/processManager.ts
  - electron/services/actionConfigService.ts
  - electron/services/worktreeService.ts
  - electron/services/projectPathGuard.ts
  - src/components/git/WorktreePanel.tsx
documentation:
  - >-
    backlog/decisions/decision-15 -
    Многокорневой-режим-активный-worktree-как-контекст-приложения.md
  - >-
    backlog/decisions/decision-6 -
    Git-worktree-как-единица-изоляции-задачи-и-агента.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-15, decision-6).

**Что не так сейчас**
- Приложение однокорневое: Kanban, Git Inspector, File Explorer, AI Studio, Action Runner и процессы работают с `selectedProject.path` (основное дерево). Worktree поддерживаются только терминалом с `cwd`, панелью worktree и кнопкой на карточке задачи.
- Идентификатор процесса `projectPath::name`: два worktree одного проекта конфликтуют по имени процесса и порту dev-сервера. Per-worktree профилей и автоподбора портов нет.
- «Параллельные ветки в одном проекте» фактически означают параллельные терминалы, а не параллельные рабочие контексты.

**Зависимость**: TASK-55 (материализация результатов), чтобы закрытие worktree не теряло данные.

**Что сделать**
1. Понятие `workspaceRoot` в сторе: пара «проект + рабочее дерево», основное дерево по умолчанию. Переключатель активного worktree рядом с именем проекта и в палитре команд; сохранение в `windowStateService`.
2. Перевести модули на `workspaceRoot`: Git Inspector (ветка, статус, дифф активного дерева), File Explorer и редактор, AI Studio и запуск агентов (`cwd`), Action Runner, терминалы. Backlog остаётся общим (`backlog/` основного дерева), карточка задачи показывает, в каком worktree над ней работают.
3. Процессы: идентификатор включает `workspaceRoot`; в `ActionDefinition` добавить `portStrategy: fixed | auto`; при `auto` находить свободный порт и подставлять в `PORT`, `${port}` в команде и `autoOpenUrl`. Занятые порты в менеджере процессов с кнопкой освобождения.
4. Политика `worktreeInit` в `.projecthub.json`: команды после создания worktree (например `npm ci`) или symlink `node_modules` на основное дерево; выполняется через `processManager` с логами.
5. Индикаторы: число активных worktree и агентов в сайдбаре, группировка Kanban по worktree (опционально), диалог завершения при закрытии worktree.
6. IPC-гарды (`assertInsideProject`) должны принимать пути внутри `.worktrees/` проекта как легитимные.
7. Unit-тесты: выбор порта, идентификаторы процессов, гарды путей для worktree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Переключатель активного worktree доступен в шапке проекта и палитре команд, выбор сохраняется между запусками
- [ ] #2 Git Inspector, File Explorer, AI Studio, Action Runner и терминалы работают с активным worktree, Backlog остаётся общим и показывает связь задачи с worktree
- [ ] #3 Два dev-сервера одного проекта в разных worktree запускаются одновременно без конфликта имён и портов при portStrategy auto
- [ ] #4 Политика worktreeInit выполняется после создания worktree и логируется
- [ ] #5 Сайдбар показывает число активных worktree и агентов в проекте
- [ ] #6 Unit-тесты на выбор порта, идентификаторы процессов и гарды путей добавлены, npm run build проходит
<!-- AC:END -->
