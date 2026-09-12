---
id: TASK-67
title: Сброс экрана проекта при переключении между проектами
status: Review
assignee: []
created_date: '2026-09-12 03:41'
updated_date: '2026-09-12 03:42'
labels: []
dependencies: []
modified_files:
  - src/store/useProjectStore.ts
  - src/components/projects/ProjectWorkspace.tsx
  - src/i18n/en.ts
  - src/i18n/ru.ts
  - src/i18n/types.ts
  - tests/unit/projectScopedState.test.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
При переключении проекта данные предыдущего оставались на экране до окончания загрузки нового: пользователь видел задачи, коммиты, доки и PR того проекта, с которого только что ушёл, и это сбивало с толку. Причина — `selectProject` менял только `selectedProject`, а `tasks`/`gitLogs`/`docsList`/`milestones`/`processes`/`prs` перезаписывались лишь после ответа IPC. Дополнительно поздние ответы `fetchDocs`/`fetchMilestones`/`fetchProcesses`/`fetchPRs`/`loadGitRepoDetails` по уже покинутому проекту могли перетереть данные нового.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При смене проекта проектное состояние стора очищается сразу (задачи, git-логи, детали репозитория, доки, майлстоуны, процессы, PR, фильтры по метке и майлстоуну)
- [x] #2 Пока данные нового проекта грузятся, в рабочей области показывается индикатор загрузки вместо пустого или чужого экрана
- [x] #3 Вкладки рабочей области перемонтируются при смене проекта — локальное состояние вью (поиск, открытая карточка задачи, выбранный файл диффа) не переносится
- [x] #4 Поздние ответы IPC по уже покинутому проекту не попадают в стор
- [x] #5 npm run lint (0 ошибок), npm test и npm run lint:docs проходят
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
1. `src/store/useProjectStore.ts`:
   - добавлен экспортируемый `emptyProjectScopedState()` — единый источник «проектного» состояния, и `clearPersistedTaskFilters()` для чистки фильтров в localStorage;
   - `selectProject` при смене проекта сбрасывает это состояние сразу, до IPC; ветка без кэша выставляет `isProjectDataLoading: true` (в кэш-ветке индикатор не нужен — данные подставляются мгновенно);
   - `loadProjectData` снимает флаг в `finally`, только если проект всё ещё выбран;
   - тот же сброс переиспользован в `selectProject(null)` и `deactivateProject`;
   - `fetchDocs`, `fetchMilestones`, `fetchProcesses`, `fetchPRs`, `fetchPRProviderInfo`, `loadGitRepoDetails` проверяют актуальность проекта **после** await и игнорируют поздние ответы.
2. `src/components/projects/ProjectWorkspace.tsx`: контейнер вкладок получил `key={selectedProject?.path}` (перемонтирование вью) и оверлей загрузки `z-20` внутри `relative`-контейнера — уровень локальный, шкалу модалок по decision-17 не нарушает.
3. i18n: ключ `tabs.loadingProject` (ru/en/types).
4. Тест `tests/unit/projectScopedState.test.ts`: покрытие ключей сброса, пустота значений, отсутствие общих ссылок между вызовами.

Проверено: `npx tsc --noEmit` чисто, `npm run lint` — 0 ошибок (509 warnings — прежний baseline), `npm test` — 608 тестов зелёные, `npm run lint:docs` — ок.
<!-- SECTION:NOTES:END -->
