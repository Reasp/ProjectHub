---
id: TASK-76.6
title: >-
  Живая проверка памяти: Claude CLI и API-агент на Ollama, скриншот собранного
  exe
status: In Progress
assignee: []
created_date: '2026-09-26 13:28'
updated_date: '2026-09-26 14:38'
labels:
  - memory
  - qa
dependencies:
  - TASK-76.3
  - TASK-76.4
  - TASK-76.5
parent_task_id: TASK-76
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Во временном проекте: Claude CLI записывает факт через memory_write и видит его в следующем запуске; то же на API-агенте (локальная qwen2.5:7b-instruct или 192.168.1.11 ornith:35b); запись с секретом отклоняется; заметка хода появляется в задаче. Скриншоты раздела памяти и ContextAppliedCard в собранном exe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Claude CLI и API-агент пишут и читают память одинаково; отказ на секрет подтверждён вживую
- [x] #2 Заметка хода появилась в задаче после живого прогона
- [ ] #3 Скриншоты собранного exe; lint, test, check-bundle, lint:docs зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Живая проверка 2026-09-26
<!-- SECTION:NOTES:END -->
