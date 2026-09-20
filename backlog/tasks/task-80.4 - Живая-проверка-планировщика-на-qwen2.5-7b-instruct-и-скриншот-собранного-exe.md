---
id: TASK-80.4
title: 'Живая проверка планировщика на qwen2.5:7b-instruct и скриншот собранного exe'
status: To Do
assignee: []
created_date: '2026-09-20 01:59'
labels:
  - swarm
  - planning
  - qa
dependencies:
  - TASK-80.3
parent_task_id: TASK-80
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
План из трёх подзадач (две независимые, третья зависит от обеих) на локальной Ollama (qwen2.5:7b-instruct, localhost:11434) во временном git-репозитории: генерация плана с валидацией и повтором, утверждение, параллельный запуск, слияние в интеграционную ветку, конфликт в HITL (одобрения через MCP `projecthub_list_pending_approvals`/`projecthub_approve_action`), сводка в родительской задаче. Скриншоты вкладки «План» в собранном exe по схеме TASK-102.3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Живой прогон: план из трёх подзадач сгенерирован, утверждён и выполнен с параллельными узлами и слиянием
- [ ] #2 Скриншоты вкладки «План» в собранном exe
- [ ] #3 lint, test, check-bundle, lint:docs зелёные; pack:win собран
<!-- AC:END -->
