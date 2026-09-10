---
id: TASK-53
title: >-
  Комплексное внедрение Git Worktrees для параллельной изоляции задач и агентных
  сессий
status: Review
assignee:
  - '@antigravity'
created_date: '2026-09-10 01:22'
updated_date: '2026-09-10 02:53'
labels:
  - git
  - worktrees
  - ade
  - orchestration
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Комплексное внедрение механизма Git Worktrees в ProjectHub (по концепции ADE Orca) для параллельной работы нескольких агентов и разработчиков без конфликтов в общей рабочей директории:

- **Изоляция сессий агентов**: каждый агент или задача может выполняться в собственном изолированном дереве каталогов со своей веткой Git.
- **Интеграция с Backlog.md**: автоматическое или ручное создание worktree при взятии задачи в работу (In Progress) и запуск терминала Claude Code непосредственно в директории задачи.
- **Управление жизненным циклом**: мониторинг статуса активных деревьев, просмотр изменений перед слиянием, быстрое удаление и prune после перевода задачи в Done/Review.
- **Интеграция с PTY и Diff Viewer**: привязка терминальных вкладок к целевым worktrees и построчное ревью правок перед отправкой в основную ветку.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Реализован сервис worktreeService в Electron main-процессе с операциями list, add, remove, prune через simple-git
- [x] #2 Зарегистрированы типизированные IPC-хэндлеры git:worktree:* с обработкой ошибок и валидацией путей
- [x] #3 В UI на вкладке Git и в шапке добавлен селектор и панель управления активными Git Worktrees проекта
- [x] #4 В карточке задачи Backlog добавлено действие 'Открыть/создать Worktree' с автогенерацией ветки task/<id> и папки .worktrees/<id>
- [x] #5 Встроенный PTY-терминал поддерживает запуск вкладок Claude Code и Shell с cwd в директории соответствующего worktree
- [x] #6 Реализован интерфейс завершения задачи с просмотром диффа между worktree и базовой веткой и операцией безопасного слияния (Merge / PR)
- [x] #7 Папка .worktrees/ автоматически проверяется и добавляется в .gitignore при инициализации первого worktree
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Реализовать worktreeService в Electron с операциями list, add, remove, prune, merge, diff и автодобавлением .worktrees/ в .gitignore. 2. Зарегистрировать типизированные IPC-хэндлеры git:worktree:* с валидацией путей. 3. Расширить electron.d.ts и preload.ts. 4. Реализовать панель WorktreePanel и вкладку worktrees в GitInspector, а также селектор в Header. 5. Добавить действие создания/открытия Worktree в TaskDetailModal. 6. Поддержать cwd worktree в ptyService и бейджи в TerminalPanel. 7. Реализовать WorktreeCompleteModal для просмотра диффа и слияния. 8. Написать unit-тесты и выполнить npm test, npm run lint, npm run pack:win.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
1. Создан worktreeService.ts с операциями list, add, remove, prune, diff, merge и защитой .gitignore. 2. Добавлен игнор .worktrees в gitService. 3. Поддержаны PTY сессии с привязкой к worktree (cwd и worktreeBranch). 4. Зарегистрированы безопасные IPC-хэндлеры. 5. Создана панель управления WorktreePanel и модальное окно WorktreeCompleteModal. 6. Интегрировано создание worktree в TaskDetailModal. 7. Все 180 unit-тестов пройдены, ESLint 0 ошибок, pack:win собран успешно.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализован и всесторонне протестирован модуль Git Worktrees для параллельной изоляции задач и агентных сессий. Покрыты бэкенд-сервис, IPC, PTY-сессии, компоненты WorktreePanel, WorktreeCompleteModal, интеграция с доской задач и Header.
<!-- SECTION:FINAL_SUMMARY:END -->
