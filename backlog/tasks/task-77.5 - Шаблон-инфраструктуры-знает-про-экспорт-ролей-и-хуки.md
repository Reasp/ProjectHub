---
id: TASK-77.5
title: Шаблон инфраструктуры знает про экспорт ролей и хуки
status: Review
assignee: []
created_date: '2026-09-27 04:17'
updated_date: '2026-09-27 04:54'
labels:
  - infra
dependencies: []
parent_task_id: TASK-77
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
setup.mjs и init-dev-project (обе копии) не трогают .claude/agents, .codex, .projecthub/hooks и чужие ключи .claude/settings.json; упоминание в infra-dev.md и sync-rules. decision-54 п. 11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 setup.mjs и скилл описывают новые файлы, sync-rules не ломается
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Правило 21 infra-dev.md + sync-rules, подсказка setup.mjs, абзац в обеих копиях init-dev-project; проверено во временной копии шаблона.
<!-- SECTION:NOTES:END -->
