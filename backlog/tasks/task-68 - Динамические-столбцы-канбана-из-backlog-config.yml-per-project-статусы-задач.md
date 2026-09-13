---
id: TASK-68
title: Динамические столбцы канбана из backlog/config.yml (per-project статусы задач)
status: Review
assignee: []
created_date: '2026-09-13 12:34'
updated_date: '2026-09-13 13:01'
labels:
  - ui
  - backlog
  - kanban
dependencies: []
references:
  - src/components/kanban/KanbanBoard.tsx
  - src/components/kanban/TaskListView.tsx
  - src/types/electron.d.ts
  - electron/ipc/backlogIpc.ts
  - electron/services/projectScanner.ts
  - src/components/analytics/ProjectAnalyticsView.tsx
  - src/components/analytics/ProjectAnalyticsModal.tsx
  - backlog/config.yml
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Проблема

Набор столбцов доски задач и допустимых статусов зашит в код ProjectHub, а `statuses` из `backlog/config.yml` открываемого проекта не читается вообще. Если пользователь перенастроил канбан в Backlog.md (добавил, например, `Blocked` или `Testing`), ProjectHub этого не покажет.

Хуже: фильтрация задач по столбцу — строгое равенство `(task.status || 'To Do') === col.status` (`src/components/kanban/KanbanBoard.tsx:325`), поэтому задача с кастомным статусом **не попадает ни в один столбец и молча исчезает с доски**. В табличном виде она видна, но `<select>` содержит только четыре захардкоженных варианта, и первое же изменение статуса через GUI перезаписывает кастомный статус.

## Где именно захардкожено

- `src/components/kanban/KanbanBoard.tsx:46-52` — массив `columns` из четырёх литералов (`To Do`, `In Progress`, `Review`, `Done`) с цветами и ключами перевода.
- `src/types/electron.d.ts:146` — `BacklogTask.status` как union-тип из этих четырёх строк; в местах присвоения — `as any` (`electron/ipc/backlogIpc.ts:79`).
- `electron/services/projectScanner.ts:211-220` — `backlog/config.yml` читается регуляркой, из него извлекается только `project_name`; ключи `statuses` / `default_status` игнорируются.
- `electron/services/projectScanner.ts:225+` — счётчики задач для карточки проекта (`todo`/`inProgress`/`review`/`done`) по тем же четырём статусам.
- `src/components/kanban/TaskListView.tsx:95-98` — `<option>` статусов прописаны руками; `getStatusBadge` (строка 28) — `switch` по четырём значениям.
- `src/components/analytics/ProjectAnalyticsView.tsx:44-47` и `ProjectAnalyticsModal.tsx:42-45` — метрики фильтруют по литералам статусов.

## Предлагаемое решение

1. Отдельный сервис чтения конфига Backlog.md (`electron/services/backlogConfigService.ts`) — парсинг `backlog/config.yml` настоящим YAML-парсером (`yaml`/`gray-matter` уже в зависимостях) вместо регулярки; извлекать `statuses`, `default_status`, при необходимости `task_prefix`. Значения приводить к строкам (правило 16 CLAUDE.md — защита от объектов `Date` и прочих не-строк во frontmatter/конфиге).
2. Прокинуть набор статусов в рендерер через IPC и хранить в `useProjectStore` вместе с остальными данными проекта; перечитывать при переключении проекта (см. сброс состояния из task-67).
3. `KanbanBoard` строит `columns` из полученного списка: цвет — детерминированной палитрой, но для четырёх известных статусов сохранить текущие цвета и локализованные подписи (`t.kanban.*`); кастомные статусы показывать как есть, без перевода (правило 11).
4. `TaskListView` — `<select>` и бейджи из того же списка.
5. `projectScanner` — счётчики по динамическому набору статусов; в UI карточки проекта сохранить нынешние четыре плюс агрегат «прочие», чтобы не ломать вёрстку.
6. Аналитика — метрики по динамическому набору; «завершено» определять по последнему статусу из `statuses` либо по `Done`, если он есть.
7. Тип `BacklogTask.status` — `string` (с сохранением известных значений как подсказок в JSDoc или через `(string & {})` union), убрать `as any` в `backlogIpc`.
8. Fallback на текущие четыре статуса, если `config.yml` отсутствует, не парсится или `statuses` пуст.
9. ADR в `backlog/decisions/` (правило 18): источник истины по составу статусов — `backlog/config.yml` проекта, а не код ProjectHub; зафиксировать правило маппинга цветов и локализации.
10. Unit-тесты (`tests/unit/`) на парсер конфига: нормальный список, отсутствие файла, битый YAML, пустой `statuses`, статусы с не-ASCII и пробелами, дубликаты.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Состав столбцов канбана берётся из `statuses` в `backlog/config.yml` открытого проекта; добавленный в конфиг статус появляется отдельным столбцом без правок кода
- [x] #2 Задача с кастомным статусом отображается в своём столбце и не исчезает с доски; при отсутствии совпадения статус не теряется, а задача попадает в столбец по `default_status` с визуальной пометкой
- [x] #3 Смена статуса через `<select>` в табличном виде и через drag-n-drop на доске предлагает только статусы из конфига и не перезаписывает кастомные значения
- [x] #4 Счётчики задач на карточке проекта и метрики в аналитике считаются по динамическому набору статусов, задачи с нестандартным статусом учитываются в общем количестве
- [x] #5 При отсутствии `backlog/config.yml`, битом YAML или пустом `statuses` используется fallback `To Do` / `In Progress` / `Review` / `Done`, ошибка не всплывает в UI и не роняет main-процесс
- [x] #6 Для четырёх стандартных статусов сохранены прежние цвета и локализованные подписи; кастомные статусы выводятся как есть, без перевода
- [x] #7 Тип `BacklogTask.status` допускает произвольную строку, приведения `as any` в `electron/ipc/backlogIpc.ts` убраны
- [x] #8 Unit-тесты в `tests/unit/` покрывают парсер конфига: валидный список, нет файла, битый YAML, пустой `statuses`, дубликаты, не-ASCII значения
- [x] #9 Создан ADR в `backlog/decisions/` о `backlog/config.yml` как источнике истины по статусам, выполнен `npm run index-docs`
- [x] #10 `npm run lint`, `npm test`, `npm run lint:docs` и `npm run pack:win` проходят
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**Новое**
- `src/utils/taskStatus.ts` — общий чистый модуль (main + renderer, как `src/utils/assignee.ts`):
  нормализация и нестрогое сопоставление статусов, `countStatuses`/`toLegacyTaskCounts`,
  палитра (`statusVisual`, `OTHER_STATUS_VISUAL`), подписи (`statusLabel`, `statusGlyph`),
  `statusOptions`, `fallbackStatusConfig`.
- `electron/services/backlogConfigService.ts` — разбор `backlog/config.yml` настоящим YAML
  (`gray-matter`/js-yaml, свои разделители вместо `---`), извлекает `statuses`, `default_status`,
  `project_name`, `task_prefix`; все значения приводятся к строкам (правило 16). Любая ошибка →
  fallback из четырёх статусов.
- IPC `backlog:getConfig` + `window.api.getBacklogConfig`.

**Изменено**
- `useProjectStore`: поле `backlogConfig` (проектное — сброс при смене проекта, входит в
  `ProjectCachedData`), грузится в `loadProjectData` вместе с задачами.
- `KanbanBoard`: колонки строятся из `statuses`, сетка динамическая (`repeat(n, minmax(240px,1fr))`
  + горизонтальная прокрутка), раскладка через `Map`, задача с неизвестным статусом падает в
  колонку `default_status` с амберной пометкой её статуса. Правило 5 обобщено.
- `TaskListView` / `TaskDetailModal`: `<option>` из конфига; текущий кастомный статус остаётся
  в списке и не перезаписывается.
- `projectScanner`: регулярка заменена сервисом; счётчики карточки — динамические, добавлено
  поле `taskCounts.other` (сумма полей всегда равна `total`); в сайдбаре — амберный агрегат.
- Аналитика (view + modal): строки распределения циклом по `statuses` + «прочие»;
  «завершено» = `Done` или последний статус набора.
- `BacklogTask.status` → `... | (string & {})`, `as any` в `backlogIpc` убран.
- i18n (en/ru/types): `kanban.unknownStatusHint`, `kanban.otherStatuses`,
  `sidebar.otherStatusesTooltip`.

**Тесты**: `tests/unit/backlogConfigService.test.ts` (13 кейсов: валидный/блочный список, нет
файла, битый YAML, пустой и нелистовой `statuses`, дубликаты, не-ASCII, Date/число/boolean,
`default_status` вне набора и в другом регистре, строка `---` внутри конфига),
`tests/unit/taskStatus.test.ts` (16 кейсов), новый кейс в `projectScanner.test.ts`,
обновлён `projectScopedState.test.ts`.

**ADR**: `decision-24` (accepted), `npm run index-docs` выполнен.

**Проверки**: `npm run lint` — 0 ошибок, 504 предупреждения (baseline был 509);
`npm test` — 638 passed; `npm run lint:docs` — ок; `npm run pack:win` — собрано в
`release/win-unpacked/ProjectHub.exe`.

**Оставлено за рамками (зафиксировано в decision-24 как долг)**: жёстко зашитые имена статусов
в `prService` (перевод в Review при PR), `assignedTaskRules`, `milestoneService`,
`remoteControlService`.
<!-- SECTION:NOTES:END -->
