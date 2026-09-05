---
id: TASK-38
title: >-
  Стор рендерера: лимит terminalLogs и линейный вывод в TerminalPanel, LRU для
  projectDataCache, локальное состояние при перетаскивании панели
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
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
- [ ] #1 terminalLogs ограничен (например, 500 записей) с отбрасыванием старых
- [ ] #2 TerminalPanel в режиме системного лога дописывает только новые строки (хранит индекс последней записанной), полная перерисовка только при смене активного процесса
- [ ] #3 projectDataCache очищается при deactivateProject/removeProjectFromCatalog и ограничен по числу проектов (LRU, например 10)
- [ ] #4 Поле BacklogTask.content не дублирует description в списке задач (загружается по требованию в TaskDetailModal) либо хранится один раз
- [ ] #5 Во время перетаскивания высоты панели используется локальный state/ref, в стор значение записывается на mouseup
<!-- AC:END -->
