---
id: TASK-50
title: >-
  Мелкие утечки и оптимизации: очистка setTimeout в компонентах, автоочистка
  завершённых PTY-сессий, RAG в utilityProcess
status: Review
assignee: []
created_date: '2026-09-05 09:10'
updated_date: '2026-09-11 23:53'
labels:
  - audit
  - performance
  - memory-leak
  - P2
dependencies: []
references:
  - src/components/git/GitInspector.tsx
  - src/components/docs/DocsRagView.tsx
  - src/App.tsx
  - electron/services/ptyService.ts
  - electron/services/ragSearch.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - src/lib/timerRegistry.ts
  - src/hooks/useTimeoutState.ts
  - src/App.tsx
  - src/components/actions/ActionConfigModal.tsx
  - src/components/ai/AISettingsModal.tsx
  - src/components/ai/LiveActivitySidebar.tsx
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/components/common/DialogHost.tsx
  - src/components/common/MarkdownViewer.tsx
  - src/components/docs/DocsRagView.tsx
  - src/components/explorer/FileExplorer.tsx
  - src/components/git/GitInspector.tsx
  - src/components/git/SplitDiffViewer.tsx
  - src/components/hitl/HitlCenterModal.tsx
  - src/components/mcp/McpServerStatusBadge.tsx
  - src/components/remote/RemoteControlBadge.tsx
  - src/components/search/OmniSearchModal.tsx
  - src/components/terminal/PtyTabTerminal.tsx
  - src/components/terminal/TerminalPanel.tsx
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/voice/VoiceSettingsModal.tsx
  - src/store/useProjectStore.ts
  - src/types/electron.d.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - electron/services/ptyExitTtl.ts
  - electron/services/ptyService.ts
  - electron/services/ragEmbeddingModel.ts
  - electron/services/ragWorkerClient.ts
  - electron/services/ragSearch.ts
  - electron/workers/ragWorker.mjs
  - electron/preload.ts
  - electron/main.ts
  - tests/unit/timerRegistry.test.ts
  - tests/unit/ptyExitTtl.test.ts
  - tests/unit/ragEmbeddingModel.test.ts
  - >-
    backlog/decisions/decision-21 -
    Тяжёлые-вычисления-main-процесса-в-worker_threads-с-fallback-в-main.md
  - >-
    backlog/decisions/decision-22 -
    Отложенные-вызовы-в-React-компонентах-только-через-useTimeoutState-useTimers.md
priority: low
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 2.7, 2.8, 3.8 (doc-7).

26 вызовов `setTimeout` в компонентах (GitInspector showError/showSuccess, DocsRagView, FileExplorer, App.showRemoteToast, VoiceControlWidget, MarkdownViewer CodeBlock) не очищаются при размонтировании, что приводит к setState после unmount и «залипающим» уведомлениям. Завершившиеся PTY-сессии остаются в `ptyService.sessions` и в списке вкладок с xterm-буфером 5000 строк до ручного закрытия. `ragSearch` загружает transformers и LanceDB в main-процесс, эмбеддинг запроса блокирует event loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Введён хук useTimeoutState/useToast, все временные уведомления используют его и очищают таймеры в cleanup
- [x] #2 Сессии PTY со статусом exited автоматически удаляются через настраиваемый таймаут (по умолчанию 10 минут) с уведомлением в UI
- [x] #3 Эмбеддинг и поиск LanceDB вынесены в utilityProcess или worker_threads; main не блокируется при поиске
- [x] #4 Проверено: после закрытия модалок и переключения вкладок в консоли нет предупреждений о setState на размонтированных компонентах
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Чистый реестр таймеров `TimerRegistry` (`src/lib/timerRegistry.ts`) + хуки `useTimeoutState` / `useToast` / `useTimers` (`src/hooks/useTimeoutState.ts`); перевести все компоненты с «голого» setTimeout на них.
2. TTL завершившихся PTY-сессий: чистый разбор настройки (`electron/services/ptyExitTtl.ts`), таймер удаления в `ptyService`, событие `pty:removed` → preload → стор убирает вкладку и пишет в системный лог терминала.
3. Векторный поиск в отдельном OS-потоке: `electron/workers/ragWorker.mjs` + клиент `ragWorkerClient.ts`; выбор модели вынести в чистый `ragEmbeddingModel.ts`; в `ragSearch.ts` оставить in-process fallback.
4. Unit-тесты на все три чистых модуля; проверить, что baseline ESLint не вырос; собрать и запустить упакованное приложение.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

**AC #1 — таймеры в компонентах.** Логика учёта вынесена в чистый класс `TimerRegistry`
(`src/lib/timerRegistry.ts`, 7 тестов): после `dispose()` таймеры сняты, новые не создаются,
уже сработавший колбэк не выполняется. Поверх — `src/hooks/useTimeoutState.ts`:
`useTimeoutState(resetValue, delayMs)`, `useToast<T>(delayMs)` и `useTimers()`
(`setTimer`/`clearTimer`/`clearTimers`) для отложенных действий, не сводящихся к сбросу
состояния (фокус поля, `fit()` у xterm, отложенное закрытие модалки).

Переведены: `App` (remote-тост), `GitInspector`, `DocsRagView`, `FileExplorer`, `SplitDiffViewer`,
`HitlCenterModal`, `McpServerStatusBadge`, `RemoteControlBadge`, `OmniSearchModal`,
`ActionConfigModal`, `AISettingsModal`, `LiveActivitySidebar`, `SwarmArenaView`, `DialogHost`,
`MarkdownViewer`, `PtyTabTerminal`, `TerminalPanel`, `VoiceControlWidget` (свой `timersRef`
удалён в пользу общего хука), `VoiceSettingsModal`.

Остались прямые `setTimeout` там, где это корректно: дебаунс поиска в `OmniSearchModal` и
поллинг статуса Whisper в `VoiceSettingsModal` (оба снимают таймер в cleanup своего `useEffect`),
и `await new Promise(r => setTimeout(r, 400))` в `NewProjectWizardModal` — это ожидание внутри
async-потока, а не фоновый таймер.

**AC #2 — автоочистка PTY.** `electron/services/ptyExitTtl.ts` (чистый, 5 тестов): TTL по
умолчанию 10 минут, настраивается переменной `PROJECTHUB_PTY_EXIT_TTL_MS` (`0` — выключить,
слишком маленькие значения поднимаются до 5 с). `ptyService` по `onExit` планирует удаление
сессии, снимает таймер при ручном закрытии и в `cleanupAll`, а после удаления шлёт `pty:removed`.
Рендерер (`useProjectStore`) убирает вкладку вместе с её xterm-буфером, переключает активную
вкладку и пишет в системный лог терминала новую строку `terminalLogs.sessionAutoClosed`
(ru/en). Таймер `unref()`-нут, выход из приложения не задерживает.

**AC #3 — RAG в отдельном потоке.** `electron/workers/ragWorker.mjs` держит
`@huggingface/transformers` и `@lancedb/lancedb` в изолированном OS-потоке; открытая таблица
кэшируется по каталогу индекса. Клиент `ragWorkerClient.ts` — ленивый старт, таймаут запроса,
ограниченное число перезапусков, `dispose()` в общей последовательности завершения `main.ts`.
Выбор модели эмбеддингов вынесен в чистый `ragEmbeddingModel.ts` (5 тестов) и передаётся в
воркер в каждом запросе, чтобы реестр моделей не дублировался. В `ragSearch.ts` сохранён
полноценный in-process fallback: `null` от клиента означает «воркера нет», ошибка запроса —
пробрасывается. Через воркер идёт и `getProjectRagStats` (connect/openTable к LanceDB тоже
блокировали main).

Выбор `worker_threads` вместо `utilityProcess` и конвенция по таймерам зафиксированы в
[[decision-21]] и [[decision-22]].

## Проверка

- `npm run lint` — 0 ошибок, 509 предупреждений (baseline был 510: убрана неиспользуемая
  переменная в `ptyService.cleanupAll`; все новые предупреждения устранены — типизированы
  обработчики в `preload`/`ragWorkerClient`/`ragSearch`, `setTimer`/`showDeviceNotice`
  дописаны в массивы зависимостей).
- `npm test` — 57 файлов, 605 тестов, все зелёные (добавлено 17 тестов в трёх новых файлах).
- `tsc --noEmit` — чисто. `npm run build` (включая `check-bundle`) проходит.
- Векторный поиск проверен на живом индексе проекта (276 чанков): stats и поиск возвращают
  корректные результаты, main-поток во время эмбеддинга не блокируется (счётчик тиков таймера
  идёт с частотой таймерного разрешения Windows).
- **Отдельно проверено на упакованном приложении:** воркер поднимается из `app.asar`
  (`new Worker()` по пути внутрь архива), `transformers` из asar и распакованный нативный
  LanceDB в потоке загружаются, `stats` и `vector_search` отвечают. То есть это не молчаливый
  откат на in-process fallback.

## AC #4 — уточнение

Проверять по предупреждению React «Can't perform a React state update on an unmounted
component» больше нельзя: оно удалено из рантайма React (нет начиная с React 18, в проекте
React 19.2). Поэтому проверка сделана иначе: (1) структурно — все временные уведомления и
отложенные действия зарегистрированы в реестре компонента и снимаются в cleanup, что покрыто
тестами `TimerRegistry`; (2) упакованное приложение собрано и запущено — при старте, работе
и закрытии ошибок в `main.log` нет. Это зафиксировано в [[decision-22]] как правило: корректность
таких мест проверяется конструкцией кода, а не наблюдением за консолью.

## Не сделано

`npm run pack:win` собрал приложение успешно, но копирование в `release/win-unpacked` было
заблокировано: запущен ProjectHub.exe из этого каталога (7 процессов). Бинарник в
`release/win-unpacked` остался от предыдущей сборки — его нужно пересобрать после закрытия
приложения. Проверочная сборка делалась в отдельный каталог и уже удалена (каталоги
`release_tmp_*` заблокированы тем же процессом; их уборка — пункт 5 TASK-59).
<!-- SECTION:NOTES:END -->
