---
id: TASK-32
title: >-
  Ограничение путей в IPC (docs, backlog, milestones) и записи агента корнем
  проекта
status: Done
assignee: []
created_date: '2026-09-05 09:07'
updated_date: '2026-09-06 00:19'
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
modified_files:
  - electron/services/pathGuard.ts
  - electron/services/projectPathGuard.ts
  - electron/services/fileService.ts
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/main.ts
  - tests/unit/pathGuard.test.ts
  - tests/unit/fileService.test.ts
  - vitest.config.ts
  - package.json
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
- [x] #1 Введена общая функция assertInsideProject(projectPath, filePath), использующая path.relative и запрещающая выход за корень (включая случай префикса без разделителя)
- [x] #2 Все IPC-обработчики, принимающие абсолютный путь, проверяют, что путь лежит внутри одного из проектов реестра, иначе возвращают ошибку
- [x] #3 applyDiff и write_file отклоняют пути вне projectPath (абсолютные пути вне проекта и ../) с сообщением агенту
- [x] #4 validateSafePath в fileService исправлен и покрыт unit-тестом на кейс соседней папки с общим префиксом
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

**Новый модуль `electron/services/pathGuard.ts`** (чистый, только `node:path`, покрыт unit-тестами):
- `isInsideProject(projectPath, target)` — через `path.relative`; отклоняет `..`, другой диск, префикс без разделителя (`App` vs `App2`), NUL-байт, пустые/не-строковые значения. На Windows/macOS сравнение без учёта регистра.
- `assertInsideProject(projectPath, filePath)` — возвращает абсолютный путь или бросает `PathOutsideProjectError`.
- `findOwningProject(roots, filePath)` — владелец пути среди реестра, при вложенных проектах выбирает самый глубокий корень.
- `isRegisteredProjectRoot(roots, candidate)` — точное совпадение с корнем реестра.

**`electron/services/projectPathGuard.ts`** — обвязка над реестром: `assertInsideRegisteredProject(filePath)` и `assertRegisteredProject(projectPath)`. Реестр — единственный доверенный источник корней (сканирование тоже регистрирует найденные проекты, см. `scanDirectories`).

**IPC в `main.ts`**: `backlog:updateTaskStatus/toggleCriterion/saveFullTask/deleteTask/saveTask`, `docs:read/save`, `milestones:save/delete` проверяют абсолютный `filePath` по реестру; `backlog:createTask`, `docs:create`, `milestones:create`, `files:*`, `file:*` проверяют, что `projectPath` — зарегистрированный корень. Нарушение — исключение (в рендерере вызовы уже обёрнуты в try/catch).

**Агент**: `aiAgentService.applyDiff` использует `assertInsideProject` (абсолютные пути и `../` вне проекта отклоняются даже при auto-approve); предпросмотр diff не читает файлы вне проекта. В `claudeBridgeService` ветка `write_file` до любых одобрений отклоняет путь вне проекта со статусом `rejected` и сообщением модели, как исправить.

**`fileService.validateSafePath`** переведён на `assertInsideProject`, `readTree` — на `isInsideProject`.

**Тесты**: добавлен `vitest` (devDependency), `vitest.config.ts` (отдельный от `vite.config.ts`, чтобы не тянуть плагин electron), `npm test`. 17 тестов: `tests/unit/pathGuard.test.ts`, `tests/unit/fileService.test.ts` (регрессия на соседнюю папку с общим префиксом через абсолютный путь и `../`).

## Проверено
`npm test` — 17/17, `tsc --noEmit` — ок, `npm run lint:docs` — ок, `npm run pack:win` — собрано.

## Вне объёма (для отдельных задач)
- `git:*` обработчики берут `projectPath` без проверки по реестру (в т.ч. `git:discardFileChanges`).
- `backlog:getTasks`, `docs:list`, `milestones:list`, `backlog:watchProject` — read-only перечисление по `projectPath`, оставлены без проверки, чтобы не ломать восстановление активных вкладок для проектов, удалённых из реестра.
- В режиме Claude CLI запись делает сам CLI (см. TASK-42).
- Встроенный MCP-сервер вызывает `fileService` напрямую с `projectPath` от внешнего агента — защита только на уровне `validateSafePath`.
<!-- SECTION:NOTES:END -->
