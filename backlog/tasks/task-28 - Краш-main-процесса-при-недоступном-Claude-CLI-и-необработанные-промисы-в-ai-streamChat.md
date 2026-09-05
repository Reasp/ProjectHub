---
id: TASK-28
title: >-
  Краш main-процесса при недоступном Claude CLI и необработанные промисы в
  ai:streamChat
status: To Do
assignee: []
created_date: '2026-09-05 09:06'
labels:
  - audit
  - electron
  - stability
  - P0
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - electron/main.ts
  - electron/services/aiAgentService.ts
  - electron/services/secretStorageService.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 1.1, 1.2, 1.8 (doc-7).

В `claudeBridgeService.runClaudeCliTask` сразу после `spawn('claude', ..., { shell: true })` выполняется `child.stdin.write()`. Если CLI не установлен или оболочка мгновенно завершилась, на `stdin` приходит событие `error` (EPIPE) без обработчика, и main-процесс падает целиком. В `main.ts` обработчик `ai:streamChat` вызывает `runAgentTask` без `await`/`.catch()`. В `aiAgentService.ensureConfigDir` и `secretStorageService.ensureDir` промис `fs.mkdir` не ожидается внутри `try`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 На child.stdin и child.stdout/stderr навешаны обработчики error; ошибка превращается в onError для сессии, а не в падение процесса
- [ ] #2 Перед запуском claude выполняется проверка доступности CLI (which/where или claude --version с кэшем) с понятным сообщением в UI
- [ ] #3 ipcMain.handle('ai:streamChat') ожидает runAgentTask и ловит исключения, отправляя ai:error:<sessionId>
- [ ] #4 ensureConfigDir/ensureDir используют синхронный mkdirSync или корректный await
- [ ] #5 В main.ts добавлены process.on('unhandledRejection') и process.on('uncaughtException') с логированием без завершения приложения
<!-- AC:END -->
