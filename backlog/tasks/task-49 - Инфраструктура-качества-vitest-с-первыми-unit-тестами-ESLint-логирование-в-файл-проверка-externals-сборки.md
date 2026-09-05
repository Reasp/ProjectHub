---
id: TASK-49
title: >-
  Инфраструктура качества: vitest с первыми unit-тестами, ESLint, логирование в
  файл, проверка externals сборки
status: To Do
assignee: []
created_date: '2026-09-05 09:10'
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
- [ ] #1 Добавлен vitest и npm test; покрыты чистые функции: parseTaskDetails, claudeUsageService.parseUsageText, voiceCommandParser, isPathExcluded/isCommandDenied, fileService.validateSafePath, parseMarkdownBlocks
- [ ] #2 Добавлен ESLint (typescript-eslint, react-hooks) с npm run lint; ошибок нет, предупреждения по any зафиксированы как baseline
- [ ] #3 Введён простой логгер (уровни, запись в userData/logs/main.log с ротацией), console-message обработчик обновлён под сигнатуру Electron 44
- [ ] #4 Проверен dist-electron/main.js: нативные и тяжёлые зависимости не бандлятся, список external дополнен
- [ ] #5 Скрипт build запускает lint и test перед tsc/vite
<!-- AC:END -->
