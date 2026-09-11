---
id: TASK-64
title: >-
  Контекст для агента: задача, RAG и GitNexus в системном промпте, GitNexus в
  .mcp.json проекта, обратная ссылка PR в задаче
status: Done
assignee:
  - veshiy666@gmail.com
created_date: '2026-09-10 07:19'
updated_date: '2026-09-11 02:38'
labels:
  - ade-roadmap
  - ai-studio
  - rag
  - gitnexus
  - P2
dependencies: []
references:
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/ragSearch.ts
  - electron/services/prService.ts
  - src/components/ai/AIStudioView.tsx
  - scripts/setup.mjs
  - .mcp.json
documentation:
  - >-
    backlog/decisions/decision-4 -
    Claude-Code-CLI-как-основной-агентный-движок-API-провайдеры-как-дополнение.md
  - backlog/decisions/decision-9 - Роль-агента-как-first-class-сущность.md
  - >-
    backlog/decisions/decision-18 -
    Единая-точка-внедрения-контекста-агента-GitNexus-как-CLI-процесс-и-frontmatter-как-канал-задача-PR.md
modified_files:
  - electron/services/contextBuilder.ts
  - electron/services/gitNexusClient.ts
  - electron/services/taskFileLookup.ts
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/agentFleetService.ts
  - electron/services/prService.ts
  - electron/services/worktreeService.ts
  - electron/ipc/aiIpc.ts
  - electron/ipc/backlogIpc.ts
  - electron/preload.ts
  - src/components/ai/ContextAppliedCard.tsx
  - src/components/ai/AIStudioView.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - src/store/useAIStudioStore.ts
  - src/types/electron.d.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - scripts/setup.mjs
  - infra.config.json
  - .mcp.json
  - .agents/mcp_config.json
  - backlog/docs/doc-9 - Контекст-проекта-и-состояние-системы-Context-Dump.md
  - >-
    backlog/decisions/decision-18 -
    Единая-точка-внедрения-контекста-агента-GitNexus-как-CLI-процесс-и-frontmatter-как-канал-задача-PR.md
  - tests/unit/contextBuilder.test.ts
  - tests/unit/gitNexusClient.test.ts
  - tests/unit/taskFileLookup.test.ts
  - tests/unit/prService.test.ts
  - tests/unit/worktreeService.test.ts
priority: medium
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-4, decision-9, decision-3).

**Что не так сейчас**
- `aiAgentService.buildSystemPrompt` это четыре строки с рабочей директорией. Задача бэклога, релевантные чанки RAG и граф кода в промпт не подставляются; `sendMessage` отправляет ровно то, что набрал пользователь. Quick-action «следующая задача» это статичный текст.
- Для Claude CLI контекст приходит косвенно через `cwd` (`CLAUDE.md`, `.mcp.json` проекта). GitNexus в `.mcp.json` репозитория ProjectHub отсутствует, хотя правила CLAUDE.md на нём построены.
- Контекстные теги `@Task`, `@GitStatus`, `@Docs` в AI Studio требуют ручного выбора.
- Связь задача → PR односторонняя: после `gh pr create` задача переходит в `Review`, но URL PR и имя ветки в файл задачи не записываются.

**Что сделать**
1. `contextBuilder` в main: по `projectPath`, `taskId` и `workspaceRoot` собирает блок контекста: заголовок, описание и AC задачи; топ-N чанков `search_docs` по тексту задачи; список затронутых символов/модулей из GitNexus (`impact`/`context`) для файлов, упомянутых в задаче; текущая ветка и краткий git-статус. Лимит размера и приоритеты обрезки.
2. Применение: для API-движка в system prompt; для Claude CLI через `--append-system-prompt` (роль из decision-9 плюс контекст) и/или файл `.projecthub/context/<taskId>.md`, на который ссылается промпт; для Swarm и назначенных задач автоматически.
3. В AI Studio показывать, какой контекст подставлен (свёрнутая карточка) с возможностью отключить компоненты.
4. Добавить GitNexus (`gitnexus mcp`) в `.mcp.json` и `.agents/mcp_config.json` через `setup.mjs`/`features`, обновить doc-9.
5. Обратная связь в задаче: после создания PR и worktree записывать в frontmatter задачи `branch`, `worktree`, `pr` (URL); `TaskDetailModal` показывает их ссылками; `validate-docs` знает эти поля.
6. Unit-тесты на сборку контекста и обрезку по лимиту.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Агент, запущенный по задаче (AI Studio, Swarm, назначение), получает в системном промпте задачу с AC, релевантные чанки документации и связанные символы кода из GitNexus; размер контекста ограничен
- [x] #2 AI Studio показывает подставленный контекст и позволяет отключить его части
- [x] #3 GitNexus подключён в .mcp.json и .agents/mcp_config.json через setup.mjs, doc-9 обновлён
- [x] #4 После создания PR и worktree в frontmatter задачи появляются branch, worktree и pr, карточка показывает их ссылками
- [x] #5 Unit-тесты на contextBuilder добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Архитектура
Единая точка внедрения контекста для всех движков (decision-4, п.4): `contextBuilder` собирает контекст один раз, дальше он течёт через существующий `roleEngineAdapter.combinedSystemPrompt`/`--append-system-prompt` (уже используется в Swarm/`agentFleetService`), а не через if/else по движкам.

## Фаза 1 — contextBuilder core
- `electron/services/contextBuilder.ts`: `buildAgentContext({ projectPath, taskId?, enabledParts? })`.
  - task-часть: заголовок/описание/AC задачи (переиспользовать `backlogTaskFormat.ts`/чтение из `backlogIpc.ts`).
  - rag-часть: `ragSearch.searchProjectDocs({ projectPath, query: текст задачи, mode: 'all', limit: 5 })`.
  - gitnexus-часть: новый `electron/services/gitNexusClient.ts` — `execFile('gitnexus', ['context', '-f', file])` по файлам из `references` задачи; НЕ парсим JSON (флага `--json` нет у CLI), просто берём текстовый stdout как есть; graceful no-op если репозиторий не проиндексирован ("Repository not indexed") или бинарник недоступен.
  - git-часть: `gitService.getStatus(projectPath)` — ветка + краткий статус.
  - Чистая функция `assembleContext(parts: {key, priority, text}[], maxChars)` — обрезка по приоритету (task > rag > gitnexus > git), возвращает `{combined, includedKeys, truncatedKeys}`. Именно она тестируется без fs/network (Pattern A, аналог `roleEngineAdapter.test.ts`).

## Фаза 2 — интеграция в 3 движка
- `claudeBridgeService.runClaudeCliTask`: сейчас вообще без системного промпта — добавить сборку контекста (когда есть `activeTaskId` в запросе) и `--append-system-prompt` через `buildEngineInvocation`/`combinedSystemPrompt`.
- `aiAgentService.buildSystemPrompt`: добавить контекстный блок к текущим 4 строкам (API-путь).
- `agentFleetService.runApiAgent`/`runClaudeCliAgent`: контекст задачи уже есть (taskId известен при назначении/Swarm) — прокинуть через существующий `extraSystemPrompt`, объединив с `systemPromptAddon`.
- В `AIStreamRequest` добавить опциональный `taskId`/`activeTaskId`.

## Фаза 3 — AI Studio UI
- Заменить статичный quick-action «следующая задача»: находим кандидата (In Progress назначенная пользователю, иначе первая To Do), выставляем как `activeTaskId` сессии, дальше на каждое сообщение контекст пересобирается.
- Новый компонент `ContextAppliedCard.tsx` (свёрнутая карточка над полем ввода, паттерн как у аккордеона `msg.thought`): показывает что подставлено (задача/RAG/GitNexus/git) с чекбоксами вкл/выкл на сессию.
- `@Task`/`@GitStatus`/`@Docs` пилюли оставляем как есть (ручной оверрайд, не мешают).

## Фаза 4 — GitNexus в .mcp.json/setup.mjs
- `scripts/setup.mjs`: добавить `gitnexus` в `ALL_FEATURES`+`DEFAULT_ON` (по умолчанию включён — CLAUDE.md уже на нём построен), `MCP_KEYS`, `buildDesiredMcpServers` → `{ command: 'gitnexus', args: ['mcp'] }`.
- Прогнать `node scripts/setup.mjs` с текущими фичами + gitnexus, проверить `.mcp.json` и `.agents/mcp_config.json`.
- Обновить `doc-9` (Context Dump) — добавить пункт про контекст-билдер и GitNexus MCP.

## Фаза 5 — обратная связь задача↔PR/worktree
- `BacklogTask` (`src/types/electron.d.ts`) + `backlogIpc.ts` (`backlog:getTasks`): добавить опциональные `branch`, `worktree`, `pr`.
- Запись `branch`/`worktree` — в момент создания worktree (IPC-обработчик вокруг `worktreeService.addWorktree`), запись `pr` — в `prService.syncBacklogOnPRCreated`. Обе точки переписать на `normalizeFrontmatter`/`withUpdatedDate` из `backlogTaskFormat.ts` (сейчас `prService` пишет через голый `matter.stringify`, это надо выровнять — rule 16).
- `TaskDetailModal.tsx`: рендер `branch`/`worktree`/`pr` как ссылок (pr — `shell.openExternal`).
- `validate-docs.mjs` уже проверяет Date-объекты рекурсивно по всем полям — доп. правок схемы не требуется, только убедиться что новые поля пишутся строками.

## Фаза 6 — тесты и ADR
- `tests/unit/contextBuilder.test.ts` — assemble/trim логика (без fs/network), + `gitNexusClient.test.ts` на graceful-degradation при "not indexed"/отсутствии бинарника.
- `npm run build` должен пройти целиком (lint, test, tsc, vite build, check-bundle).
- ADR `decision-10`: почему единая точка внедрения контекста через `extraSystemPrompt` (не per-engine ветвление), почему GitNexus как отдельный CLI-процесс с текстовым выводом (а не MCP-клиент из main-процесса), почему branch/worktree/pr — обычные frontmatter-поля. Ссылка на TASK-64. Обновить doc-9, прогнать `npm run index-docs`.
- Обязательная пересборка `npm run pack:win` в конце (rule 14).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация завершена по плану (6 фаз), см. decision-18 за архитектурные решения и отклонённые альтернативы.

Отклонение от исходного описания задачи п.2: файл `.projecthub/context/<taskId>.md` НЕ реализован — контекст идёт только через `--append-system-prompt`/`extraSystemPrompt` (единый канал уже существовал в roleEngineAdapter из TASK-60); обоснование в decision-18, Context/Decision.

npm run build (lint + test + tsc + vite build + check-bundle) — зелёный, 39 тестовых файлов / 340 тестов. npm run pack:win выполнен дважды (после основной реализации и после добавления доп. тестов).

GUI-смоук-тест (AI Studio, ContextAppliedCard, TaskDetailModal ссылки) НЕ выполнен: в этом окружении (headless-сессия агента) запущенный ProjectHub.exe завершается сразу после старта — нет интерактивного рабочего стола. Автоматическая проверка ограничена unit-тестами и сборкой; ручная проверка UI остаётся за пользователем.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализован единый контекст-билдер агента (`electron/services/contextBuilder.ts`): задача с AC (`backlogTaskFormat`), релевантные чанки `docs-rag` (`ragSearch.searchProjectDocs`), 360-обзор GitNexus по файлам из `references` задачи (новый `gitNexusClient.ts`, CLI-процесс `gitnexus context -f`, без JSON — берём текст как есть) и git-статус (`gitService.getStatus`), с чистой функцией обрезки по бюджету символов (`assembleContext`, приоритет task > rag > gitnexus > git).

Контекст подключён через единственный существующий канал `extraSystemPrompt`/`--append-system-prompt` (`roleEngineAdapter`, TASK-60) для всех путей запуска агента: AI Studio на Claude CLI (`claudeBridgeService.runClaudeCliTask`, раньше вообще без системного промпта), AI Studio на API-движке (`aiAgentService.buildSystemPrompt`), Swarm/назначенные задачи на claude-cli/codex-cli/gemini-cli/api (`agentFleetService.buildExtraSystemPrompt` — новая общая точка вместо трёх копий кода).

AI Studio: сессия привязывается к задаче (`AISession.activeTaskId`/`contextParts`), quick-action «следующая задача» подбирает реальную задачу вместо статичного текста, новая карточка `ContextAppliedCard` показывает превью контекста через IPC `ai:previewContext` и позволяет отключать части на сессию.

GitNexus подключён как MCP-сервер проекта (`gitnexus mcp`) в `.mcp.json`/`.agents/mcp_config.json` через фичу `gitnexus` в `scripts/setup.mjs` (включена по умолчанию); `doc-9` обновлён.

Обратная связь задача↔PR/worktree: `worktreeService.addWorktree` и `prService.syncBacklogOnPRCreated` пишут `branch`/`worktree`/`pr` во frontmatter через общий `taskFileLookup.findTaskFile` + `normalizeFrontmatter`/`withUpdatedDate` (правило 16); `TaskDetailModal` показывает их ссылками.

Архитектурные решения и рассмотренные альтернативы зафиксированы в `decision-18`. Юнит-тесты: `contextBuilder.test.ts`, `gitNexusClient.test.ts`, `taskFileLookup.test.ts`, `prService.test.ts`, дополнения в `worktreeService.test.ts` — 16 новых тестов, весь `npm run build` зелёный, `npm run pack:win` выполнен.
<!-- SECTION:FINAL_SUMMARY:END -->
