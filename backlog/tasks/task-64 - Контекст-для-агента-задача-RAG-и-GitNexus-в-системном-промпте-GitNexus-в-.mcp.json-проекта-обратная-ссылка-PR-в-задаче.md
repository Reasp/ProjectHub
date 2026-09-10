---
id: TASK-64
title: >-
  Контекст для агента: задача, RAG и GitNexus в системном промпте, GitNexus в
  .mcp.json проекта, обратная ссылка PR в задаче
status: To Do
assignee: []
created_date: '2026-09-10 07:19'
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
- [ ] #1 Агент, запущенный по задаче (AI Studio, Swarm, назначение), получает в системном промпте задачу с AC, релевантные чанки документации и связанные символы кода из GitNexus; размер контекста ограничен
- [ ] #2 AI Studio показывает подставленный контекст и позволяет отключить его части
- [ ] #3 GitNexus подключён в .mcp.json и .agents/mcp_config.json через setup.mjs, doc-9 обновлён
- [ ] #4 После создания PR и worktree в frontmatter задачи появляются branch, worktree и pr, карточка показывает их ссылками
- [ ] #5 Unit-тесты на contextBuilder добавлены, npm run build проходит
<!-- AC:END -->
