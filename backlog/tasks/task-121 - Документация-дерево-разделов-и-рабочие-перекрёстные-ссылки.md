---
id: TASK-121
title: 'Документация: дерево разделов и рабочие перекрёстные ссылки'
status: Review
assignee: []
created_date: '2026-10-01 10:43'
updated_date: '2026-10-01 11:04'
labels:
  - ui
  - backlog
dependencies: []
modified_files:
  - src/utils/docRefs.ts
  - src/utils/docTree.ts
  - src/hooks/useDocRefs.ts
  - src/components/docs/DocsTree.tsx
  - src/components/docs/DocsRagView.tsx
  - src/components/docs/CreateDocModal.tsx
  - src/components/docs/MemoryView.tsx
  - src/components/common/MarkdownViewer.tsx
  - src/components/kanban/KanbanBoard.tsx
  - src/store/useProjectStore.ts
  - src/types/electron.d.ts
  - electron/services/docsService.ts
  - scripts/validate-docs.mjs
  - infra-dev.md
priority: medium
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Почему

Во вкладке «Документация» 77 документов (67 решений и 10 документов) лежат одним плоским списком, отсортированным по названию. Ссылки вида `[[decision-46]]` показываются сырым текстом с квадратными скобками и не открываются.

### Цель

- Список документов — дерево: «Решения (ADR)» и «Документы», внутри разделы и подразделы.
- `[[decision-N]]`, `[[doc-N]]`, `[[TASK-N]]`, `[[mem-N]]` в просмотре Markdown — рабочие ссылки. Упоминания без скобок (`decision-46`, `TASK-103`) — тоже, если объект существует.

### Ограничения

- Backlog.md CLI 1.53 не видит решения во вложенных папках и стирает неизвестные поля frontmatter при `doc update` (проверено на временном проекте). Формат раздела выбирается с учётом этого и фиксируется ADR.
- Файлы документов не переносятся: на их пути ссылаются задачи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Список документов показывается деревом: группы «Решения (ADR)» и «Документы», внутри разделы и подразделы, узлы сворачиваются
- [x] #2 Поиск и фильтр категорий работают поверх дерева, найденные документы видны без ручного раскрытия
- [x] #3 [[decision-N]], [[doc-N]] в просмотре документа открывают соответствующий документ, есть возврат назад
- [x] #4 [[TASK-N]] открывает карточку задачи, ссылка на несуществующий объект помечена и не кликается
- [x] #5 Ссылки работают и в описании задачи (TaskDetailModal)
- [x] #6 Все существующие решения и документы проекта разнесены по разделам
- [x] #7 lint:docs проверяет наличие раздела, когда проект использует разделы
- [x] #8 Разбор ссылок и построение дерева покрыты unit-тестами
- [x] #9 ADR о формате раздела и ссылок, правила infra-dev.md обновлены
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Что сделано

- **Раздел документа**: поле `section` frontmatter, иначе вложенная папка (`docsService`, `src/utils/docTree.ts`). Формат и причины — decision-68.
- **Дерево**: `DocsTree.tsx` вместо плоского списка в `DocsRagView`; раскрытые узлы хранятся в `localStorage`, поиск раскрывает дерево, ветка выбранного документа раскрывается сама. В окне создания документа появилось поле «Раздел» с подсказками; окно переведено на `createPortal` (decision-17).
- **Ссылки**: разбор в `src/utils/docRefs.ts`, данные и переходы в `useDocRefs`, отрисовка в `MarkdownViewer`. `[[id]]`, `[[id|подпись]]`, упоминания без скобок (только существующие объекты), относительные ссылки на файлы `decision-N - ….md`. Журнал переходов и кнопка «Назад» — в сторе (`docBackStack`).
- **Документы проекта**: 67 решений разнесены по 16 разделам, 10 документов — по 5.
- **Линтер** (`scripts/validate-docs.mjs`): тип `section`, обязательность раздела в проекте с разделами, битые `[[decision-N]]`/`[[doc-N]]`.
- **Правила**: в правило 13 `infra-dev.md` добавлены пункты о разделе и ссылках, `npm run sync-rules` выполнен.

### Проверка

- `npm run pack:win`: ESLint 0 ошибок, 198 файлов / 2300 тестов, check-bundle. Новые тесты: `docRefs`, `docTree`, `docsServiceSection`.
- Живое окно (свежий `dist-electron` через `electron.exe`, отдельный userData, английский интерфейс): дерево из 25 узлов и 78 документов; поиск `decision-47`; в decision-47 13 ссылок, сырых `[[` в просмотре 0; клик по `[[decision-46]]` открыл решение и выделил его в дереве, «Назад» вернул; клик по `TASK-101` открыл карточку задачи, ссылки в её описании тоже отрисованы.

### Не проверено

- `release/win-unpacked/ProjectHub.exe` не обновлён: файл занят запущенным приложением владельца. Нужно закрыть ProjectHub и повторить `npm run pack:win`.
- Переход по `[[mem-N]]` в живом окне не проверялся: в проекте нет каталога `backlog/memory`.
- Вид ссылки на несуществующий объект в окне не снимался (в документах проекта таких ссылок нет); логика покрыта разбором и условием в `DocRefLink`.
<!-- SECTION:NOTES:END -->
