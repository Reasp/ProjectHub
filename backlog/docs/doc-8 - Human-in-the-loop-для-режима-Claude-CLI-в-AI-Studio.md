---
id: doc-8
title: Human-in-the-loop для режима Claude CLI в AI Studio
type: specification
created_date: '2026-09-06 02:02'
tags:
  - ai-studio
  - claude-code
  - security
  - mcp
---
# Human-in-the-loop для режима Claude CLI в AI Studio

Документ описывает, как AI Studio ProjectHub запрашивает у пользователя подтверждение действий Claude Code, когда провайдер `anthropic` работает через локальный Claude CLI (без API-ключа). Механизм введён в TASK-42 по пункту 5.3 технического аудита (doc-7): раньше CLI запускался с `--dangerously-skip-permissions`, а карточки одобрения генерировались по событию `tool_use`, то есть уже после выполнения инструмента, и ни на что не влияли.

> **TASK-57 (decision-10).** Механизм обобщён до единого HITL-контура для всех агентов: очередь запросов с `requestId` живёт в `hitlService`, через неё проходят AI Studio (CLI и API-движок), Swarm и Handoff; решения принимаются из окна, с удалённого устройства и от MCP-клиентов одним методом `decide(requestId, …)`; каждое решение пишется в аудит-лог. Раздел «Единый контур (TASK-57)» ниже описывает отличия; остальной документ про правила Claude CLI остаётся в силе.

## Единый контур (TASK-57)

- **Очередь** — `electron/services/hitlService.ts`: `request()` ставит карточку (`HitlRequest`, он же `ApprovalRequest` рендерера) в очередь и ждёт решения; `decide(requestId, response, source)` — единственная точка ответа для окна (`claudeBridge:sendApprovalResponse`, `hitl:decide`), Remote Control (RPC `hitl_decision` с обязательным `requestId`) и MCP-клиентов (`projecthub_approve_action`, обязательный `requestId`; список — `projecthub_list_pending_approvals`). Первый ответ выигрывает, повторный получает `already_decided`. Одобрение «верхнего в очереди» удалено из `App.tsx`.
- **Персистентность** — `<userData>/hitl/pending.json`. После перезапуска записи восстанавливаются как `orphaned`: агент уже не ждёт ответа, они видны в панели, истекают по таймауту, решение по ним попадает только в аудит (`outcome: session_gone`).
- **Таймаут** — по умолчанию 24 часа, минимум 10 секунд; настраивается в AI Studio → Auto-approve («Таймаут ожидания решения»). По истечении CLI/агент получает `deny`.
- **Отмена** — `cancelSession(sessionId)` при завершении/прерывании сессии AI Studio (`finishSession`, `abortSession`) и при завершении процесса агента Swarm (`swarm-<agentId>`); при выходе из приложения `shutdown()` оставляет записи на диске.
- **Политика** — `electron/services/hitlPolicy.ts`: `evaluateToolRequest(config, projectPath, tool, input)` даёт `allow | deny | ask` с именем правила; `applyRolePermissions(config, permissions)` сужает глобальные настройки правами роли (decision-9): `false` запрещает категорию, списки исключений и deny-list объединяются, таймауты берутся минимальные, `allowedTools` пересекаются. Запись вне корня проекта — `deny` при любой комбинации (`outside-project`).
- **Swarm/Handoff** — `agentFleetService.runClaudeCliAgent` вызывает тот же `claudeBridgeService.prepareCliPermissions(sessionId, cwd, globalConfig, onChunk, meta)` с `meta = { origin, engine, agentId, agentName, role, permissions }` (права из `AgentSlotConfig.permissions`). Флаг `--dangerously-skip-permissions` остаётся только как fallback при недоступном MCP-сервере и включённом (и не суженном ролью) auto-approve: пишется строка `fallback` в аудит, событие `hitl:fallback` показывает предупреждение в окне; при выключенном auto-approve агент не стартует.
- **Аудит** — `<userData>/audit/hitl-<yyyy-mm>.jsonl` (`electron/services/hitlAudit.ts`): строки `decision` (кто решил: `local`/`remote`+`deviceId`/`mcp`/`auto`+`rule`/`timeout`/`cancelled`/`shutdown`; инструмент, путь, SHA-256 команды и превью с вырезанными секретами, комментарий, время ожидания), `outcome` (результат выполнения: для CLI по `tool_use_id` из `tool_result`, для API-движка по коду выхода/успеху записи), `fallback`. Диффы и содержимое файлов не пишутся. Просмотр — «Центр решений» → «История решений» (фильтры, экспорт CSV/JSONL/JSON), кнопка также в настройках AI Studio.
- **Шина событий** — `electron/services/eventBus.ts` (`appEventBus`): `hitl:requested|decided|expired|cancelled|fallback`, `agent:started|finished|failed`. Подписчики: рендерер (`bus:event` → `useHitlStore`), Remote Control (`ai:hitl`, `ai:hitlDecided`, `agent:*` доверенным устройствам), далее уведомления (TASK-63).
- **UI** — бейдж в шапке и кнопка в сайдбаре с числом ожидающих запросов всех сессий; «Центр решений» (`src/components/hitl/HitlCenterModal.tsx`) показывает источник (AI Studio/Swarm/Handoff), агента и роль, проект, инструмент, команду или путь, время ожидания и срок; карточка `InteractiveApprovalCard` переиспользуется для вопросов и диффов. Карточка в AI Studio снимается по событию `hitl:decided` независимо от того, откуда пришёл ответ.
- **Тесты** — `tests/unit/hitlService.test.ts` (очередь, адресация, таймауты, отмена, персистентность, аудит), `hitlPolicy.test.ts` (сужение правами роли, вердикты), `hitlAudit.test.ts` (формат jsonl, ротация по месяцам, редактирование секретов, экспорт).

## Общая схема

1. `claudeBridgeService.runClaudeCliTask` запускает `claude -p … --output-format stream-json` **без** `--dangerously-skip-permissions`. В режиме `-p` стартовый режим разрешений Claude Code — «Manual»: любой инструмент, который не разрешён allow-правилом, требует подтверждения.
2. Подтверждения CLI отправляет во встроенный MCP-сервер ProjectHub (`mcpServerService`, `http://127.0.0.1:42042/sse`) через флаг `--permission-prompt-tool mcp__projecthub-hitl__permission_prompt`. Конфиг сервера передаётся флагом `--mcp-config <файл>`; файл лежит в `~/.projecthub/claude_config/hitl/<sessionId>.mcp.json`, содержит Bearer-токен сервера и удаляется по завершении процесса.
3. SSE-URL в конфиге содержит query-параметр `phSession=<sessionId>`. По нему `mcpServerService` привязывает MCP-подключение к сессии AI Studio и на каждое подключение создаёт отдельный экземпляр `McpServer` (SDK привязывает ответы к последнему подключённому транспорту, один общий сервер на несколько SSE-клиентов работает некорректно).
4. Инструмент `permission_prompt` получает `{ tool_name, input, tool_use_id }` и вызывает `claudeBridgeService.handleCliPermissionRequest(sessionId, …)`. Ответ — JSON в текстовом содержимом инструмента: `{"behavior":"allow","updatedInput":{…}}` или `{"behavior":"deny","message":"…"}`. Решение принимается **до** выполнения инструмента.
5. Если требуется решение человека, `handleCliPermissionRequest` создаёт `ApprovalRequest`, отправляет его в рендерер чанком `approvalRequest` и ждёт `requestApproval`. Карточка `InteractiveApprovalCard` вызывает `sendApprovalResponse`, промис резолвится, CLI получает ответ. Прерывание сессии (`abortSession`, `clearSession`, закрытие приложения) отклоняет ожидание и возвращает CLI `deny`.
6. Для дочернего процесса задаётся `MCP_TOOL_TIMEOUT=86400000`: стандартного таймаута MCP-инструмента недостаточно, когда ответа ждут от человека.

## Применение правил autoApproveRules

Правила из настроек AI Studio (`AISettingsModal`) применяются в `handleCliPermissionRequest` для каждого запроса:

| Инструмент Claude Code | autoApprove = true | autoApprove = false |
|---|---|---|
| `Bash` | allow, кроме команд из `commandDenyList` и при `allowCommands = false` — тогда карточка `command` | всегда карточка `command` |
| `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | путь вне корня проекта — deny без карточки (TASK-32); путь из `writeExcludePatterns` или `allowFileWrite = false` — карточка `file_write` с дифом; иначе allow | путь вне проекта — deny; иначе карточка `file_write` |
| `Read`, `NotebookRead` | allow, кроме путей из `readExcludePatterns`, путей вне проекта и `allowFileRead = false` — тогда вопрос «Разрешить/Запретить чтение» | так же |
| `AskUserQuestion` | по карточке-вопросу на каждый элемент `questions`; ответы возвращаются в `updatedInput.answers` (ключ — текст вопроса, значение — выбранные варианты или свободный текст «Other») | так же |
| `Agent`, `Task` (подагенты) | allow, при `allowSubagents = false` — карточка `subagent_dispatch` | так же |
| прочие (`WebFetch`, MCP-инструменты …) | allow | общая карточка с именем инструмента и входом |

Claude Code вызывает инструмент разрешений только для тех действий, которые он сам считает требующими подтверждения. Чтобы allow-правила из `.claude/settings.json` / `settings.local.json` проекта не обходили настройки ProjectHub, `buildCliPermissionSettings` формирует файл `--settings` с правилами `permissions.ask` (ask имеет приоритет над allow):

- при `autoApprove = false` — `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`;
- при `allowCommands = false` — `Bash`; при `allowFileWrite = false` — инструменты записи; при `allowFileRead = false` — `Read`; при `allowSubagents = false` — `Agent`, `Task`;
- для каждой записи `commandDenyList` — `Bash(<команда>*)`;
- для каждого шаблона `writeExcludePatterns` — `Edit(<шаблон>)`, `Write(<шаблон>)`; для `readExcludePatterns` — `Read(<шаблон>)`. Шаблон без префикса пути (`.env*`, `*.key`) дублируется формами `./<шаблон>` и `**/<шаблон>`, чтобы правило срабатывало на любой глубине.

Итоговое решение всегда принимает `handleCliPermissionRequest`; правила `ask` лишь гарантируют, что запрос до него дойдёт. Шаблоны исключений сопоставляются функцией `isPathExcluded` (поддерживает `**/*.ext`, `*.ext`, `prefix*`, `*sub*`, `./path`, точное имя файла на любой глубине).

## Режим autoApprove = true

Поведение для пользователя эквивалентно прежнему: обычные команды и правки выполняются без карточек, чанки `toolCall` по-прежнему отображаются в диалоге. Отличие — списки исключений, deny-list и флаги `allow*` теперь реально блокируют действие до его выполнения, а не только рисуют карточку постфактум.

## Запасной вариант

Если встроенный MCP-сервер поднять не удалось (`mcpServerService.ensurePermissionEndpoint()` вернул `null`, например заняты все порты 42042–42051):

- при `autoApprove = true` CLI запускается с `--dangerously-skip-permissions`, а в ответ добавляется предупреждение, что исключения и deny-list не применяются;
- при `autoApprove = false` сессия завершается ошибкой с подсказкой включить сервер или авто-одобрение — молчаливого выполнения без подтверждений нет.

## Ключевые места в коде

- `electron/services/claudeBridgeService.ts`: `handleCliPermissionRequest` (вердикт через `evaluateToolRequest`, карточки через `hitlService`), `buildCliPermissionSettings`, `prepareCliPermissions` (публичный, с `meta` агента), `noteCliUserEvent` (результаты инструментов в аудит), константы `CLI_HITL_*`.
- `electron/services/hitlService.ts`, `hitlPolicy.ts`, `hitlAudit.ts`, `hitlTypes.ts`, `eventBus.ts` — единый контур (TASK-57).
- `electron/services/agentFleetService.ts`: `prepareAgentHitl`, `runClaudeCliAgent` — Swarm/Handoff через тот же контур.
- `electron/services/mcpServerService.ts`: инструмент `permission_prompt`, `ensurePermissionEndpoint`, `createMcpServer(hitlSessionId)`, `projecthub_list_pending_approvals`, `projecthub_approve_action`.
- `electron/ipc/hitlIpc.ts`: `hitl:listPending`, `hitl:decide`, `hitl:listAudit`, `hitl:exportAudit`, трансляция `bus:event`.
- `electron/main.ts`: `claudeBridgeService.setCliPermissionBroker(...)` — внедрение адреса MCP-сервера; `hitlService.init(...)` и `hitlService.shutdown()`.
- Рендерер: `src/store/useHitlStore.ts`, `src/components/hitl/HitlCenterModal.tsx`, `HitlBadge.tsx`.
- Тесты: `tests/unit/claudeCliHitl.test.ts`, `hitlService.test.ts`, `hitlPolicy.test.ts`, `hitlAudit.test.ts`.
