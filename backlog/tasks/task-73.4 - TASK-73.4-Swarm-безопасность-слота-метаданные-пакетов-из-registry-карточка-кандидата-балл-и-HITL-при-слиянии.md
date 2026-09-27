---
id: TASK-73.4
title: >-
  TASK-73.4 Swarm: безопасность слота, метаданные пакетов из registry, карточка
  кандидата, балл и HITL при слиянии
status: Review
assignee: []
created_date: '2026-09-27 06:12'
updated_date: '2026-09-27 07:03'
labels:
  - security
  - swarm
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 п. 5–7. agent.security при расчёте диффа, npm view с кэшем и проверкой имени, блок в карточке кандидата SwarmArenaView, компонент security в судье, запрет авто-мерджа, HITL в pickWinner и composeFromCandidates, сводка для ревьюера.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Карточка кандидата показывает секреты и добавленные зависимости с датой публикации и флагами
- [x] #2 Балл кандидата с секретом получает штраф компонента security, авто-мердж запрещён
- [x] #3 Pick Winner и сборка из файлов с секретами или новыми пакетами ждут решения в общей очереди HITL
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
agent.security при диффе (секреты без маркера агента, зависимости база↔worktree, lock, requirements), npm view в фоне с кэшем и проверкой имени, SlotSecurityPanel в карточке, компонент security в судье, маскировка секретов в диффе для ревьюера, шлюз слияния в pickWinner/composeFromCandidates (HITL 30 мин, pendingMergeApproval, баннер). Живая проверка: 2 слота Claude haiku добавили left-pad 1.3.0 и пример ключа AWS — блок «Безопасность» в карточках, deprecated из настоящего npm view, security 0/10; Pick Winner → запрос в Центре решений → одобрение → слияние 1c8f652. Исправлено по живой проверке: дубль уведомления после фоновых флагов registry.
<!-- SECTION:NOTES:END -->
