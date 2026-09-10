---
id: TASK-40
title: >-
  Action Runner на Windows: оператор && не работает в PowerShell 5.1, хардкод
  команд в TerminalPanel и голосовых командах
status: Done
assignee: []
created_date: '2026-09-05 09:08'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - process-manager
  - windows
  - P1
dependencies: []
references:
  - electron/services/actionConfigService.ts
  - electron/services/processManager.ts
  - src/components/terminal/TerminalPanel.tsx
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/actions/ActionRunnerBar.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/processManager.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useProjectStore.ts
  - src/components/actions/ActionRunnerBar.tsx
  - src/components/terminal/TerminalPanel.tsx
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/layout/Header.tsx
  - src/i18n/en.ts
  - src/i18n/ru.ts
  - src/i18n/types.ts
  - tests/unit/processManager.test.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 5.5, 5.9 (doc-7).

`actionConfigService` по умолчанию задаёт `deploy.command = 'npm run build && npm run deploy'`, а `processManager.startProcess` на Windows выполняет строку через `powershell.exe -NoProfile -Command`. В Windows PowerShell 5.1 оператор `&&` не поддерживается, действие Deploy падает с ошибкой парсера. Кроме того, быстрые кнопки TerminalPanel (dev/build/docs) и голосовые команды run_dev/run_deploy/run_tests в VoiceControlWidget жёстко зашивают `npm run dev`/`npm run deploy`/`npm test`, игнорируя `.projecthub.json`, который уже умеет читать ActionRunnerBar. `ActionDefinition.env` и `cwd` не передаются в spawn.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 На Windows команды выполняются через cmd.exe /d /s /c (поддержка &&) либо через pwsh при наличии, либо строка с && транслируется в ; с проверкой $? для PowerShell 5.1
- [x] #2 processManager.startProcess принимает env и cwd из ActionDefinition и применяет их
- [x] #3 TerminalPanel и голосовые команды run_dev/run_deploy/run_tests берут команды из actionConfigService.getConfig(projectPath)
- [x] #4 Проверено на Windows: действие Deploy с командой по умолчанию запускается без ошибки парсера
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

**Оболочка на Windows (AC#1).** `processManager` больше не запускает команды через `powershell.exe -Command`. Новая чистая функция `resolveShellSpawn(command, platform, comspec)` возвращает на win32 `cmd.exe /d /s /c "command"` с `windowsVerbatimArguments: true` (строка команды уходит в cmd как есть, без переэкранирования кавычек — тот же приём, что у `spawn(..., { shell: true })`); на остальных платформах — `/bin/sh -c`. cmd.exe понимает `&&`/`||`, `npm` резолвится в `npm.cmd` без обёрток. `COMSPEC` уважается.

**env и cwd из ActionDefinition (AC#2).** `startProcess(projectPath, command, name, options?: { env, cwd })`. `cwd` резолвится относительно корня проекта (`resolveWorkingDir`), несуществующий каталог даёт понятную ошибку до spawn. Значения env приводятся к строкам и накладываются поверх окружения приложения. В `ManagedProcess` добавлено поле `workingDir` (заполняется только если отличается от корня проекта); `cwd` остаётся привязкой к проекту, по нему процесс ищут UI и `listProcessesForProject`. IPC `process:start`, preload и типы расширены четвёртым аргументом.

**Единый источник команд (AC#3).** В `useProjectStore` добавлены `actionConfig`, `loadActionConfig(projectPath)`, `runActionDefinition(def, { confirm })`, `runProjectAction('run'|'deploy'|'test', { confirm })`, `findActionProcess(kind)` и экспортируемый хелпер `isProcessOfAction`. Конфиг загружается в `loadProjectData` и сбрасывается при смене проекта; `runProjectAction` перечитывает `.projecthub.json` перед каждым запуском. `ActionRunnerBar` перешёл со своего локального состояния на стор. `TerminalPanel`: вместо зашитых `dev/build/docs` кнопки строятся из конфига (run/deploy/test + `customActions`), с подтверждением для `requiresConfirmation`. `VoiceControlWidget`: `run_dev/stop_dev/run_deploy/run_tests` идут через `runProjectAction`/`findActionProcess`, деплой спрашивает подтверждение тем же текстом, что и кнопка. Из `Header` убран неиспользуемый поиск процесса по имени `'dev'`. Удалены ставшие ненужными ключи i18n `terminal.devServer/buildProject/indexDocs`.

**Проверка на Windows (AC#4).** Unit-тесты (`tests/unit/processManager.test.ts`): форма spawn для win32/linux, резолв cwd, реальный запуск `echo first && echo second` на текущей платформе, применение env+cwd, ошибка на отсутствующем cwd. Отдельно прогнана дефолтная команда `npm run build && npm run deploy` через `cmd.exe /d /s /c` в тестовом пакете — оба скрипта выполнились, код 0, ошибки парсера нет. `npx tsc --noEmit` чисто, `vitest run` — 92/92, `npm run lint:docs` ок, `npm run pack:win` собран.

## Замечания
- Кнопка «docs» (`npm run index-docs`) из TerminalPanel убрана как хардкод: переиндексация есть в DocsRagView, а при необходимости её можно добавить как `customActions` в `.projecthub.json`.
- `claudeBridgeService.runSubprocess` по-прежнему выполняет команды агента через `powershell.exe -Command` — это вне рамок задачи (команды формирует сам агент под PowerShell), но при желании можно перевести на тот же `resolveShellSpawn`.
<!-- SECTION:NOTES:END -->
