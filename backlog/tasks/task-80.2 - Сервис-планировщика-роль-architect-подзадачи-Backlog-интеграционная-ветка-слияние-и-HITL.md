---
id: TASK-80.2
title: >-
  Сервис планировщика: роль architect, подзадачи Backlog, интеграционная ветка,
  слияние и HITL
status: Done
assignee: []
created_date: '2026-09-20 01:59'
updated_date: '2026-09-21 02:08'
labels:
  - swarm
  - planning
  - backlog
  - git
dependencies:
  - TASK-80.1
parent_task_id: TASK-80
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-49 п. 1, 4–6. `planService.ts` + `planStore.ts`: промпт роли architect и один ход модели (как у ревьюера арены), повтор при невалидном плане (до 3 попыток), создание подзадач через `createBacklogTaskFile` (parentTaskId, dependencies, критерии, milestone родителя), секция `## Implementation Plan` в родителе, пересчёт графа из файлов задач перед каждым решением, интеграционная ветка `plan/<taskId>` со своим worktree, запуск узлов через `startDoneLoop` с `baseBranch = plan/<taskId>`, слияние `git merge --no-ff` внутри интеграционного worktree, конфликт → `merge --abort` + HITL-карточка с диффом, сводка и `Review` у родителя. IPC, preload, типы, зеркало в `src/types/electron.d.ts`. Тесты на настоящем AgentFleetService во временном git-репозитории.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Роль architect возвращает план, из которого создаются подзадачи в backlog/tasks с parentTaskId и dependencies
- [x] #2 Узлы запускаются параллельно в своих worktree в режиме «до готовности» от интеграционной ветки, с лимитом параллельности и общим бюджетом
- [x] #3 Завершённый узел сливается в интеграционную ветку без правок основного дерева; конфликт уходит в HITL с диффом, зависимые не стартуют
- [x] #4 Провал узла блокирует зависимых и уведомляет; родительская задача получает сводку и статус Review, Done не ставится
- [x] #5 Запуск только после явного утверждения плана; изменённый после утверждения граф требует повторного подтверждения
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-49 п. 1, 4–6.

**Зонд до реализации** (временный тест на настоящем `AgentFleetService`, удалён; факты — в Context decision-49): параллельные done-loop-сессии по одному проекту уже работают (свои worktree, ветки, бюджеты, события шины); `worktreeService.mergeWorktree` для интеграционной ветки не годится — он чекаутит целевую ветку в основном дереве, не возвращает исходную при успехе и отказывается сливать в ветку, занятую worktree; слияние внутри worktree интеграционной ветки работает, конфликт виден по `--diff-filter=U`, `merge --abort` чистит состояние.

- `planStore.ts` — `<userData>/plans/<planId>.json`, атомарная запись, троттлинг, миграция, ключи провайдеров в файл не пишутся.
- `planService.ts` — генерация плана (ход роли `architect` как у ревьюера арены: `resolveSlotProviderConfig` + `streamChat` с инструментами чтения/поиска, таймаут 5 мин), до 3 попыток с замечаниями, создание подзадач через `createBacklogTaskFile`, секция `## Implementation Plan` в родителе, `refreshGraph` из файлов задач перед каждым решением, интеграционная ветка `plan/<taskId>` со своим worktree, запуск узлов через `startDoneLoop` с `baseBranch = plan/<taskId>`, слияние `git merge --no-ff` внутри интеграционного worktree, конфликт → `merge --abort` + HITL-вопрос с файлами и диффом, итог с `## Final Summary` и статусом Review (Done — никогда).
- `backlogTaskCreate` расширен: `parentTaskId` (нумерация `TASK-<parent>.<n>`, `parent_task_id` в frontmatter), `dependencies`, `acceptanceCriteria`.
- IPC `plan:generate|list|getForTask|approve|stop|skipNode|resolveConflict|discard`, событие `plan:event`, preload, зеркало типов; `planService.init()` в `main.ts` (узлы прерванных сессий возвращаются в очередь), `flush()` при выходе; `swarm:finished` получил режим `plan`.
- **Исправлено попутно**: `taskIdToFilePrefix` сводил `TASK-80.1` к `task-80`, и done-loop подзадачи мог работать с файлом родителя; `detectBaseBranch` игнорировал явно переданную ветку. Оба места покрыты тестами.
- Тесты `planServiceFleet.test.ts` (9, настоящий `AgentFleetService` во временном git-репозитории): повтор при невалидном плане и создание подзадач с зависимостями; провал после 3 попыток без подзадач; без утверждения узлы не стартуют; параллельность доказана барьером (два узла одновременно в ходе), зависимый ждёт слияния обоих, всё влито в интеграционную ветку, рабочее дерево человека не тронуто, итог в родителе; провал узла блокирует зависимых при живой второй ветви; остановка плана; конфликт слияния → HITL и блокировка зависимых; удалённая подзадача → `missing`; дописанная человеком подзадача требует повторного утверждения.
- **Живая проверка роли architect** (qwen2.5:7b-instruct, локальная Ollama, временный репозиторий, тест удалён): валидный план с первой попытки за 7–10 с, три подзадачи с зависимостями, файлы с `parent_task_id` и критериями созданы, `## Implementation Plan` записан. Первый прогон показал дословное копирование критериев из примера — пример в инструкции помечен как образец структуры, после правки критерии стали про саму задачу. Живой прогон самих узлов и скриншоты — TASK-80.4.
<!-- SECTION:NOTES:END -->
