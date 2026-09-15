---
id: TASK-71
title: >-
  Codex через app-server (JSON-RPC): thread/turn, HITL-одобрения
  execCommand/applyPatch в общей очереди, resume, effort, каталог моделей
status: To Do
assignee: []
created_date: '2026-09-15 03:06'
labels:
  - ai
  - codex
  - swarm
  - hitl
  - engine
milestone: m-0
dependencies: []
references:
  - 'https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md'
  - 'https://openai.com/index/unlocking-the-codex-harness/'
  - 'https://gist.github.com/oneryalcin/ee2c27e2d8aa040da8fbe7eebcc2ecea'
  - 'https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/'
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Движок `codex-cli` сейчас запускается как `codex exec --json` (TASK-60): без HITL (только `--ask-for-approval on-failure|never`), без resume, без выбора усилия рассуждений, `ENGINE_CAPABILITIES` = `tools: false, maxTurns: false`, схема JSONL-событий разбирается «best-effort». С 2026 года все поверхности Codex (CLI, VS Code, web) работают через `codex app-server` — долгоживущий процесс с двунаправленным JSON-RPC 2.0. Задача переводит движок на этот протокол (см. [[decision-26]], doc-10).

## Протокол (по документации openai/codex `codex-rs/app-server`)
- Запуск: `codex app-server` (stdio, NDJSON) или `--listen ws://127.0.0.1:<port>`.
- Handshake: `initialize` (clientInfo, capabilities, `optOutNotificationMethods`) → `initialized`.
- `thread/start` (model, effort, sandbox `read-only|workspace-write|danger-full-access`, cwd, baseInstructions, MCP overrides, outputSchema) → `threadId`; `thread/resume`, `thread/fork`, `thread/list`, `thread/name/set`.
- `turn/start` (текст/изображения/файлы; per-turn model, `effort` ∈ `none|minimal|low|medium|high|xhigh`, sandbox, skill inputs) → `turnId`; `turn/steer`, `turn/interrupt`.
- События: `turn/started|completed`, `item/started|completed`, `item/agentMessage/delta`, `item/reasoning/textDelta`, потоки вывода команд.
- Серверные запросы к клиенту: `execCommandApproval`, `applyPatchApproval` → ответ `{decision: accept|decline|cancel}`.
- `model/list` — каталог моделей аккаунта с `supportedReasoningEfforts`; `review/start`; `mcpServer/tool/call`; `account/read`, `config/read`.

## Что сделать
1. `electron/services/codexAppServerClient.ts` — JSON-RPC-клиент (NDJSON по stdio, id-корреляция, таймауты, серверные запросы, переподключение); один процесс на проект (broker), потоки — на слот. Чистый парсер кадров — отдельный модуль с unit-тестами.
2. `agentFleetService.runCodexCliAgent` → app-server: системный промпт роли через `baseInstructions`, `sandbox` из прав роли, `effort` из настроек слота, `turn/interrupt` при остановке, `thread/resume` при возобновлении `interrupted`-сессии (decision-16).
3. HITL: `execCommandApproval`/`applyPatchApproval` → `hitlService` (requestId, политика роли, аудит-лог, decision-10); ответ клиента по решению человека/политики. `ENGINE_CAPABILITIES['codex-cli']` → `tools: true` (через `enabled_tools`/sandbox), `maxTurns: true` (счётчик `turn/completed`).
4. Usage/стоимость: из событий turn (если отдаются) — в `agentCost`; иначе таблица цен по модели.
5. Каталог моделей: `model/list` → `ModelSelectorDropdown`/`NewSwarmModal` для движка codex (с `supportedReasoningEfforts`); ручной ввод остаётся.
6. Fallback: если `codex` не установлен или версия без app-server — прежний путь `codex exec` (пометить deprecated) и подсказка установить.
7. Ручной smoke-тест обязателен: Codex на машине разработки сейчас не установлен/не оплачен — реализация по документации, как в TASK-60; зафиксировать минимальную версию `codex` и проверять её в `initialize`.

## Вне scope
Нативный провайдер OpenAI API (отдельная задача), тиры моделей (отдельная задача), экспорт ролей в `.codex/agents/*.toml` (отдельная задача).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Реализован JSON-RPC-клиент codex app-server (initialize/initialized, thread/start, turn/start, события item/*, turn/interrupt, thread/resume) с таймаутами и обработкой падения процесса; парсер кадров покрыт unit-тестами
- [ ] #2 Запросы execCommandApproval и applyPatchApproval попадают в общую HITL-очередь (hitlService) с политикой роли и аудит-логом; решение человека возвращается агенту
- [ ] #3 Слот codex-cli в Swarm стримит текст/рассуждения/вывод команд в Arena, останавливается через turn/interrupt и возобновляется через thread/resume после перезапуска приложения
- [ ] #4 Усилие рассуждений (effort) и модель задаются на слот; каталог моделей берётся из model/list с supportedReasoningEfforts
- [ ] #5 ENGINE_CAPABILITIES['codex-cli'] — tools: true, maxTurns: true; sandbox выводится из прав роли (allowFileWrite/allowCommands)
- [ ] #6 Без установленного codex или при старой версии приложение деградирует (подсказка + прежний exec-путь/API fallback) без краша
- [ ] #7 decision-26 переведён в accepted после ручного smoke-теста с реальным codex; результаты в notes
- [ ] #8 npm run lint/test/check-bundle зелёные, npm run pack:win собран
<!-- AC:END -->
