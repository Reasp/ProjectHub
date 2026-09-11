---
id: TASK-62
title: >-
  Многокорневой режим: активный worktree как контекст приложения, per-worktree
  процессы и порты
status: Done
assignee: []
created_date: '2026-09-10 07:17'
updated_date: '2026-09-11 07:45'
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
- [x] #1 Переключатель активного worktree доступен в шапке проекта и палитре команд, выбор сохраняется между запусками
- [x] #2 Git Inspector, File Explorer, AI Studio, Action Runner и терминалы работают с активным worktree, Backlog остаётся общим и показывает связь задачи с worktree
- [x] #3 Два dev-сервера одного проекта в разных worktree запускаются одновременно без конфликта имён и портов при portStrategy auto
- [x] #4 Политика worktreeInit выполняется после создания worktree и логируется
- [x] #5 Сайдбар показывает число активных worktree и агентов в проекте
- [x] #6 Unit-тесты на выбор порта, идентификаторы процессов и гарды путей добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Main: `portAllocator.ts` (свободный порт, подстановка `${port}`, парсеры netstat/lsof), идентификатор процесса с `workspaceRoot`, `portStrategy` в `ActionDefinition`, поле `port`/`workspaceRoot` в `ManagedProcess`.
2. Гарды: `assertWorkspaceRoot` (корень проекта или worktree внутри него, проверка `.git`-указателя) и применение в files/git/ai IPC.
3. `worktreeInit` в `.projecthub.json` + запуск команд/symlink node_modules после создания worktree через processManager с логами.
4. Стор: поле `workspaceRoot` (проект + активное дерево), `setActiveWorktree`, персист по проектам, перевод git/файлов/процессов/терминалов/AI на workspaceRoot.
5. UI: переключатель worktree в шапке и палитре команд, порт и кнопка освобождения во вкладке Processes, счётчики worktree/агентов в сайдбаре, связь задачи с worktree в карточке.
6. i18n ru/en, unit-тесты (порты, id процессов, гарды), lint/test/build, pack:win.
7. decision-15 → accepted, `npm run index-docs`, задача в Review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано (см. [[decision-15]], раздел «Реализация (TASK-62)»).

**Контекст приложения**
- В сторе появился `workspaceRoot` («проект + рабочее дерево») и `activeWorktreePath`; выбор дерева хранится по проектам в localStorage (`projecthub_active_worktrees`) и восстанавливается при выборе проекта. Если дерево удалили снаружи, `loadWorktreesAction` возвращает контекст в основное дерево.
- Переключатель: `WorktreeSwitcher` в шапке (через `createPortal`, `z-[10000]`, правило 19), блок «Активное рабочее дерево» в палитре (Ctrl+K), отметка/кнопка в панели Worktrees и в карточке задачи.
- На `workspaceRoot` переведены: git-операции стора (ветка, статус, дифф, лог, коммиты), File Explorer и редактор, терминалы/PTY, Action Runner, кнопки «VS Code / Папка / Терминал» в шапке, AI Studio и Claude CLI (`AIStreamRequest.workspaceRoot` → cwd CLI, `applyDiff`, `run_command`, карточки одобрений). Backlog, документы и майлстоуны остались на корне проекта.

**Процессы и порты**
- Идентификатор процесса `${workspaceRoot}::${name}` (`buildProcessId`), `ManagedProcess.workspaceRoot`/`port`; `cwd` по-прежнему корень проекта, поэтому процессы всех деревьев видны в одном списке.
- `ActionDefinition.portStrategy: fixed | auto` + `port`: при `auto` `portAllocator` ищет свободный порт, кладёт в `PORT` и подставляет вместо `${port}` в команде и `autoOpenUrl`. Выданные порты резервируются на время жизни процесса, иначе параллельный старт во втором дереве получал тот же номер.
- Во вкладке Processes добавлены колонки «Дерево» и «Порт» с кнопкой освобождения (`listPortOwners`/`releasePort`: netstat -ano / lsof, hub-процессы останавливаются штатно). Стратегия порта редактируется в ActionConfigModal.

**worktreeInit**
- `worktreeInit` в `.projecthub.json`: `commands` (цепочка через `&&`, запускается процессом `worktree-init: <dir>` с логами во вкладке Processes) и `linkNodeModules` (junction на Windows / symlink). Выполняется в `git:worktree:add`, результат возвращается в `GitWorktreeInfo.init` и пишется в системный лог.

**Гарды путей**
- `assertWorkspaceRoot`: корень зарегистрированного проекта либо его worktree, опознанный по файлу `.git` с указателем `gitdir:` внутрь `<project>/.git/worktrees/` (не по имени каталога). Применён в IPC файлов, git-операций и в `start_process` Remote Control.

**Индикаторы**
- В сайдбаре по проекту: число рабочих деревьев (`WT: N`) и занятых агентов (рой + сессия AI Studio); в AI Studio — бейдж активного дерева, в Claude CLI — фактический cwd сессии и подсказка о перезапуске после переключения.

**Проверки**: новые unit-тесты `portAllocator.test.ts` (подстановка `${port}`, поиск свободного порта, парсеры netstat/lsof), `workspaceRootGuard.test.ts` (указатель `.git`, гард на реальной структуре worktree), блок TASK-62 в `processManager.test.ts` (id по дереву, авто-порт, два дерева одновременно). `npm run lint` — 0 ошибок (513 предупреждений, baseline не изменился), `npm test` — 383 теста, `npm run build` и `npm run pack:win` проходят; гард дополнительно проверен на настоящем `git worktree` этого репозитория.

**Не делалось намеренно**: группировка Kanban по worktree (в описании помечена как опциональная).
<!-- SECTION:NOTES:END -->
