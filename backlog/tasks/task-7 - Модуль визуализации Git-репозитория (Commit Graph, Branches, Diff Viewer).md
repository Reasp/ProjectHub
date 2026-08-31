---
id: task-7
title: 'Модуль визуализации Git-репозитория (Commit Graph, Branches, Diff Viewer)'
status: Done
assignee: []
created_date: ''
updated_date: '2026-08-31 02:22'
labels:
  - git
  - graph
  - diff
  - branches
  - ui
dependencies: []
---

# task-7: Модуль визуализации Git-репозитория (Commit Graph, Branches, Diff Viewer)

## Description
Разработать встроенный визуальный Git-клиент (по аналогии со SourceTree / GitHub Desktop), позволяющий инспектировать историю коммитов, ветки, незакоммиченные изменения и построчные диффы файлов.

## Acceptance Criteria
- [x] Визуальный граф истории коммитов с отображением линий ветвлений, авторов, дат, хэшей и сообщений коммитов.
- [x] Панель веток (локальные, remote/origin), тегов и стэшей (stashes) с возможностью быстрого переключения (checkout).
- [x] Раздел Working Copy (измененные / неиндексированные файлы) с поддержкой построчного и side-by-side просмотра диффов (`@git-diff-view/react` или Monaco Diff).
- [x] Кнопка создания коммита с поддержкой быстрого добавления ID текущей задачи бэклога в сообщение коммита (например, `feat(task-2): ...`).
- [x] Кнопка быстрого создания новой ветки под задачу прямо из карточки задачи Backlog (например, `feat/task-N`).
- [x] Автоматическое отслеживание изменений `.git/HEAD` и `.git/index` для обновления UI в реальном времени.

## Comments

<!-- COMMENTS:BEGIN -->
author: antigravity
created: 2026-08-28 04:04
---
## Implementation Plan

Три слоя: Electron Backend (IPC) → Preload (API) → Store + UI.

- **main.ts**: хэндлеры git:getRepoDetails, git:checkout, git:createBranch, git:stageFile, git:unstageFile, git:stageAll, git:commit, git:getFileDiff
- **preload.ts**: экспозиция getGitRepoDetails, checkoutBranch, createBranch, stageFile, unstageFile, stageAll, commitChanges, getFileDiff, onGitChanged
- **useProjectStore.ts**: состояние gitRepoDetails, gitSelectedFile, gitDiffContent + все git-экшены + слушатель onGitChanged
- **GitInspector.tsx**: 3 вкладки: История (commit graph), Ветки & Теги (checkout + создание), Working Copy (staged/unstaged + diff + commit form)
---
<!-- COMMENTS:END -->
