---
id: TASK-75
title: >-
  Цикл «до готовности» (Done-loop): агент → чеки → верификация AC → повтор с
  ошибками, лимиты, итог в Review
status: Review
assignee:
  - '@claude'
created_date: '2026-09-15 03:11'
updated_date: '2026-09-15 11:43'
labels:
  - swarm
  - arena
  - quality
  - agent-loop
  - backlog
milestone: m-0
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Главное отличие лучшего harness от «обёртки над CLI» — замкнутый контур проверки: агент не считается закончившим, пока объективные проверки и критерии приёмки не выполнены. Сейчас в ProjectHub чеки (`arenaChecks`: lint/test/build в worktree) и судья запускаются один раз после Arena (decision-20), а AC задачи агент отмечает сам, без верификации. Задача добавляет режим одиночного слота «до готовности» (engine-agnostic: Claude CLI, Codex, API), см. doc-10.

## Контур
1. Запуск роли (по умолчанию `implementer`) в worktree задачи с контекстом (`contextBuilder`) и явным списком AC.
2. По завершении хода агента: авто-коммит (decision-8), запуск чеков из `.projecthub.json`/`defaultChecksFromProject` (lint, test, build, опционально `lint:docs`, `check-index`), сбор хвостов ошибок (`tailOutput`).
3. Верификация AC: агент возвращает структурированный отчёт (JSON-схема: `acId`, `status`, `evidence`); ProjectHub сверяет с файлом задачи и не даёт отметить AC без evidence; чек-лист задачи обновляется только ProjectHub'ом.
4. Если чеки упали или AC не закрыты — повторный ход с хвостом ошибок и списком незакрытых AC в той же сессии (Claude — `--resume`, Codex — тот же thread, API — та же история), пока не достигнут лимит итераций (по умолчанию 5) или бюджет слота.
5. Итог: задача → `Review` с `finalSummary` (что сделано, какие AC закрыты, результаты чеков, стоимость, число итераций), уведомление `agentFinished`; при исчерпании лимита — уведомление `agentFailed` с причиной. `Done` автоматически не выставляется (правило 5).

## Что сделать
- `electron/services/doneLoop.ts` (чистая машина состояний `run → check → verify → retry | finish`, лимиты, unit-тесты) + `doneLoopService.ts` (оркестрация поверх `agentFleetService`, `arenaChecks`, записи в Backlog).
- Схема отчёта агента и промпт-инструкция в `contextBuilder` (единая для всех движков; для API — `response_format`, для CLI — JSON-блок в финальном сообщении с валидацией zod).
- UI: кнопка «Выполнить до готовности» в `TaskDetailModal`/`NewSwarmModal` (режим `done_loop` рядом с `fan_out`/`handoff`), прогресс итераций и результаты чеков в Arena-панели.
- Настройки: лимит итераций, бюджет, набор чеков, автоперевод в Review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Режим done_loop запускается из карточки задачи и NewSwarmModal для любого движка (claude-cli, codex-cli, api)
- [x] #2 После каждого хода автоматически выполняются чеки из конфига проекта; хвосты ошибок и незакрытые AC передаются в следующий ход той же сессии
- [x] #3 AC задачи отмечаются только ProjectHub'ом по структурированному отчёту агента с evidence; отчёт валидируется схемой (unit-тесты парсера)
- [x] #4 Машина состояний цикла — чистый модуль с тестами на лимит итераций, бюджет, успех с первой попытки, остановку человеком
- [x] #5 При успехе задача переводится в Review с finalSummary (AC, чеки, стоимость, итерации); при неудаче — уведомление agentFailed с причиной; Done автоматически не выставляется
- [x] #6 Прогресс итераций и результаты чеков видны в UI; i18n ru/en
- [x] #7 ADR о контуре «до готовности» и правиле «AC отмечает только harness»; lint/test зелёные, pack:win собран
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Архитектура
Сервис done-loop не знает про agentFleetService (как arenaJudgeService, иначе цикл импортов): fleet передаёт хуки runTurn/log/onUpdate/isStopped.

1. **`electron/services/doneLoop.ts`** (чистый, без Electron/fs):
   - zod-схема отчёта агента `{ summary, criteria: [{ index, status: done|not_done|blocked, evidence }] }`; парсер ищет блок ```projecthub-report``` или последний JSON-объект с `criteria` (`extractJsonObject`); толерантен к тексту вокруг.
   - `verifyCriteria(criteria, report)`: AC засчитывается только при `status=done` и непустом evidence (минимальная длина); критерий, о котором агент промолчал, остаётся незакрытым.
   - Машина состояний `decideNext({iteration, maxIterations, costUsd, budgetUsd, checksPassed, allCriteriaMet, stopped, agentFailed})` → `finish | retry | fail(reason: iteration_limit|budget|agent_error|stopped)`.
   - Промпты: `buildDoneLoopInstructions(criteria)` (единая для всех движков), `buildRetryPrompt` (хвосты упавших чеков + незакрытые AC с причиной), `buildDoneLoopFinalSummary`.
   - `resolveDoneLoopConfig` (секция `doneLoop` в `.projecthub.json`: maxIterations=5, budgetUsd, checkIds, autoReview=true, docChecks) поверх проверок арены + `lint:docs`/`check-index`, если есть такие скрипты.
2. **`backlogTaskFormat.applyFinalSummary`** — секция `## Final Summary` с нативными маркерами Backlog.md.
3. **`checkRunner.ts`** — вынести запуск одной проверки (`processManager.runOnce` + разбор вывода) из `arenaJudgeService.runAllChecks`, чтобы судья и done-loop использовали одно и то же (impact через GitNexus перед правкой).
4. **`doneLoopService.ts`** — оркестрация: ход → (фикс AC в worktree, если агент их трогал) → чеки → разбор отчёта → верификация → решение → повтор/итог. Итог: AC отмечает ProjectHub в файле задачи основного проекта, статус `Review`, `Final Summary`; неудача → `agent:failed` с причиной. `Done` не выставляется.
5. **`agentFleetService`**: режим `done_loop` (`startDoneLoop`, `executeDoneLoop`, resume после перезапуска); продолжение той же сессии: Claude CLI — `--resume <session_id>` из stream-json; API — накопленная история сообщений; Codex/Gemini — новый `exec` с полным контекстом и фидбэком (нативный thread — TASK-71). Базовый usage между ходами, чтобы стоимость копилась, а не перетиралась `replace`. Подавление per-turn `agent:finished`, итоговое событие публикует цикл.
6. Типы: `SwarmMode += done_loop`, `SwarmSession.doneLoop` (итерации, чеки, вердикты AC, стоимость, исход), `AgentSlotState.cliSessionId`; зеркало в `src/types/electron.d.ts`; `swarmSessionStore`/`swarmExport` учитывают режим.
7. IPC `swarm:startDoneLoop`, `doneLoop:getConfig`; preload; `useSwarmStore.startDoneLoopAction`.
8. UI: третий режим «До готовности» в `NewSwarmModal` (задача обязательна, один слот, лимит итераций, бюджет, набор чеков, автоперевод в Review); кнопка «Выполнить до готовности» в `TaskDetailModal` (открывает модалку в режиме done_loop); `DoneLoopPanel` в `SwarmArenaView` (итерации, чеки, AC с evidence, стоимость, исход). i18n ru/en.
9. Тесты: `doneLoop.test.ts` (лимит итераций, бюджет, успех с первой попытки, остановка человеком, парсер/схема, верификация, конфиг), `backlogTaskFormat` (Final Summary), интеграционный тест цикла в `agentFleetService` на API-движке с моком чеков.
10. ADR decision-28 (контур «до готовности», AC отмечает только harness, продолжение сессии по движкам); `npm run index-docs`, `lint:docs`, `lint`, `test`, `pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (2026-09-15)

**Main-процесс**
- `electron/services/doneLoopTypes.ts` — типы цикла (итерации, вердикты AC, настройки, секция `doneLoop` в `.projecthub.json`).
- `electron/services/doneLoop.ts` — чистый модуль: zod-схема отчёта `AgentReportSchema` + `parseAgentReport` (ограда ```projecthub-report``` или последний JSON с `criteria`, синонимы статусов, `acId: "#2"`), `verifyCriteria` (done + evidence ≥ 12 символов; молчание = не закрыт; отмеченные до старта не пересматриваются), `checksPassed`, машина состояний `decideNext` (stopped → budget_exceeded → agent_error → finish → budget → iteration_limit → retry), `buildDoneLoopInstructions`/`buildRetryPrompt`/`buildDoneLoopFinalSummary`, `resolveDoneLoopSettings` (+ `lint:docs`/`check-index` из scripts), `findReviewStatus`.
- `electron/services/checkRunner.ts` — общий запуск проверки (`executeCheck`, `pendingCheckResult`); `arenaJudgeService.runAllChecks` переведён на него без изменения поведения (arenaJudge.test.ts зелёный). `arenaChecks.runScript` экспортирован как `scriptCommand`.
- `electron/services/doneLoopService.ts` — оркестрация: ход → откат правок агента в чекбоксах (`restoreCriteriaFlags` + коммит) → последовательные проверки → отчёт → сверка → решение; итог: отметки AC, статус Review из конфига проекта (TASK-68), `## Final Summary` (`applyFinalSummary`, нативные маркеры). При неудаче файл задачи не трогается. `loadDoneLoopSettings`.
- `agentFleetService`: `startDoneLoop`/`executeDoneLoop`, ветка `swarm/<id>/done-<task>`, resume после перезапуска; продолжение сессии — Claude CLI `--resume <session_id>` (из stream-json), API — `apiHistories`; Codex/Gemini — новый exec с полным фидбэком (thread — TASK-71). `usageBaselines`: `replace` итог хода складывается с прошлыми ходами. `runSingleAgent(turn.suppressOutcomeEvent)` — промежуточные ходы не шлют agent:finished; итог цикла публикует `agent:finished` или `agent:failed` с причиной. Инструкция цикла идёт в `extraSystemPrompt`/`roleSystemPrompt` для всех движков. Вынесен `agentBusBase`.
- `swarmTypes` (`SwarmMode += done_loop`, `SwarmSession.doneLoop`, `AgentSlotState.cliSessionId`, `StartDoneLoopOptions`), `swarmSessionStore` (миграция сохраняет режим), `swarmExport` (секция итераций), `actionConfigService` (`doneLoop`), IPC `swarm:startDoneLoop`/`doneLoop:getConfig`, preload.

**Рендерер**
- `NewSwarmModal`: третий режим «До готовности» (задача обязательна, один слот с ролью implementer по умолчанию, лимит итераций, автоперевод в Review, выбор проверок, бюджет); `roles` в `useMemo` (убран перезапуск эффекта на каждом рендере).
- `TaskDetailModal`: кнопка «До готовности» — открывает модалку сразу в режиме done_loop.
- `DoneLoopPanel` в `SwarmArenaView`: фаза, сегменты прогресса итераций, проверки, критерии с evidence/причиной, стоимость, исход и что записано в задачу; вкладка «Проверки» карточки агента показывает проверки последней итерации. `src/utils/doneLoopFormat.ts`. i18n ru/en: секция `doneLoop`, `taskDetail.runDoneLoop*`.

**Отклонения от описания задачи (зафиксированы в decision-28)**
- Для API не используется `response_format`: не у всех провайдеров и не у CLI, противоречит decision-26; единый формат отчёта с zod-валидацией для всех движков.
- Инструкция цикла собирается в `doneLoop.ts` и идёт тем же каналом, что контекст `contextBuilder` (`extraSystemPrompt`), а не новой частью `ContextPartKey` — чтобы не менять контракт предпросмотра контекста в AI Studio.
- Codex — не «тот же thread», а повторный exec с полным фидбэком до TASK-71.

**Проверка**
- Тесты: `tests/unit/doneLoop.test.ts` (парсер/схема, сверка, лимит итераций, бюджет, успех с первой попытки, остановка человеком, ошибка агента, промпты, настройки), `doneLoopFleet.test.ts` (интеграция на API-движке с моком `processManager.runOnce`: повтор с хвостом ошибки в той же истории → Review + AC + Final Summary + один agent:finished; лимит итераций → задача не тронута + agent:failed с причиной; откат отметок агента; без задачи не стартует; миграция режима), `backlogTaskFinalSummary.test.ts`, `doneLoopFormat.test.ts`. 126 тестов в 11 затронутых файлах зелёные.
- `tsc --noEmit` без ошибок; ESLint: 0 ошибок, предупреждения по изменённым файлам не выше HEAD (сверено по каждому файлу).
- GitNexus: ProjectHub не проиндексирован (в реестре только Clinic, PlatOne, StarfallMetroidvania, RealmLoop) — impact проверен grep: изменённые методы приватные (`runAllChecks`, `runSingleAgent`, `recordUsage`, `runApiAgent`, `runClaudeCliAgent`), `migrateStoredSession` вызывается только хранилищем и его тестом.
- decision-28 создан, `npm run index-docs` (350 чанков), `npm run lint:docs` зелёный, `search_docs` находит ADR.

**Не проверено эмпирически**: реальный прогон с Claude CLI `--resume` и Codex/Gemini CLI (в тестах API-движок с моками).

## Доработка и визуальная проверка (2026-09-15)

- **Найдено при проверке UI:** `NewSwarmModal` рендерится внутри `SwarmArenaView`, а тот виден, только если в AI Studio включён режим `swarm` (по умолчанию `studio`). Кнопки из карточки задачи («В Swarm Arena», «До готовности») открывали модалку, которую не было видно. Исправлено в `AIStudioView`: при `isNewSwarmModalOpen` AI Studio переключается в режим арены. ESLint: предупреждений не больше, чем в HEAD (6/6); tsc чистый.
- **Скриншоты** (playwright-core, свежий `dist` через `node_modules/electron`, т. к. `release/win-unpacked` заблокирован запущенным приложением): карточка TASK-75 с кнопкой «Until done» → модалка открылась сразу в режиме «Until done» с привязанной задачей, исполнитель по умолчанию — роль implementer («Реализатор», Claude Code CLI), лимит итераций 5, «Move to Review on success», проверки Lint/Tests/Build/Docs lint/RAG index (последние две добавлены из scripts `package.json`).
- **Не проверено визуально:** `DoneLoopPanel` с реальными итерациями — нужен реальный прогон агента; логика панели покрыта `doneLoopFormat.test.ts`.
- **Замечено, не исправлялось** (было и до задачи): на ширине модалки строка слота агента не помещается по горизонтали — поле модели обрезано, кнопка удаления слота не видна.

## Сборка (2026-09-15)

`npm run pack:win` (после всех правок, включая `AIStudioView`): внутри `build` зелёные `validate-docs`, ESLint (0 ошибок, 504 предупреждения — baseline), vitest 681 тест в 64 файлах, tsc, vite build, check-bundle; electron-builder собрал приложение в `release_tmp_1789472521268/win-unpacked`. Синхронизация в `release/win-unpacked` частичная: у пользователя запущен `ProjectHub.exe` из этого каталога (EBUSY/EPERM на `ProjectHub.exe`, `d3dcompiler_47.dll`). Чтобы обновить бинарник полностью, закройте приложение и перезапустите `npm run pack:win`. Каталоги `release_tmp_*` остались от сборок (долг из TASK-59).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Добавлен режим «до готовности» (`done_loop`): замкнутый контур «ход агента → проверки проекта → сверка критериев приёмки → повтор с ошибками» для любого движка (Claude CLI, Codex, Gemini, API). Решение зафиксировано в decision-28.

**Что сделано**
- Чистое ядро `electron/services/doneLoop.ts`:
  - zod-схема отчёта агента с evidence;
  - сверка критериев;
  - машина состояний `decideNext`: лимит итераций, бюджет, успех, остановка человеком, ошибка агента;
  - промпты инструкции, повтора и итога;
  - слияние настроек (`.projecthub.json` → `doneLoop`).
- Оркестрация `doneLoopService.ts` и режим в `agentFleetService`:
  - worktree `swarm/<id>/done-<task>`, возобновление после перезапуска;
  - продолжение сессии: Claude CLI `--resume`, история API; Codex/Gemini — повторный exec до TASK-71;
  - накопительная стоимость между ходами;
  - итоговое событие `agent:finished` или `agent:failed` с причиной.
- Критерии отмечает только ProjectHub. Правка чекбоксов агентом откатывается, критерий засчитывается только при `done` с evidence. При успехе цикл ставит отметки, переводит задачу в Review (если такой статус есть в проекте) и пишет `## Final Summary`. Статус Done цикл не ставит никогда.
- Общий запуск проверок `checkRunner.ts`, его использует и автосудья арены.
- UI:
  - режим «До готовности» в `NewSwarmModal`: лимит итераций, бюджет, выбор проверок, автоперевод в Review;
  - кнопка в `TaskDetailModal`;
  - `DoneLoopPanel` в арене;
  - i18n ru/en.
- Исправлено заодно: кнопки запуска из карточки задачи открывали модалку в невидимом экране арены — `AIStudioView` теперь переключается на арену.

**Проверка**
- Тесты:
  - `doneLoop.test.ts`;
  - `doneLoopFleet.test.ts` — интеграция на API-движке: повтор с хвостом ошибки → Review + AC + Final Summary; лимит итераций → задача не тронута + `agent:failed`; откат отметок;
  - `backlogTaskFinalSummary.test.ts`, `doneLoopFormat.test.ts`.
- Весь набор: 681 тест зелёный; tsc чистый; ESLint без ошибок, предупреждения не выше HEAD.
- `lint:docs` зелёный, индекс документации пересобран.
- Скриншоты подтверждают вход из карточки задачи и настройки режима в модалке.

**Ограничения и долг**
- Реальные прогоны Claude CLI `--resume`, Codex и Gemini не выполнялись.
- `DoneLoopPanel` с живыми итерациями визуально не проверена.
- Evidence проверяется формально (наличие и длина), а не по смыслу.
- `release/win-unpacked` обновлён частично из-за запущенного приложения — пересоберите после его закрытия.
<!-- SECTION:FINAL_SUMMARY:END -->
