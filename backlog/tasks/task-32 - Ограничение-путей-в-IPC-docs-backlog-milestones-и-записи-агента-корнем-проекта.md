---
id: TASK-32
title: >-
  Ограничение путей в IPC (docs, backlog, milestones) и записи агента корнем
  проекта
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
labels:
  - audit
  - security
  - electron
  - P1
dependencies: []
references:
  - electron/main.ts
  - electron/services/fileService.ts
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/docsService.ts
  - electron/services/milestoneService.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 4.5, 4.6, 4.7 (doc-7).

Обработчики `docs:read`, `docs:save`, `backlog:updateTaskStatus`, `backlog:saveFullTask`, `backlog:deleteTask`, `backlog:saveTask`, `milestones:save/delete` принимают абсолютный `filePath` от рендерера без проверки принадлежности зарегистрированному проекту. `aiAgentService.applyDiff` и ветка `write_file` в `claudeBridgeService` принимают абсолютный путь от модели и при auto-approve пишут в любое место диска. `fileService.validateSafePath` сравнивает `resolved.startsWith(root)` без разделителя, поэтому `C:\Projects\App` пропускает `C:\Projects\App2\...`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Введена общая функция assertInsideProject(projectPath, filePath), использующая path.relative и запрещающая выход за корень (включая случай префикса без разделителя)
- [ ] #2 Все IPC-обработчики, принимающие абсолютный путь, проверяют, что путь лежит внутри одного из проектов реестра, иначе возвращают ошибку
- [ ] #3 applyDiff и write_file отклоняют пути вне projectPath (абсолютные пути вне проекта и ../) с сообщением агенту
- [ ] #4 validateSafePath в fileService исправлен и покрыт unit-тестом на кейс соседней папки с общим префиксом
<!-- AC:END -->
