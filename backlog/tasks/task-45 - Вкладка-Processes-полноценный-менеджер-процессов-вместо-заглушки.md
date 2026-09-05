---
id: TASK-45
title: 'Вкладка Processes: полноценный менеджер процессов вместо заглушки'
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
labels:
  - audit
  - process-manager
  - ui
  - P1
dependencies: []
references:
  - src/components/projects/ProjectWorkspace.tsx
  - electron/services/processManager.ts
  - electron/services/actionConfigService.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 6.1 (doc-7).

Вкладка `processes` в `ProjectWorkspace` отображает только иконку и текст. При этом `ActionDefinition` уже описывает `env`, `cwd`, `autoOpenUrl`, `requiresConfirmation`, а `processManager` умеет читать процессы env-tools из `.env-state/processes.json`. Не реализованы: список процессов с статусами и PID, перезапуск, автооткрытие URL после старта dev-сервера, редактирование переменных окружения, остановка процессов env-tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Вкладка показывает таблицу процессов проекта (hub и env-tools): имя, команда, PID, статус, время старта, источник
- [ ] #2 Доступны действия: запустить действие из .projecthub.json, остановить, перезапустить, открыть лог в TerminalPanel
- [ ] #3 autoOpenUrl открывается через shell.openExternal после появления строки с URL в логе или через настраиваемую задержку
- [ ] #4 Остановка процесса env-tools работает через pid из .env-state (tree-kill) и обновляет processes.json
- [ ] #5 Строки i18n добавлены для ru/en
<!-- AC:END -->
