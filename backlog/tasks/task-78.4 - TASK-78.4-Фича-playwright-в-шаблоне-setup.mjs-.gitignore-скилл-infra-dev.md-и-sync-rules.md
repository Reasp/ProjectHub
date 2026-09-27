---
id: TASK-78.4
title: >-
  TASK-78.4 Фича playwright в шаблоне: setup.mjs, .gitignore, скилл,
  infra-dev.md и sync-rules
status: Done
assignee: []
created_date: '2026-09-27 05:15'
updated_date: '2026-09-27 05:59'
labels:
  - playwright
  - template
dependencies: []
parent_task_id: TASK-78
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
setup.mjs добавляет/убирает Playwright MCP в .mcp.json и .agents/mcp_config.json и дописывает .playwright-mcp/ в .gitignore; правило в infra-dev.md о проверке UI; обе копии скилла init-dev-project.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 setup.mjs добавляет и убирает запись playwright в обоих MCP-конфигах, по умолчанию фича выключена
- [x] #2 Правило в infra-dev.md разослано sync-rules; обе копии скилла обновлены
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: фича playwright в setup.mjs (по умолчанию выключена; npx --yes @playwright/mcp@0.0.82 --headless --isolated в .mcp.json и .agents/mcp_config.json; .playwright-mcp/ в .gitignore), main() не запускается при импорте. Правило 22 в infra-dev.md, sync-rules выполнен, обе копии скилла init-dev-project обновлены. Тест setupPlaywright: настоящий запуск в копии, добавление и удаление. F:\ProjectTemplate (отдельный репозиторий) отстаёт — нет computerUse и playwright.
<!-- SECTION:NOTES:END -->
