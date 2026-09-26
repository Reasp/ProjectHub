---
id: TASK-76.2
title: >-
  Память: memoryService, инструменты memory_* во встроенном MCP и у API-агента,
  аудит
status: Review
assignee: []
created_date: '2026-09-26 13:28'
updated_date: '2026-09-26 13:44'
labels:
  - memory
  - mcp
dependencies:
  - TASK-76.1
parent_task_id: TASK-76
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-51 п. 3, 4. memoryService (чтение, запись в основное дерево, приведение worktree к корню проекта через реестр, сериализация записей, обновление MEMORY.md), memory_write/memory_search/memory_delete в mcpServerService и в общем исполнителе API, пропуск без второго permission_prompt, запись в аудит, IPC для UI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 memory_write из worktree агента пишет факт в backlog/memory основного дерева; путь вне зарегистрированных проектов отклоняется
- [x] #2 Запись с секретом или дубликатом отклоняется с понятной причиной; replace обновляет факт; MEMORY.md всегда соответствует файлам
- [x] #3 Инструменты доступны Claude CLI через встроенный MCP и API-агенту через исполнитель; каждая запись и удаление видны в аудит-логе
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано: memoryStore.ts (fs без Electron: readMemory с invalid-файлами, writeMemoryFact с проверками формата/секретов/дубликатов, replace с переименованием файла, deleteMemoryFact, атомарная запись через tmp+rename, сериализация записей одного проекта, пересборка MEMORY.md только при изменении), memoryTools.ts (каталог memory_write/search/delete с JSON-схемами, resolveMemoryProjectRoot через findOwningProject — worktree агента приводится к корню проекта, callMemoryTool с аудитом allow/deny по правилу memory, тексты отказов без значений секретов, buildMemoryInstructions), memoryToolDeps.ts (реестр и hitlService). Claude CLI: инструменты во встроенном MCP (createMcpServer), контекст из CLI-сессии (getMemoryCallContext, taskId в CliPermissionMeta для AI Studio и Swarm), пропуск без второго permission_prompt. API: вид memory в apiToolPolicy (поиск — с Read, запись/удаление — с Write), делегирование в ApiToolExecutor.callMemoryTool, taskId в ApiToolContext, определения в getAnthropicTools, категории read/write в roleEngineAdapter. IPC memory:list/write/delete с assertRegisteredProject, preload и типы. Тесты: memoryStore (8), memoryTools (8), memoryApiTools (5), mcpMemoryTools — сквозной через настоящий MCP-сервер и SSE-клиент (3); соседние apiToolPolicy/apiToolExecutor/roleEngineAdapter/claudeBridgeService/mcpServerAuth/hitlService зелёные; tsc и eslint чисто.
<!-- SECTION:NOTES:END -->
