---
id: TASK-80.1
title: >-
  Чистые модули плана: схема ответа architect, валидация графа и диспетчер узлов
  с тестами
status: Review
assignee: []
created_date: '2026-09-20 01:58'
updated_date: '2026-09-20 02:30'
labels:
  - swarm
  - planning
  - orchestration
dependencies: []
parent_task_id: TASK-80
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-49 п. 2–3. `electron/services/planSchema.ts` (без Electron): zod-схема ответа роли architect (ограда ```projecthub-plan```, fallback — последний JSON с `subtasks`), нормализация (trim, обрезка заголовка до 110 символов, дедуп ключей, чистка dependsOn, лимиты 20 узлов / 8 зависимостей), поиск циклов, топологическая сортировка, текст ошибок для повторного запроса. `electron/services/planDispatcher.ts`: готовность узла (все зависимости `merged`/`skipped`), выбор узлов к запуску с лимитом параллельности, общий бюджет плана, транзитивная блокировка зависимых при провале, исход плана (`success`/`partial`/`failed`/`budget_exceeded`), хэш утверждённого графа. Unit-тесты на оба модуля.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Разбор и валидация ответа architect покрыты тестами: ограда, мусор вокруг JSON, циклы, дубли ключей, длинный заголовок, лимиты
- [x] #2 Топологическая сортировка детерминирована и покрыта тестами
- [x] #3 Диспетчер покрыт тестами: готовность по merged, лимит параллельности, бюджет, провал узла блокирует зависимых, исход плана
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-49 п. 2–3.

- `electron/services/planTypes.ts` — типы плана без Electron (`PlanSubtaskDraft`, `AgentPlan`, `PlanNode`, `PlanNodeState`, `PlanSettings`, `PlanState`); зеркало в `src/types/electron.d.ts`.
- `electron/services/planSchema.ts` — ограда ```projecthub-plan``` (fallback — последний JSON с `subtasks`), zod-схема с preprocess (синонимы `depends_on`/`acceptance_criteria`/`criteria`, регистр `modelTier`/`size`), `normalizePlan` (дедуп ключей → `key-2`, обрезка заголовка до 110 символов с переносом полного текста в описание, снятие самоссылок и ссылок на неизвестные узлы, лимит 20 узлов), `findCycle` (путь цикла в тексте ошибки), `topoOrder` (по уровням, внутри уровня — порядок ответа), `planRetryPrompt`, `buildPlanInstructions`.
- `planKey` сохраняет кириллицу (`\p{L}`): модель, которую просят отвечать по-русски, называет узлы по-русски, и латинский слаг обнулил бы и ключи, и все зависимости.
- `electron/services/planDispatcher.ts` — `isReady` (зависимость удовлетворяет только `merged`/`skipped`, зависимость вне плана не блокирует), `decidePlanStep` (остановка → бюджет → утверждение → запуск с лимитом параллельности → ожидание → исход), `planOutcome`, `blockDependents`, `blockUnreachable`, `graphHash` (состав узлов и рёбер без состояний), `planProgress`.
- Бюджет не обрывает идущие узлы: у каждого свой бюджет цикла, прерванная посреди итерации работа всё равно оплачена.
- Тесты: `planSchema.test.ts` (22) и `planDispatcher.test.ts` (23) — ограды, мусор вокруг JSON, битый JSON, циклы, дубли, длинный заголовок, лимиты, русские ключи, детерминированная сортировка, готовность по всем состояниям, лимит и потолок параллельности, бюджет, блокировка зависимых, исходы, хэш графа.
<!-- SECTION:NOTES:END -->
