---
id: TASK-40
title: >-
  Action Runner на Windows: оператор && не работает в PowerShell 5.1, хардкод
  команд в TerminalPanel и голосовых командах
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
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
- [ ] #1 На Windows команды выполняются через cmd.exe /d /s /c (поддержка &&) либо через pwsh при наличии, либо строка с && транслируется в ; с проверкой $? для PowerShell 5.1
- [ ] #2 processManager.startProcess принимает env и cwd из ActionDefinition и применяет их
- [ ] #3 TerminalPanel и голосовые команды run_dev/run_deploy/run_tests берут команды из actionConfigService.getConfig(projectPath)
- [ ] #4 Проверено на Windows: действие Deploy с командой по умолчанию запускается без ошибки парсера
<!-- AC:END -->
