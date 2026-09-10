---
id: TASK-49
title: >-
  Инфраструктура качества: vitest с первыми unit-тестами, ESLint, логирование в
  файл, проверка externals сборки
status: Done
assignee: []
created_date: '2026-09-05 09:10'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - testing
  - tooling
  - P2
dependencies: []
references:
  - package.json
  - vite.config.ts
  - tsconfig.json
  - electron/main.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - eslint.config.js
  - package.json
  - package-lock.json
  - vite.config.ts
  - scripts/check-bundle.mjs
  - electron/services/logger.ts
  - electron/main.ts
  - electron/services/secretStorageService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/ptyService.ts
  - electron/services/ragSearch.ts
  - electron/services/prService.ts
  - electron/services/claudeUsageService.ts
  - electron/services/milestoneService.ts
  - electron/services/aiAgentService.ts
  - electron/services/projectRegistry.ts
  - electron/services/projectScanner.ts
  - scripts/mcp-server.mjs
  - src/components/common/markdownBlocks.ts
  - src/components/common/MarkdownViewer.tsx
  - src/services/voiceCommandParser.ts
  - src/store/aiSessionPersistence.ts
  - tests/unit/logger.test.ts
  - tests/unit/backlogTaskFormat.test.ts
  - tests/unit/voiceCommandParser.test.ts
  - tests/unit/markdownBlocks.test.ts
  - tests/unit/commandDenyList.test.ts
  - tests/unit/claudeCliHitl.test.ts
  - tests/unit/processManager.test.ts
  - infra-dev.md
  - CLAUDE.md
  - GEMINI.md
  - AGENTS.md
  - .agents/rules/infra-dev.md
  - >-
    backlog/decisions/decision-2 -
    TypeScript-6-для-инструментов-качества-ESLint-файловый-логгер-main-процесса-и-проверка-externals-бандла.md
priority: medium
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 7.1, 7.2, 7.3, 7.4, 1.7 (doc-7).

В проекте нет ни одного теста, нет ESLint/Prettier, `noUnusedLocals: false`, 118 использований `any`. Логирование идёт в stdout через console.*, `console-message` пробрасывает весь вывод рендерера в main (в Electron 44 сигнатура обработчика устарела и печатает undefined), `secretStorageService.setSecret` логирует имя секрета. В `vite.config.ts` список `rollupOptions.external` для main не включает `node-pty`, `@huggingface/transformers`, `apache-arrow`, `zod`; нужно убедиться, что они не бандлятся.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Добавлен vitest и npm test; покрыты чистые функции: parseTaskDetails, claudeUsageService.parseUsageText, voiceCommandParser, isPathExcluded/isCommandDenied, fileService.validateSafePath, parseMarkdownBlocks
- [x] #2 Добавлен ESLint (typescript-eslint, react-hooks) с npm run lint; ошибок нет, предупреждения по any зафиксированы как baseline
- [x] #3 Введён простой логгер (уровни, запись в userData/logs/main.log с ротацией), console-message обработчик обновлён под сигнатуру Electron 44
- [x] #4 Проверен dist-electron/main.js: нативные и тяжёлые зависимости не бандлятся, список external дополнен
- [x] #5 Скрипт build запускает lint и test перед tsc/vite
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. ESLint 10 flat config (`eslint.config.js`): @eslint/js + typescript-eslint + react-hooks; шумные правила → warn (baseline), реальные ошибки исправлены. Корневой typescript понижен 7 → 6.0.3 (у TS 7 нет JS API для typescript-eslint, peer нельзя вложить через overrides) — см. decision-2.
2. Тесты vitest: новые файлы tests/unit/{backlogTaskFormat,voiceCommandParser,markdownBlocks,commandDenyList,logger}.test.ts; parseMarkdownBlocks вынесен в src/components/common/markdownBlocks.ts. parseUsageText, validateSafePath, isPathExcluded уже были покрыты (task-32/42/44).
3. Логгер electron/services/logger.ts (уровни, userData/logs/main.log, ротация 5 МБ × 3, буфер до init, captureConsole). main.ts: init + захват console до остального кода; console-message читает event.level/message/lineNumber/sourceId. secretStorage не логирует имя ключа.
4. vite.config.ts: external = функция по dependencies из package.json (+ подпути). scripts/check-bundle.mjs проверяет main.js после сборки.
5. package.json: lint, lint:fix, check-bundle; build = validate-docs → check-index --warn → lint → test → tsc → vite build → check-bundle.
6. Правило 17 + быстрые команды в infra-dev.md, sync-rules; decision-2; index-docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Baseline ESLint (2026-09-07):** 0 ошибок, 332 предупреждения в 69 файлах — `@typescript-eslint/no-explicit-any` 184, `@typescript-eslint/no-unused-vars` 138, `react-hooks/exhaustive-deps` 10. Ошибки, исправленные в коде: prefer-const (5), no-useless-escape (11, в т.ч. тесты с одинарными `\` в Windows-путях — строки были `F:projkeysid.key`), no-useless-assignment (6), preserve-caught-error (prService), один обоснованный `eslint-disable-next-line prefer-const` (таймер в проверке Claude CLI — TDZ при const).

**Бандл:** dist-electron/main.js 945 КБ → 188 КБ; чанк transformers.node-*.js (0.8–1.8 МБ) больше не создаётся. Причина прежнего бандлинга: строковый external `@modelcontextprotocol/sdk` не покрывал подпути `…/server/mcp.js`, а transformers/zod/node-pty в списке не было. Внешние импорты main.js теперь: @huggingface/transformers, @lancedb/lancedb, @modelcontextprotocol/sdk/server/{mcp,sse}.js, chokidar, gray-matter, node-pty, simple-git, tree-kill, zod.

**Тесты:** 19 файлов, 168 тестов, ~4 с. Попутно найден и исправлен баг `parseNumberWord` (voiceCommandParser): `\b` не работает с кириллицей, поэтому «первый вариант», «номер два», «последний чат» никогда не распознавались; «вариант 10» давал индекс 0.

**TypeScript:** 7.0.2 → 6.0.3 (tsc ~6 с). typescript-eslint требует JS API TS (<6.1). Вернуться на 7 можно, когда появится поддержка TS 7 в typescript-eslint.

**Логи:** `%APPDATA%/ProjectHub/logs/main.log`, уровень `PROJECTHUB_LOG_LEVEL`.

**Проверка в приложении:** dev-сборка (electron .) запущена на 15 с — файл `%APPDATA%/project-hub/logs/main.log` создан, строки `[WARN]/[INFO]` от MCP-сервера записаны через перехваченный console.*. `npm run pack:win` прошёл (lint 0 ошибок, 168 тестов, check-bundle OK), но `release/win-unpacked` не обновился: во время сборки был запущен ProjectHub.exe, файлы заблокированы (EBUSY/EPERM), временный каталог electron-builder удалён скриптом после неудачного копирования. Нужно закрыть приложение и повторить `npm run pack:win`.
<!-- SECTION:NOTES:END -->
