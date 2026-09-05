---
id: TASK-43
title: >-
  Убрать зависимость от process.cwd() в упакованном приложении (шаблон, реестр,
  кэш моделей, воркер, скан диска)
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
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
- [ ] #1 Все пути вычисляются от app.getPath('userData') / app.getPath('home') / app.getAppPath(), process.cwd() в electron/ не используется
- [ ] #2 Путь к шаблону ProjectTemplate настраивается в UI мастера и сохраняется в реестре; при отсутствии показывается понятная подсказка
- [ ] #3 Реестр по умолчанию не добавляет cwd; в dev-режиме текущий репозиторий добавляется явно только если app.isPackaged=false
- [ ] #4 Кэш моделей (RAG и Whisper) единый в userData/models
- [ ] #5 Скан по умолчанию не включает корень диска; inspectProject при сканировании не запускает git-команды (только проверка маркеров), git-статус вычисляется при добавлении в реестр
<!-- AC:END -->
