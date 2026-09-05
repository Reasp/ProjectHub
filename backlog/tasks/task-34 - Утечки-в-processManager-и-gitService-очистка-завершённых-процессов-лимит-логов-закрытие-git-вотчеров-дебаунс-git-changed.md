---
id: TASK-34
title: >-
  Утечки в processManager и gitService: очистка завершённых процессов, лимит
  логов, закрытие git-вотчеров, дебаунс git:changed
status: Done
assignee:
  - Claude
created_date: '2026-09-05 09:07'
updated_date: '2026-09-05 21:38'
labels:
  - audit
  - memory-leak
  - process-manager
  - git
  - P1
dependencies: []
references:
  - electron/services/processManager.ts
  - electron/services/gitService.ts
  - src/store/useProjectStore.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/processManager.ts
  - electron/services/gitService.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useProjectStore.ts
  - tests/unit/processManager.test.ts
  - tests/unit/gitService.test.ts
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 2.1, 2.2, 3.3 (doc-7).

`processManager.activeProcesses` никогда не очищается после завершения процесса; `logBuffer` ограничен 2000 чанками (не строками), чанк до 64 КБ, то есть до ~128 МБ на процесс. `gitService.watchProjectGit` создаёт chokidar-вотчер на корень каждого открытого проекта с `depth: 3` и никогда не закрывает его (`unwatchProjectGit` нигде не вызывается); список `ignored` не включает `venv`, `target`, `build`, `coverage`, `.next`, `__pycache__`. Любое изменение файла в проекте через 400 мс запускает в рендерере `loadGitRepoDetails` с шестью git-командами, что во время сборки или `npm install` даёт шторм процессов git.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Завершённые процессы удаляются из activeProcesses через таймаут (например, 10 минут) или при превышении лимита записей, статус остаётся доступным через .env-state
- [x] #2 logBuffer ограничен по суммарному объёму байт (например, 2 МБ) с усечением старых данных
- [x] #3 gitService.unwatchProjectGit вызывается при deactivateProject/closeCurrentProject (новый IPC git:unwatch) и при удалении проекта из реестра
- [x] #4 Список ignored вотчера расширен типовыми каталогами сборки и окружений; глубина корневого вотчера снижена или заменена на вотчер только .git/HEAD, .git/index, .git/refs плюс git status по дебаунсу
- [x] #5 Дебаунс git:changed увеличен (не менее 1,5 с) и события во время активного процесса из processManager для того же проекта агрегируются
- [x] #6 Проверено: после открытия и закрытия 10 проектов число активных FSWatcher равно числу открытых проектов
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План реализации

1. **processManager.ts**
   - `logBuffer` ограничить суммарным объёмом байт (2 МиБ): хранить `logBytes`, при добавлении чанка вытеснять старые чанки, слишком большой одиночный чанк усекать до хвоста. Логика вынесена в чистую функцию `appendLogChunk` для unit-тестов.
   - После `close`/`error` планировать удаление записи из `activeProcesses` через `FINISHED_TTL_MS` (10 мин, таймер `unref`), а также держать не более `MAX_FINISHED` (50) завершённых записей — лишние (самые старые) удалять сразу. Таймер удаляет запись только если в карте всё ещё тот же объект (перезапуск с тем же id не должен стираться). При перезапуске отменять таймер старой записи. `cleanupAll` чистит таймеры.
   - Добавить `hasRunningProcess(projectPath)` (для агрегации в gitService), `getActiveProcessCount()` и `configureRetention()` для тестов.
   - Статус env-tools процессов по-прежнему читается из `.env-state/processes.json` в `listProcessesForProject` — на него удаление hub-записей не влияет.

2. **gitService.ts**
   - Ключ проекта нормализовать (на win32 — без учёта регистра), хранить на проект два вотчера: `.git` (HEAD, index, packed-refs, refs/) и рабочее дерево (корень, `depth: 3`, расширенный `ignored`: node_modules, dist*, build, out, release, coverage, target, .next, .nuxt, .turbo, venv/.venv, __pycache__, .pytest_cache, .mypy_cache, .rag-index, .env-state, .tmp, .cache, .idea, *.log …). Предикат `isIgnoredWorkingTreePath` экспортируется для тестов.
   - События рабочего дерева не транслируются напрямую: по дебаунсу выполняется дешёвый `git status --porcelain --branch`, и `git:changed` отправляется только если вывод отличается от прошлого снимка (гейт по статусу). События `.git` транслируются после дебаунса всегда.
   - Дебаунс 1500 мс; если в проекте идёт процесс из processManager — 5000 мс с максимальным ожиданием 15 с (агрегация событий во время сборки/dev-сервера).
   - `unwatchProjectGit` закрывает оба вотчера и чистит таймеры/снимки; `getWatchedProjects()`/`getWatcherCount()` для проверки AC #6.
   - Глубина корневого вотчера намеренно не снижена: при depth 2 правки в `src/a/b/file.ts` перестали бы попадать в статус до ручного обновления. Вместо этого нагрузка убрана гейтом по статусу и расширенным ignored.

3. **IPC**: `git:unwatch` в main.ts (через `assertRegisteredProject`), `unwatchGit` в preload/`IElectronAPI`; в `projects:remove` — `gitService.unwatchProjectGit` перед удалением из реестра.

4. **Рендерер**: `deactivateProject` (и через него `closeCurrentProject`) вызывает `window.api.unwatchGit(projectPath)`.

5. **Тесты** (vitest): `tests/unit/processManager.test.ts` (лимит байт лога, удаление завершённых по TTL и лимиту), `tests/unit/gitService.test.ts` (ignored-предикат; 10 временных репозиториев: watch → unwatch части → число вотчеров равно числу открытых → cleanupAll → 0).

6. Проверка: `npm test`, `npx tsc --noEmit`, `npm run lint:docs`, `npm run pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**processManager.ts**
- `appendLogChunk` (экспортируется): буфер логов ограничен `LOG_BUFFER_MAX_BYTES` = 2 МиБ по суммарным байтам; старые чанки вытесняются, одиночный чанк больше лимита усекается до хвоста.
- `markFinished`: после `close`/`error` запись удаляется из `activeProcesses` через `FINISHED_PROCESS_TTL_MS` (10 мин, таймер `unref`) — до этого статус и хвост лога доступны вкладке Processes. `enforceFinishedLimit` держит не больше `MAX_FINISHED_PROCESSES` (50) завершённых записей, лишние (самые старые) удаляются сразу. Таймер удаляет запись только если в карте тот же объект — перезапуск с тем же id безопасен; `startProcess` при перезапуске отменяет старый таймер. `cleanupAll` чистит таймеры.
- `close` больше не перезаписывает статус `stopped`, выставленный `stopProcess`, на `failed`.
- Новое: `hasRunningProcess(projectPath)`, `getActiveProcessCount()`, `configureRetention()` (для тестов). Статусы env-tools по-прежнему читаются из `.env-state/processes.json`.

**gitService.ts**
- На проект два вотчера: `.git` (HEAD, index, packed-refs, refs/) и рабочее дерево (корень, `depth: 3`). Ключ проекта нормализован (win32 — без учёта регистра), повторный watch не плодит дубли.
- `ignored` — предикат `isIgnoredWorkingTreePath` по сегментам пути (`IGNORED_WORKING_TREE_DIRS`: node_modules, dist*, build, out, release, coverage, target, .next, .nuxt, .turbo, venv/.venv/env, .env-state, __pycache__, .pytest_cache, .mypy_cache, .rag-index, .tmp, .cache, .idea, UE Binaries/Intermediate/Saved …) плюс суффиксы `.log`, `.tmp`, `.swp`, `~`. Игнорируемые каталоги не обходятся вовсе.
- Гейт по статусу: события рабочего дерева и `.git/index` (его переписывает и сам `git status`) — «мягкие»: после дебаунса выполняется `git status --porcelain --branch`, `git:changed` уходит только если снимок отличается от предыдущего. HEAD/refs/packed-refs и git-операции из UI — «жёсткие», отправляются после дебаунса всегда.
- Дебаунс `GIT_CHANGED_DEBOUNCE_MS` = 1500 мс; при запущенном hub-процессе в этом проекте (`processManager.hasRunningProcess`) — 5000 мс, с максимальным ожиданием 15 с при непрерывном потоке событий.
- `unwatchProjectGit` закрывает оба вотчера и таймеры; `getWatchedProjects()`, `getWatcherCount()`; `cleanupAll` через `unwatchProjectGit`.
- Отклонение от буквы AC #4: глубина корневого вотчера оставлена 3 — при depth 2 правки файлов вида `src/a/b/file.ts` во внешнем редакторе перестали бы попадать в статус до ручного обновления. Нагрузка снята гейтом по статусу и расширенным `ignored`.

**IPC / рендерер**
- `git:unwatch` в main.ts (через `assertRegisteredProject`), `unwatchGit` в preload и `IElectronAPI`.
- `projects:remove` перед удалением из реестра вызывает `gitService.unwatchProjectGit`.
- `deactivateProject` в сторе (а через него `closeCurrentProject`) вызывает `window.api.unwatchGit`. При повторном выборе проекта `getRepoDetails` поднимает вотчер заново.

**Тесты** (`npm test`: 5 файлов, 40 тестов): лимит буфера по байтам, удаление завершённых по TTL и по лимиту, безопасный перезапуск с тем же именем, `hasRunningProcess`; предикат ignored; 10 временных репозиториев: watch → unwatch части → число вотчеров равно числу открытых → cleanupAll → 0.

Проверки: `npm test`, `npx tsc --noEmit`, `npm run lint:docs`, `npm run pack:win` — успешно.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Устранены утечки из аудита 2.1, 2.2, 3.3: буфер логов процессов ограничен 2 МиБ по байтам, завершённые процессы удаляются из `activeProcesses` через 10 минут или при превышении 50 записей; git-вотчеры закрываются при закрытии вкладки (`git:unwatch`) и при удалении проекта из реестра; `ignored` расширен типовыми каталогами сборки/окружений; события рабочего дерева проходят через гейт `git status --porcelain --branch` и отправляются в рендерер только при реальном изменении статуса; дебаунс 1,5 с, во время запущенного hub-процесса — 5 с (максимум 15 с ожидания). Добавлены unit-тесты (13 новых), в том числе проверка AC #6 на 10 проектах. Глубина корневого вотчера оставлена 3 — см. заметки.
<!-- SECTION:FINAL_SUMMARY:END -->
