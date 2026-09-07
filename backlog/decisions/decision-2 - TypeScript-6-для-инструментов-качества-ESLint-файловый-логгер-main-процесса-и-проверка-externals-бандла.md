---
id: decision-2
title: >-
  TypeScript 6 для инструментов качества (ESLint), файловый логгер main-процесса
  и проверка externals бандла
date: '2026-09-07 00:43'
status: accepted
---
## Context

Технический аудит (doc-7, пункты 7.1–7.4 и 1.7) зафиксировал: в проекте нет линтера, unit-тесты
появились только для чанкера RAG, логи main-процесса уходят только в stdout (в упакованном
приложении их никто не видит), обработчик `console-message` использовал устаревшую сигнатуру
Electron 44, а `dist-electron/main.js` весил 945 КБ, потому что `@huggingface/transformers`, `zod`
и подпути `@modelcontextprotocol/sdk/*` вбандливались (строковый `external` в Rollup совпадает только
с точным именем пакета, `@modelcontextprotocol/sdk/server/mcp.js` под него не попадал).

При добавлении ESLint выяснилось, что корневой `typescript@7` (нативный компилятор на Go) не
экспортирует JS API (`createSourceFile`, `createProgram` и т.п.) — в пакете только `tsc` и
`typescript/unstable/*`. `typescript-eslint` (парсер `@typescript-eslint/typescript-estree`) требует
`typescript >=4.8.4 <6.1.0` и вызывает этот API; peer-зависимость нельзя «вложить» через npm
`overrides` — npm требует, чтобы peer прямой зависимости стоял в корне.

## Decision

1. **Корневой `typescript` понижен до 6.x** (`^6.0.3`) — последний JS-релиз с полным API, который
   поддерживает `typescript-eslint`. `tsc` стал JS-версией: полная проверка проекта занимает ~6 с, что
   приемлемо. Возврат на 7.x возможен, когда `typescript-eslint` начнёт работать с TS 7 (`@typescript/api`)
   или появится ESLint-парсер на его основе.
2. **ESLint 10 (flat config `eslint.config.js`)**: `@eslint/js` recommended, `typescript-eslint`
   recommended, `eslint-plugin-react-hooks` (`rules-of-hooks` — error, `exhaustive-deps` — warn).
   Правила, которые на текущей кодовой базе дают только шум (`no-explicit-any`, `no-unused-vars`,
   `no-empty-object-type`, `ban-ts-comment`), переведены в предупреждения: это **baseline техдолга**
   (на момент принятия — 332 предупреждения: 184 `any`, 138 неиспользуемых переменных, 10
   `exhaustive-deps`), он должен только уменьшаться. Ошибок должно быть 0 — `npm run lint` входит в
   `npm run build`.
3. **Тесты**: `vitest` (`tests/unit/**/*.test.ts`, отдельный `vitest.config.ts`, чтобы не тянуть
   `vite-plugin-electron`). Чистые функции выносятся из компонентов в модули без React/Electron
   (например `parseMarkdownBlocks` → `src/components/common/markdownBlocks.ts`). `npm test` тоже входит
   в `npm run build`, то есть и в `pack:win`.
4. **Логгер `electron/services/logger.ts`**: уровни `debug|info|warn|error`, запись в
   `<userData>/logs/main.log` с ротацией по размеру (5 МБ, 3 архива `main.N.log`), буфер до
   инициализации, `captureConsole()` дублирует все существующие `console.*` main-процесса в файл без
   переписывания 160 вызовов. Уровень задаётся `PROJECTHUB_LOG_LEVEL` (по умолчанию `debug` в dev,
   `info` в упакованном приложении). Консоль рендерера читается из объекта события `console-message`
   (Electron 44): `error` → error, `warning` → warn, остальное → debug. Из лога убрано имя секрета в
   `secretStorageService.setSecret`.
5. **Externals main-процесса**: в `vite.config.ts` `rollupOptions.external` — функция, которая считает
   внешними `electron` и все пакеты из `dependencies` `package.json` вместе с подпутями. electron-builder
   всё равно кладёт `dependencies` в `app.asar`, поэтому бандлить их незачем. Скрипт
   `scripts/check-bundle.mjs` (конец `npm run build`) падает, если в `main.js` найден код из
   `node_modules/<dep>/` или импорт чанка `./transformers*`, `./onnxruntime*` и т.п.

## Consequences

- `dist-electron/main.js` — 188 КБ вместо 945 КБ, чанк `transformers.node-*.js` (0.8–1.8 МБ) больше не
  генерируется; `@huggingface/transformers`, `zod`, `@modelcontextprotocol/sdk/*`, `node-pty`,
  `@lancedb/lancedb` загружаются из `node_modules` внутри asar.
- `npm run build` стал дольше на ~15 с (ESLint + vitest), зато ошибки типов/линта и регрессии чистых
  функций ловятся до упаковки.
- Логи упакованного приложения доступны в `%APPDATA%/ProjectHub/logs/main.log` — есть что приложить к
  баг-репорту без запуска из терминала.
- Попутно исправлен `parseNumberWord` в голосовом парсере: `\b` в JS — ASCII-граница, для кириллицы
  («первый», «два», «последний») он никогда не совпадал; заменён на lookaround по `\p{L}`/`\p{N}`, и
  «10» теперь проверяется раньше «1».
- Правило 17 в `infra-dev.md` закрепляет: 0 ошибок ESLint, baseline предупреждений не растёт, новые
  чистые функции — с тестами, логи — через `logger`/`console.*` без секретов.
