---
id: TASK-42
title: >-
  Реальный Human-in-the-loop для режима Claude CLI вместо декоративных карточек
  одобрения
status: Done
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-06 02:08'
labels:
  - audit
  - ai-studio
  - claude-code
  - P1
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - electron/services/mcpServerService.ts
  - src/components/ai/InteractiveApprovalCard.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
  - backlog/docs/doc-8 - Human-in-the-loop-для-режима-Claude-CLI-в-AI-Studio.md
modified_files:
  - electron/services/claudeBridgeService.ts
  - electron/services/mcpServerService.ts
  - electron/main.ts
  - tests/unit/claudeCliHitl.test.ts
  - backlog/docs/doc-8 - Human-in-the-loop-для-режима-Claude-CLI-в-AI-Studio.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 5.3 (doc-7).

`claudeBridgeService.runClaudeCliTask` запускает `claude -p ... --dangerously-skip-permissions --output-format stream-json`. Карточки `approvalRequest` для Write/Edit/Bash/Read генерируются при получении события `tool_use`, то есть после того, как инструмент уже выполнен. `sendApprovalResponse` для них возвращает `false`, так как в `pendingApprovals` ничего не зарегистрировано. Human-in-the-loop, списки исключений и deny-list для CLI-режима фактически не работают, хотя UI показывает обратное.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Claude CLI запускается без --dangerously-skip-permissions при autoApprove=false; разрешения запрашиваются через --permission-prompt-tool, указывающий на инструмент встроенного MCP-сервера ProjectHub (или через режим stream-json input с can_use_tool)
- [x] #2 Инструмент разрешений создаёт ApprovalRequest через requestApproval и возвращает CLI решение пользователя (allow/deny с текстом)
- [x] #3 Правила autoApproveRules (writeExcludePatterns, readExcludePatterns, commandDenyList) применяются до выполнения инструмента
- [x] #4 При autoApprove=true поведение эквивалентно текущему, но карточки одобрения не показываются как ожидающие
- [x] #5 Документация в backlog/docs обновлена описанием механизма
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Изучить контракт `--permission-prompt-tool` Claude Code 2.1.260: вход `{tool_name, input, tool_use_id}`, ответ JSON `{"behavior":"allow","updatedInput"}` / `{"behavior":"deny","message"}`; AskUserQuestion — через `updatedInput.answers`.
2. Эмпирически проверить подключение CLI к встроенному SSE-серверу (заголовок Origin не шлётся, Bearer и query-параметр доходят).
3. `claudeBridgeService`: `handleCliPermissionRequest` (правила + карточки через requestApproval), `buildCliPermissionSettings` (правила `permissions.ask` для `--settings`), `prepareCliPermissions` (файлы конфигов в ~/.projecthub/claude_config/hitl), запуск без `--dangerously-skip-permissions`, удаление постфактум-карточек из парсера stdout.
4. `mcpServerService`: инструмент `permission_prompt`, привязка SSE-подключения к сессии по `?phSession=`, отдельный McpServer на подключение, `ensurePermissionEndpoint`.
5. `main.ts`: внедрение брокера адреса сервера.
6. Unit-тесты + сквозная проверка с настоящим `claude -p`.
7. Документация doc-8, переиндексация, `pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Реализация**

- `claude -p` теперь запускается без `--dangerously-skip-permissions`; разрешения идут через `--permission-prompt-tool mcp__projecthub-hitl__permission_prompt` и `--mcp-config` (файл `~/.projecthub/claude_config/hitl/<sessionId>.mcp.json` с Bearer-токеном, удаляется по завершении). SSE-URL несёт `?phSession=<sessionId>` — по нему MCP-сервер привязывает подключение к сессии AI Studio.
- `handleCliPermissionRequest` принимает решение до выполнения инструмента: Bash/Write/Edit/Read/AskUserQuestion/Agent/прочие, с применением `commandDenyList`, `writeExcludePatterns`, `readExcludePatterns`, флагов `allow*` и запретом записи вне корня проекта (как в API-режиме). Карточка показывается через `requestApproval`, так что `sendApprovalResponse` теперь резолвит реальный промис. Отмена сессии → deny для CLI.
- `buildCliPermissionSettings` формирует `--settings` с `permissions.ask`, чтобы allow-правила из `.claude/settings*.json` проекта не обходили настройки ProjectHub (ask > allow).
- AskUserQuestion: по карточке на каждый вопрос, ответы возвращаются в `updatedInput.answers` (ключ — текст вопроса); «Other: …» передаётся как свободный текст.
- `MCP_TOOL_TIMEOUT=86400000` для дочернего CLI — ожидание человека не должно обрываться таймаутом MCP.
- Запасной вариант: сервер не поднялся → при autoApprove=true `--dangerously-skip-permissions` с предупреждением в ответе; при autoApprove=false — ошибка сессии с подсказкой.
- `mcpServerService`: отдельный `McpServer` на каждое SSE-подключение (SDK 1.30 привязывает ответы к последнему подключённому транспорту — общий экземпляр на несколько клиентов отвечал не тому). Постфактум-карточки из парсера stdout удалены.
- Попутно исправлен `isPathExcluded`: шаблоны `**/*.key`, `**/*.pem` из списков по умолчанию раньше не совпадали ни с чем.

**Проверка**

- 20 новых unit-тестов в `tests/unit/claudeCliHitl.test.ts` (всего 82, все проходят), `tsc --noEmit` чистый.
- Сквозная проверка с настоящим `claude -p` (2.1.260) против тестового SSE-сервера с тем же инструментом: полезная нагрузка `{tool_name, input, tool_use_id}`, `echo first` выполнен после allow, `echo second` заблокирован до выполнения после deny, модель получила текст отказа (`permission_denials` в итоговом событии).
- Ручная проверка в собранном `release/win-unpacked/ProjectHub.exe` (карточки в AI Studio при autoApprove=false) — на ревью.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Режим Claude CLI в AI Studio получил реальный Human-in-the-loop: `claude -p` запускается без `--dangerously-skip-permissions`, разрешения запрашиваются через `--permission-prompt-tool` на инструмент `permission_prompt` встроенного MCP-сервера ProjectHub (конфиг с токеном во временном файле, привязка подключения к сессии по `?phSession=`). `handleCliPermissionRequest` применяет autoApproveRules до выполнения инструмента и показывает карточки через `requestApproval`; `--settings` с `permissions.ask` не даёт allow-правилам проекта обойти настройки; AskUserQuestion отвечается через `updatedInput.answers`. Отдельный McpServer на каждое SSE-подключение; исправлен `isPathExcluded` для `**/*.ext`. 20 unit-тестов, сквозная проверка с настоящим CLI 2.1.260 (allow выполнил команду, deny заблокировал до выполнения). Документация doc-8, индекс пересобран, `pack:win` выполнен.
<!-- SECTION:FINAL_SUMMARY:END -->
