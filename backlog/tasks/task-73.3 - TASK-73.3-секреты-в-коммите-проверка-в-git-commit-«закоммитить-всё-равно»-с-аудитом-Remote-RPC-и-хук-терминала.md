---
id: TASK-73.3
title: >-
  TASK-73.3 секреты в коммите: проверка в git:commit, «закоммитить всё равно» с
  аудитом, Remote RPC и хук терминала
status: Review
assignee: []
created_date: '2026-09-27 06:12'
updated_date: '2026-09-27 07:03'
labels:
  - security
  - git
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 п. 4. Скан staged-диффа в main, ответ с находками и treeHash, override с аудитом decidedBy local, диалог в GitInspector, отказ в RPC git_commit, PreToolUse git commit → ask.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Коммит с секретом из GitInspector не проходит без подтверждения; подтверждение привязано к treeHash и пишется в аудит без значений
- [x] #2 RPC git_commit с секретом отклоняется
- [x] #3 Хук PreToolUse на git commit с секретом даёт ask (правило secret-scan), ошибка скана — fail-open
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
commitSecretGuard.guardedCommit в git:commit (окно, override по git write-tree с аудитом decidedBy local, правило secret-scan-override) и RPC git_commit (отказ без override); hitlService.recordHumanDecision; диалог в GitInspector (DialogHost). Хук терминала: terminalCommitScan (staged или рабочее дерево+неотслеживаемые для -a и git add &&), вердикт allow→ask с правилом secret-scan, fail-open. Живая проверка GitInspector: коммит с sk-proj-… и .env отклонён, «Закоммитить всё равно» → коммит 56e8869 и запись аудита. Хук терминала вживую не гонялся — тесты на настоящем репозитории и тест сервиса хуков.
<!-- SECTION:NOTES:END -->
