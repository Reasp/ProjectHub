---
id: TASK-28
title: >-
  Краш main-процесса при недоступном Claude CLI и необработанные промисы в
  ai:streamChat
status: Done
assignee:
  - claude
created_date: '2026-09-05 09:06'
updated_date: '2026-09-06 00:19'
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
modified_files:
  - electron/services/claudeBridgeService.ts
  - electron/main.ts
  - electron/services/aiAgentService.ts
  - electron/services/secretStorageService.ts
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
- [x] #1 На child.stdin и child.stdout/stderr навешаны обработчики error; ошибка превращается в onError для сессии, а не в падение процесса
- [x] #2 Перед запуском claude выполняется проверка доступности CLI (which/where или claude --version с кэшем) с понятным сообщением в UI
- [x] #3 ipcMain.handle('ai:streamChat') ожидает runAgentTask и ловит исключения, отправляя ai:error:<sessionId>
- [x] #4 ensureConfigDir/ensureDir используют синхронный mkdirSync или корректный await
- [x] #5 В main.ts добавлены process.on('unhandledRejection') и process.on('uncaughtException') с логированием без завершения приложения
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `claudeBridgeService.ts`:
   - Добавить `ensureClaudeCliAvailable()` — запуск `claude --version` (shell:true, таймаут 10с) с кэшем результата (успех — навсегда до перезапуска, неуспех — повторная проверка через 30с). При недоступности — `onError` с понятным сообщением (как установить CLI) и статус проекта `error`, без spawn основного процесса.
   - В `runClaudeCliTask` навесить `error`-обработчики на `child.stdin/stdout/stderr`, обернуть `stdin.write/end` в try/catch, добавить guard `finished`, чтобы `onError`/`onComplete` вызывались один раз (сейчас `error` и `close` могут сработать оба).
   - В `executeSubprocess` тоже навесить `error` на stdio-потоки (та же уязвимость).
2. `main.ts`:
   - `ai:streamChat`: `await runAgentTask(...)` в `try/catch`, при исключении отправить `ai:error:<sessionId>` и выставить статус проекта `error`.
   - Добавить `process.on('unhandledRejection')` и `process.on('uncaughtException')` с логированием в консоль, без завершения приложения.
3. `aiAgentService.ensureConfigDir` и `secretStorageService.ensureDir` — заменить `fs.mkdir` (promise без await) на `mkdirSync`.
4. Проверка: `tsc` (через `npm run build`), `npm run pack:win` (правило 14). Ручная проверка недоступного CLI — временно подменить PATH.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Верификация (2026-09-05).** Собран тестовый харнесс вне приложения: rolldown бандлит реальный `electron/services/claudeBridgeService.ts` с заглушкой модуля `electron`, сценарии запускаются под Node (файлы в scratchpad сессии, в репозиторий не добавлялись).

Сценарии и результат на патче:
- `missing` (PATH без claude): `ensureClaudeCliAvailable()` → `available:false` с сообщением про установку (11 мс); `runAgentTask` → ровно один `onError` с тем же текстом, статус проекта `error`; повторная проверка из кэша 0 мс.
- `epipe` (пред-проверка обойдена, PATH без claude): один `onError` с stderr cmd.exe, `activeProcesses` пуст, процесс жив.
- `stdin-error` (после spawn на `child.stdin` эмитится `error` EPIPE через nextTick): **код HEAD падает** с uncaughtException (exit 99); **патч** логирует warning и завершает сессию одним `onError` из `close` со stderr.
- `present`: CLI найден, `2.1.260 (Claude Code)`, кэш 0 мс.
- `present-run`: реальный запрос через CLI, ответ `ping`, `onComplete` один раз.

Важно: сам EPIPE-краш на Windows при отсутствующем CLI (сценарий `epipe` на коде HEAD) не воспроизвёлся — cmd.exe успевает принять stdin до выхода. Гонка платформозависима (актуальнее для /bin/sh на macOS/Linux), поэтому механизм проверен инъекцией ошибки на поток.

AC #3/#5 (main.ts) и #4 (mkdirSync) подтверждены `tsc --noEmit -p tsconfig.node.json` (0 ошибок), `npm run build` и наличием кода в `dist-electron/main.js`; конструкторы `aiAgentService`/`secretStorageService` (вызывают `ensureConfigDir`/`ensureDir`) отработали в харнессе без ошибок.

**Решения по реализации.** (1) Ошибка на `stdin` не завершает сессию сразу: EPIPE возможен и когда CLI штатно закрыл stdin, поэтому итог определяет `close` (stderr → сообщение stdin → код выхода). (2) `finished`-guard: у ChildProcess `error` и `close` могут прийти оба, раньше `onError` мог вызваться дважды. (3) `stdin.write` перенесён после навешивания всех обработчиков. (4) Кэш проверки CLI: успех — до перезапуска, неуспех — 30 с, параллельные вызовы делят один промис. (5) В `executeSubprocess` добавлены те же обработчики stdio — та же уязвимость. (6) `process.on('uncaughtException')` также подавляет системный диалог Electron «A JavaScript error occurred in the main process».

`npm run pack:win` — успешно, `release/win-unpacked/ProjectHub.exe` обновлён (2026-09-05 17:39).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано

Устранены пункты аудита 1.1, 1.2, 1.8 (doc-7): main-процесс больше не падает при недоступном Claude CLI и необработанных промисах.

**`electron/services/claudeBridgeService.ts`**
- Новый `ensureClaudeCliAvailable()`: `claude --version` (shell, таймаут 10 с) с кэшем (успех — до перезапуска, неуспех — 30 с) и дедупликацией параллельных вызовов. `runClaudeCliTask` вызывает его до spawn и при недоступности отдаёт в UI понятное сообщение (как установить CLI / войти / либо указать API-ключ).
- В `runClaudeCliTask`: `spawn` в try/catch; обработчики `error` на `stdin`/`stdout`/`stderr`; `stdin.write/end` перенесены после навешивания обработчиков и обёрнуты в try/catch; guard `finished` — `onComplete`/`onError` вызываются ровно один раз. Ошибка stdin учитывается в сообщении `close`.
- В `executeSubprocess`: обработчики `error` на stdio и однократный settle.

**`electron/main.ts`**
- `ai:streamChat` теперь `await`-ит `runAgentTask` в try/catch; исключение уходит в `ai:error:<sessionId>` и статус проекта `error`.
- Добавлены `process.on('unhandledRejection')` / `process.on('uncaughtException')` с логированием без завершения приложения.

**`aiAgentService.ensureConfigDir`, `secretStorageService.ensureDir`** — `fs.mkdir` без await заменён на `mkdirSync`.

## Проверка
- `tsc --noEmit -p tsconfig.node.json` — 0 ошибок; `npm run build` (включая `lint:docs`) — успешно; `npm run pack:win` — см. заметки.
- Харнесс на реальном сервисе (см. Implementation Notes): при отсутствии CLI — одно понятное сообщение об ошибке; инъекция `error` на stdin роняет код HEAD (uncaughtException) и корректно обрабатывается патчем; реальный запрос через установленный CLI проходит (`ping`).

## Риски / follow-up
- EPIPE-гонка на Windows не воспроизводится, проверка сделана инъекцией; на macOS/Linux поведение ожидаемо то же (обработчики платформонезависимы).
- Текст сообщения о недоступном CLI на русском и живёт в main; i18n рендерера этого не касается (см. TASK-48).
<!-- SECTION:FINAL_SUMMARY:END -->
