---
id: TASK-38
title: >-
  Стор рендерера: лимит terminalLogs и линейный вывод в TerminalPanel, LRU для
  projectDataCache, локальное состояние при перетаскивании панели
status: Done
assignee: []
created_date: '2026-09-05 09:08'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - memory-leak
  - performance
  - ui
  - P1
dependencies: []
references:
  - src/store/useProjectStore.ts
  - src/components/terminal/TerminalPanel.tsx
  - src/types/electron.d.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - src/store/useProjectStore.ts
  - src/components/terminal/TerminalPanel.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - src/types/electron.d.ts
  - electron/preload.ts
  - electron/main.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 2.4, 2.5, 3.10 (doc-7).

`terminalLogs` в `useProjectStore` растёт без ограничения (`addTerminalLog` только добавляет), а `TerminalPanel` при каждом изменении делает `clear()` и заново пишет все строки в xterm (квадратичная стоимость). Git-вотчер и автосинхронизация задач пишут в этот лог при каждом изменении файла. `projectDataCache` никогда не вытесняется, а каждая `BacklogTask` хранит и `content`, и `description` (дубль полного текста файла). `handleMouseDown` в TerminalPanel обновляет `terminalHeight` в глобальном сторе на каждый `mousemove`, перерисовывая все вкладки xterm.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 terminalLogs ограничен (например, 500 записей) с отбрасыванием старых
- [x] #2 TerminalPanel в режиме системного лога дописывает только новые строки (хранит индекс последней записанной), полная перерисовка только при смене активного процесса
- [x] #3 projectDataCache очищается при deactivateProject/removeProjectFromCatalog и ограничен по числу проектов (LRU, например 10)
- [x] #4 Поле BacklogTask.content не дублирует description в списке задач (загружается по требованию в TaskDetailModal) либо хранится один раз
- [x] #5 Во время перетаскивания высоты панели используется локальный state/ref, в стор значение записывается на mouseup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

**Стор (`useProjectStore.ts`)**
- `MAX_TERMINAL_LOGS = 500`: `addTerminalLog` отбрасывает старые записи при переполнении.
- `MAX_CACHED_PROJECTS = 10` и хелпер `putProjectCache`: все записи в `projectDataCache` идут через него с LRU-вытеснением по `lastLoadedAt`. Сначала вытесняются проекты, не открытые во вкладках; текущий выбранный и только что записанный не вытесняются.
- `dropProjectCache`: запись удаляется в `deactivateProject` и `removeProjectFromCatalog`.
- `selectProject` при попадании в кэш обновляет `lastLoadedAt` (LRU «использование»).
- `loadProjectData` не воскрешает запись кэша, если проект закрыли, пока шла загрузка.

**TerminalPanel**
- Два эффекта вместо одного: полная перерисовка xterm только при смене `activeProcessId`/`terminalMode`/открытии панели; отдельный эффект дописывает только новые строки `terminalLogs` (индекс в `writtenLogCountRef`), при укорочении лога (очистка) — перерисовка с заголовком.
- Перетаскивание высоты: высота меняется напрямую через `panelRef.style.height` в `requestAnimationFrame`, в стор `setTerminalHeight` пишется один раз на `mouseup`. На время драга отключён CSS transition.

**BacklogTask.content**
- Поле стало опциональным; `backlog:getTasks` и `backlog:createTask` больше не возвращают сырой текст файла.
- Новый IPC `backlog:getTaskContent(filePath)` (с `assertInsideRegisteredProject`), в preload и `electron.d.ts` — `getTaskContent`.
- `TaskDetailModal` грузит сырой markdown лениво при открытии вкладки Raw, показывает `t.common.loading`, сбрасывает при смене задачи.

## Проверка
- `tsc --noEmit` для `tsconfig.json` и `tsconfig.node.json` — без ошибок.
- `npm run lint:docs` — ок.
- `npm run pack:win` — собрано `release/win-unpacked/ProjectHub.exe`.
<!-- SECTION:NOTES:END -->
