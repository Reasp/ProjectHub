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

- `electron/services/claudeBridgeService.ts`: `handleCliPermissionRequest`, `buildCliPermissionSettings`, `prepareCliPermissions`, `isPathExcluded`, константы `CLI_HITL_*`.
- `electron/services/mcpServerService.ts`: инструмент `permission_prompt`, `ensurePermissionEndpoint`, `createMcpServer(hitlSessionId)`.
- `electron/main.ts`: `claudeBridgeService.setCliPermissionBroker(...)` — внедрение адреса MCP-сервера.
- Тесты: `tests/unit/claudeCliHitl.test.ts`.
