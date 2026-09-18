---
id: TASK-99
title: 'Swarm/Handoff: ожидание close агента без ограничения и сироты после tree-kill'
status: To Do
assignee: []
created_date: '2026-09-18 06:05'
labels:
  - agent
  - swarm
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено при TASK-97 (decision-37). `agentFleetService` запускает агентов (`spawn('claude', …)` и `spawn(cmd, invocation.args, …)`, строки около 1499, 1750, 1890), завершает их только по событию `close` (строки 1636, 1820, 1936) и останавливает через собственный `killProcessTree` (tree-kill, на Windows `taskkill /T /F` по снимку дерева). Это тот же механизм, из-за которого в TASK-97 зависал `executeSubprocess`: потомок, созданный после снимка, переживает kill, держит stdio, и `close` не приходит.

Сделать по decision-37: завершение по `exit` с ограниченным ожиданием `close` и уничтожением потоков, добивание потомков через `electron/services/processSweep.ts` после остановки. Перед правкой проверить impact через GitNexus.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Остановка агента Swarm/Handoff завершает ожидание за ограниченное время, даже если stdio держит потомок
- [ ] #2 Пережившие tree-kill потомки добиваются через processSweep.ts
- [ ] #3 Сценарий покрыт unit-тестом с подменённым tree-kill
<!-- AC:END -->
