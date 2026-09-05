---
id: TASK-31
title: >-
  Совместимость записи задач из GUI с нативным форматом Backlog.md (маркеры
  секций, #N критерии, created_date)
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
labels:
  - audit
  - backlog
  - data-loss
  - P0
dependencies: []
references:
  - electron/main.ts
  - src/components/kanban/TaskDetailModal.tsx
  - src/store/useProjectStore.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 5.1 (doc-7).

Обработчики `backlog:saveFullTask`, `backlog:createTask`, `backlog:toggleCriterion`, `backlog:updateTaskStatus` в `main.ts` пишут файлы задач в собственном упрощённом формате. При сохранении из TaskDetailModal теряются маркеры `<!-- SECTION:DESCRIPTION:BEGIN/END -->`, `<!-- AC:BEGIN/END -->`, нумерация критериев `#N`, поля `type`, `priority`, `updated_date`, `assignee`, `ordinal`. `createTask` пишет `created` вместо `created_date` и id `task-N` вместо `TASK-N`. `toggleCriterion` нумерует все чекбоксы в файле, включая чекбоксы в описании, поэтому может переключить не тот пункт. `parseTaskDetails` включает префикс `#1 ` в текст критерия. Из-за этого правки через GUI ломают задачи для CLI/MCP/веб-интерфейса Backlog.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Чтение задач корректно извлекает описание из секции SECTION:DESCRIPTION и критерии из блока AC:BEGIN/AC:END без префикса #N
- [ ] #2 Сохранение задачи сохраняет все существующие поля frontmatter, маркеры секций и нумерацию критериев; проставляет updated_date
- [ ] #3 createTask создаёт файл в формате Backlog.md: id TASK-N, created_date, status, labels, type, секции с маркерами (либо вызывает backlog task create через CLI/MCP)
- [ ] #4 toggleCriterion меняет только пункты внутри блока AC:BEGIN/AC:END по индексу
- [ ] #5 Круговой тест: открыть задачу task-27 в GUI, изменить статус и критерий, сохранить; файл проходит backlog task view без ошибок и diff содержит только целевые изменения
<!-- AC:END -->
