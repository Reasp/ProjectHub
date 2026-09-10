---
id: TASK-43
title: >-
  Убрать зависимость от process.cwd() в упакованном приложении (шаблон, реестр,
  кэш моделей, воркер, скан диска)
status: Done
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - build
  - electron
  - P1
dependencies: []
references:
  - electron/services/templateWizard.ts
  - electron/services/projectRegistry.ts
  - electron/services/ragSearch.ts
  - electron/services/localWhisperService.ts
  - electron/services/projectScanner.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/appPaths.ts
  - electron/services/projectRegistry.ts
  - electron/services/templateWizard.ts
  - electron/services/projectScanner.ts
  - electron/services/ragSearch.ts
  - electron/services/localWhisperService.ts
  - electron/workers/whisperWorker.mjs
  - electron/services/ptyService.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - src/components/projects/NewProjectWizardModal.tsx
  - src/components/projects/ScanSettingsModal.tsx
  - tests/unit/appPaths.test.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 5.7, 5.10 (doc-7).

`templateWizard.DEFAULT_TEMPLATE_PATH = process.cwd()/../ProjectTemplate`, `projectRegistry.DEFAULT_CONFIG` добавляет `process.cwd()` как первый проект, `ragSearch` кладёт кэш моделей в `process.cwd()/.rag-cache`, `localWhisperService.resolveWorkerPath` ищет воркер от cwd. В упакованном `ProjectHub.exe` cwd произволен, а при запуске из Program Files каталог недоступен на запись. Корень сканирования по умолчанию на Windows включает корень диска (`C:\`) с глубиной 2, при этом `inspectProject` запускает `git status` в каждой папке-кандидате.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все пути вычисляются от app.getPath('userData') / app.getPath('home') / app.getAppPath(), process.cwd() в electron/ не используется
- [x] #2 Путь к шаблону ProjectTemplate настраивается в UI мастера и сохраняется в реестре; при отсутствии показывается понятная подсказка
- [x] #3 Реестр по умолчанию не добавляет cwd; в dev-режиме текущий репозиторий добавляется явно только если app.isPackaged=false
- [x] #4 Кэш моделей (RAG и Whisper) единый в userData/models
- [x] #5 Скан по умолчанию не включает корень диска; inspectProject при сканировании не запускает git-команды (только проверка маркеров), git-статус вычисляется при добавлении в реестр
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Новый модуль `electron/services/appPaths.ts` — единая точка вычисления путей: `getUserDataDir`/`getHomeDir`/`getAppRootDir` (все через `app`, с защитой для unit-тестов), `getDevRepoRoot()` (только при `app.isPackaged=false`), `getModelsCacheDir()` = userData/models, `ensureModelsCacheDir()` (создание + одноразовый best-effort перенос из `~/.cache/projecthub/whisper` и dev `.rag-cache`), `getWorkerScriptCandidates()`, `isFilesystemRoot()`.

- `projectRegistry`: defaults строятся лениво (`buildDefaultConfig`), `projects` пуст, dev-репозиторий добавляется только через `getDevRepoRoot()`; корни скана по умолчанию — `~/Projects`, `~/source/repos`, `~/Developer`, `~/Documents/Projects` (без корня диска); новое поле `settings.templatePath` + `getTemplatePath/setTemplatePath`.
- `templateWizard`: `resolveTemplatePath()` — явный путь → реестр → `PROJECT_TEMPLATE_PATH` → dev-соседний `../ProjectTemplate`; `checkTemplateAvailable` возвращает `{available, path, source}`; понятные ошибки при отсутствии. Заодно `setup.mjs` запускается с `ELECTRON_RUN_AS_NODE=1` (иначе `process.execPath` в упакованном приложении открыл бы второе окно ProjectHub).
- `projectScanner`: `inspectProject(path, {skipGit})`; при обходе — только маркеры, git-статус считается один раз после регистрации; корни-диски пропускаются с предупреждением.
- `ragSearch`, `localWhisperService`, `whisperWorker.mjs`: единый кэш userData/models; воркер получает `cacheDir`/`modelName` через `workerData`; поиск скрипта воркера от каталога бандла и `app.getAppPath()`.
- `ptyService`: fallback cwd → `os.homedir()`.
- IPC `template:setPath`, preload `setTemplatePath`, типы `TemplateAvailability`; в мастере (шаг 1) поле «Шаблон ProjectTemplate» с кнопкой «Обзор», статусом и подсказкой; «Далее»/«Создать» заблокированы, пока шаблон не найден; `alert()` заменён на сообщение в модалке. В ScanSettingsModal корни-диски подсвечены предупреждением.
- Тесты: `tests/unit/appPaths.test.ts` (4 кейса); всего 96 проходят. `process.cwd()` в `electron/` остался только в комментариях.
<!-- SECTION:NOTES:END -->
