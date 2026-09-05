---
id: TASK-33
title: >-
  Жизненный цикл агента: отмена ожидающих одобрений, таймаут executeSubprocess,
  очистка subagents и CLI-сессий
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
labels:
  - audit
  - memory-leak
  - ai-studio
  - P1
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - electron/main.ts
  - src/store/useAIStudioStore.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 1.3, 1.4, 2.3 (doc-7).

`claudeBridgeService.requestApproval` создаёт промис, который никогда не отклоняется: при `abortSession`, `clearSession` или закрытии окна `runAgentTask` висит навсегда, статус проекта остаётся `waiting_approval`, замыкание держит все сообщения. `executeSubprocess` не имеет таймаута и лимита вывода: команда вроде `npm run dev` подвешивает цикл агента, а `output` растёт без предела. `activeSubagents` никогда не переводятся в `completed` и не удаляются, `sessionClaudeCliIds` не очищается (метод `clearSession` не подключён к IPC), `projectStatuses` растёт с числом проектов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pendingApprovals хранит resolve и reject; abortSession/clearSession отклоняют все ожидающие одобрения данной сессии и переводят статус проекта в idle
- [ ] #2 executeSubprocess принимает таймаут (настраиваемый, по умолчанию 5 минут) и лимит вывода (например, 1 МБ с усечением), по истечении процесс убивается через tree-kill
- [ ] #3 Долгоживущие команды (dev-серверы) агент может запускать через processManager в фоне, а не блокируя цикл
- [ ] #4 Подагенты получают статус completed/failed при завершении родительской сессии и удаляются из activeSubagents по завершении сессии
- [ ] #5 Добавлен IPC ai:clearSession, вызываемый из useAIStudioStore.clearSession/closeSession, который чистит sessionClaudeCliIds и активные процессы
- [ ] #6 При закрытии окна performGracefulShutdown убивает все activeProcesses claudeBridgeService
<!-- AC:END -->
