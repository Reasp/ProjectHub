---
id: TASK-45
title: 'Вкладка Processes: полноценный менеджер процессов вместо заглушки'
status: Done
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-10 02:00'
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
modified_files:
  - electron/services/processManager.ts
  - electron/services/actionConfigService.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useProjectStore.ts
  - src/components/processes/ProcessesView.tsx
  - src/components/projects/ProjectWorkspace.tsx
  - src/components/actions/ActionConfigModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/processManager.test.ts
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
- [x] #1 Вкладка показывает таблицу процессов проекта (hub и env-tools): имя, команда, PID, статус, время старта, источник
- [x] #2 Доступны действия: запустить действие из .projecthub.json, остановить, перезапустить, открыть лог в TerminalPanel
- [x] #3 autoOpenUrl открывается через shell.openExternal после появления строки с URL в логе или через настраиваемую задержку
- [x] #4 Остановка процесса env-tools работает через pid из .env-state (tree-kill) и обновляет processes.json
- [x] #5 Строки i18n добавлены для ru/en
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. processManager: остановка процессов env-tools по pid из `.env-state/processes.json` (tree-kill + удаление записи из реестра), `restartProcess` для hub и env-tools, автооткрытие `autoOpenUrl` по первой строке лога с URL или по задержке `autoOpenDelayMs`, ожидание фактического завершения в `stopProcess`, защита от перетирания статуса нового процесса событием close старого.
2. IPC `process:restart` + preload `restartProcess`, типы `ActionDefinition.autoOpenDelayMs`, `StartProcessOptions.autoOpenUrl/autoOpenDelayMs`, `ManagedProcess.autoOpenUrl`.
3. Стор: `restartProcessAction`, передача autoOpenUrl/autoOpenDelayMs при запуске действия, добавление неизвестных процессов проекта по `process:statusChanged`.
4. Новая вкладка `ProcessesView`: таблица (имя, команда, PID, статус, время старта, источник), быстрые действия из `.projecthub.json`, стоп/перезапуск/лог в TerminalPanel/открыть URL, автообновление каждые 5 с.
5. ActionConfigModal: поля cwd, env (KEY=VALUE), задержка автооткрытия.
6. i18n ru/en, unit-тесты на новые сценарии, `npm run pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Остановка env-tools процесса удаляет запись из `processes.json` так же, как `stop_process` самого env-tools; перезапуск env-tools процесса запускает ту же команду уже под управлением Hub (source: hub), т.к. env-tools стартует процессы только из своего MCP-сервера.
- `stopProcess` теперь ждёт фактического close дочернего процесса (до 5 с) — перезапуск не упирается в занятый порт.
- Автооткрытие URL: один раз за запуск, только http/https, только пока процесс жив; задержка по умолчанию 10 с, `autoOpenDelayMs: 0` — только по логу.
- Реестр env-tools ищется в `<projectPath>/.env-state/processes.json` (как и раньше в projectScanner); случай инфраструктуры-подпапки не покрыт.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Вкладка Processes заменена полноценным менеджером процессов (`src/components/processes/ProcessesView.tsx`): таблица hub- и env-tools-процессов (имя, команда, PID, статус с кодом выхода, время старта, источник, рабочий каталог), быстрые действия из `.projecthub.json`, стоп/перезапуск/открытие лога в TerminalPanel/открытие URL, автообновление каждые 5 с.

processManager: `stopProcess` останавливает процессы env-tools по pid из `.env-state/processes.json` (tree-kill) и удаляет запись из реестра; для hub-процессов ждёт фактического завершения; новый `restartProcess` (hub — с теми же env/cwd/autoOpenUrl, env-tools — та же команда под управлением Hub); событие close старого процесса больше не перетирает статус нового с тем же id. Автооткрытие `autoOpenUrl` через `shell.openExternal` по первой строке лога с URL или по задержке `autoOpenDelayMs` (по умолчанию 10 с, 0 — только по логу), только http/https, один раз за запуск.

IPC `process:restart`, стор `restartProcessAction`, ActionConfigModal получил поля cwd / env (KEY=VALUE) / задержка автооткрытия. i18n ru/en (`t.processes.*`, новые ключи `t.actions.*`). Unit-тесты: 24 в `tests/unit/processManager.test.ts` (всего 118 зелёных), `npm run lint:docs` и `npm run pack:win` пройдены.
<!-- SECTION:FINAL_SUMMARY:END -->
