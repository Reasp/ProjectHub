---
id: TASK-31
title: >-
  Совместимость записи задач из GUI с нативным форматом Backlog.md (маркеры
  секций, #N критерии, created_date)
status: Done
assignee:
  - claude
created_date: '2026-09-05 09:07'
updated_date: '2026-09-05 20:48'
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
modified_files:
  - electron/services/backlogTaskFormat.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
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
- [x] #1 Чтение задач корректно извлекает описание из секции SECTION:DESCRIPTION и критерии из блока AC:BEGIN/AC:END без префикса #N
- [x] #2 Сохранение задачи сохраняет все существующие поля frontmatter, маркеры секций и нумерацию критериев; проставляет updated_date
- [x] #3 createTask создаёт файл в формате Backlog.md: id TASK-N, created_date, status, labels, type, секции с маркерами (либо вызывает backlog task create через CLI/MCP)
- [x] #4 toggleCriterion меняет только пункты внутри блока AC:BEGIN/AC:END по индексу
- [x] #5 Круговой тест: открыть задачу task-27 в GUI, изменить статус и критерий, сохранить; файл проходит backlog task view без ошибок и diff содержит только целевые изменения
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Вынести формат файлов задач в новый модуль `electron/services/backlogTaskFormat.ts` (чистые функции, без Electron):
   - `parseTaskBody(content)` — описание из `<!-- SECTION:DESCRIPTION:BEGIN/END -->` (fallback: секция `## Description` без маркеров, для legacy-файлов task-1..task-27 старого формата), критерии из `<!-- AC:BEGIN/END -->` (fallback: чекбоксы секции `## Acceptance Criteria`), префикс `#N ` отбрасывается.
   - `applyDescription(content, text)` / `applyCriteria(content, criteria)` — точечная замена содержимого между маркерами; если маркеров нет, но есть заголовок — заменяется тело секции и добавляются маркеры; если секции нет — она добавляется. Остальные секции (Plan, Notes, Final Summary, Comments, произвольные) не трогаются. Критерии всегда нумеруются `#1..#N`.
   - `toggleCriterionInContent(content, index, completed)` — переключение только внутри AC-блока по индексу.
   - `buildNewTaskFile(...)` — файл в формате Backlog.md: `id: TASK-N`, `title`, `status`, `assignee: []`, `created_date: 'YYYY-MM-DD HH:mm'` (UTC, как у CLI), `labels`, `dependencies: []`, секции с маркерами. Имя файла `task-N - Title-with-dashes.md`, как у CLI.
   - `nowBacklogTimestamp()` и `normalizeFrontmatter(data)` — Date-объекты (незакавыченные даты в YAML) приводятся к строкам перед записью (правило 16), чтобы js-yaml не выписал ISO-таймстамп.
2. `main.ts`: `backlog:getTasks` использует новый парсер; `saveFullTask` изменяет только title/status/labels/milestone + description/AC в теле, сохраняя все остальные поля frontmatter и проставляя `updated_date`; `updateTaskStatus` тоже проставляет `updated_date`; `toggleCriterion` — через AC-блок; `createTask` — новый формат. Определение следующего номера — по максимуму `task-N` в именах файлов (как сейчас), id в верхнем регистре.
3. Проверка: скрипт в scratchpad, прогоняющий функции модуля на всех 44 файлах `backlog/tasks` (round-trip без изменений: applyDescription/applyCriteria с распарсенными значениями должны дать байт-в-байт тот же файл для нативных задач); `tsc`; `npm run build`; `npm run pack:win`; круговой тест на task-27 через IPC-логику (изменить статус и критерий, затем `npx backlog.md task view 27` и `git diff`).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Верификация (2026-09-05).** Модуль `electron/services/backlogTaskFormat.ts` скомпилирован в scratchpad (`tsc --ignoreConfig`) и прогнан скриптом по всем 44 файлам `backlog/tasks` с реальным `gray-matter`:
- 31 нативный файл (с маркерами SECTION/AC): parse → applyDescription → applyCriteria → matter.stringify даёт **байт-в-байт** исходный файл (nativeBad=0). Ни у одного критерия в тексте не остался префикс `#N`, описание извлечено у всех 44 файлов.
- 13 legacy-файлов (task-1..task-26 старого формата, без маркеров): описание и чекбоксы читаются через fallback по заголовкам `## Description`/`## Acceptance Criteria`; при первой записи из GUI добавляются маркеры и нумерация `#1..#N`, frontmatter (`created`, `labels`) сохраняется.
- Чекбокс внутри описания не считается критерием ни при чтении, ни при toggle.
- Файл без секций: пустые description/criteria не добавляют секций; непустые — добавляются в нативном формате.
- Удаление критерия перенумеровывает остальные.
- `normalizeFrontmatter`: `Date` → `'2026-09-03'` / `'2026-09-05 15:31'` (в т.ч. внутри списков); `withUpdatedDate` вставляет `updated_date` сразу после `created_date`.

**Круговой тест task-27 (AC #5)** — та же логика, что в обработчике `backlog:saveFullTask` (статус Review → In Progress, критерий #2 снят, описание/критерии/заголовок как прочитаны): `npx backlog.md task view 27 --plain` — exit 0, показывает новый статус и снятый #2; `git diff` файла содержит ровно 3 строки: `status`, `updated_date`, строка `#2`. Файл затем возвращён через `git checkout`.

`tsc --noEmit -p tsconfig.node.json` — 0 ошибок, `npm run build` (lint:docs + tsc + vite) — успешно.

**Решения по реализации.** (1) Формат вынесен в чистый модуль без Electron/fs — main.ts только читает/пишет файлы; это же позволило прогнать тесты без запуска приложения. (2) Запись — точечная замена содержимого между маркерами, а не пересборка тела: секции Plan/Notes/Final Summary/Comments и произвольные остаются нетронутыми. (3) `updateTaskStatus` и `toggleCriterion` тоже проставляют `updated_date` (как `backlog task edit`). (4) `parseTaskFile` копирует `parsed.data` — gray-matter кэширует результат по строке, мутация ломала бы кэш; EOL файла (CRLF/LF) сохраняется. (5) `createTask`: id `TASK-N`, `created_date` в UTC `YYYY-MM-DD HH:mm`, `assignee: []`, `dependencies: []`, `type` (по умолчанию `task`), опциональные `priority`/`milestone` в сигнатуре IPC/preload/типов (UI создания задачи не менялся); следующий номер — максимум по `tasks/`, `completed/`, `drafts/`, `archive/tasks/`, как у CLI; запись с флагом `wx`. (6) Исправлен побочный баг: id из имени файла раньше брался как `basename.split('-')[0]` → `task` для файлов без `id` во frontmatter; теперь `TASK-N`. (7) Для файлов без `## Description` описание теперь пустое (раньше подставлялось всё тело файла, что при сохранении дублировало содержимое).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано

Устранён пункт аудита 5.1 (doc-7): правки задач из GUI больше не ломают файлы для CLI/MCP/веб-интерфейса Backlog.md.

**Новый модуль `electron/services/backlogTaskFormat.ts`** (чистые функции, без Electron):
- `parseTaskBody` — описание из `SECTION:DESCRIPTION`, критерии из `AC:BEGIN/END` без префикса `#N`; fallback по заголовкам для legacy-файлов.
- `applyDescription` / `applyCriteria` — точечная замена внутри маркеров (маркеры добавляются legacy-файлам), перенумерация `#1..#N`; остальные секции (Plan, Notes, Final Summary, Comments) не трогаются.
- `toggleCriterionInContent` — только внутри блока критериев.
- `buildTaskBody`, `sanitizeTaskFileTitle`, `taskNumberFromName`, `nowBacklogTimestamp` (UTC `YYYY-MM-DD HH:mm`), `normalizeFrontmatter` (Date → строка, правило 16), `withUpdatedDate`.

**`electron/main.ts`** — `parseTaskDetails` заменён на модуль; `getTasks` предпочитает `created_date`, id из имени файла даёт `TASK-N` (раньше — `task`); `updateTaskStatus`, `toggleCriterion`, `saveFullTask` сохраняют все поля frontmatter, EOL файла и проставляют `updated_date`; `createTask` пишет нативный формат (`TASK-N`, `created_date`, `assignee: []`, `dependencies: []`, `type`, секции с маркерами), номер — максимум по `tasks/`, `completed/`, `drafts/`, `archive/tasks/`, запись с `wx`.

**`electron/preload.ts`, `src/types/electron.d.ts`** — у `createTask` добавлены опциональные `type`, `priority`, `milestone`.

## Проверка
- Round-trip по всем 44 файлам `backlog/tasks`: 31 нативный — байт-в-байт, 13 legacy — читаются, при записи приводятся к нативному формату (см. Implementation Notes).
- Круговой тест task-27 (AC #5): `backlog task view 27` — ок, diff ровно 3 целевые строки; файл возвращён.
- `tsc` — 0 ошибок; `npm run build` и `npm run pack:win` — успешно, `release/win-unpacked/ProjectHub.exe` обновлён (2026-09-05 23:07 локального времени).

## Риски / follow-up
- GUI проверен на уровне логики обработчиков, не кликами в приложении: при ручной проверке стоит открыть любую задачу в ProjectHub, изменить критерий и убедиться в diff.
- Legacy-файлы (task-1..task-26) при первом сохранении из GUI получат маркеры и `#N` — ожидаемое приведение к формату, но diff у них будет больше трёх строк.
- Форма создания задачи по-прежнему не передаёт `type`/`priority` — пишется `type: task`; расширение формы вне scope.
<!-- SECTION:FINAL_SUMMARY:END -->
