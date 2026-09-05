---
id: TASK-42
title: >-
  Реальный Human-in-the-loop для режима Claude CLI вместо декоративных карточек
  одобрения
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
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
- [ ] #1 Claude CLI запускается без --dangerously-skip-permissions при autoApprove=false; разрешения запрашиваются через --permission-prompt-tool, указывающий на инструмент встроенного MCP-сервера ProjectHub (или через режим stream-json input с can_use_tool)
- [ ] #2 Инструмент разрешений создаёт ApprovalRequest через requestApproval и возвращает CLI решение пользователя (allow/deny с текстом)
- [ ] #3 Правила autoApproveRules (writeExcludePatterns, readExcludePatterns, commandDenyList) применяются до выполнения инструмента
- [ ] #4 При autoApprove=true поведение эквивалентно текущему, но карточки одобрения не показываются как ожидающие
- [ ] #5 Документация в backlog/docs обновлена описанием механизма
<!-- AC:END -->
