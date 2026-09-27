---
id: TASK-78.2
title: 'TASK-78.2 Сервис артефактов, проверки с артефактами, политика browser_* и IPC'
status: Done
assignee: []
created_date: '2026-09-27 05:15'
updated_date: '2026-09-27 05:59'
labels:
  - playwright
  - quality
dependencies: []
parent_task_id: TASK-78
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
executeCheck получает каталог артефактов и собирает их; судья и Done-loop передают scope; политика browser_* в claudeBridge и хуках терминала; IPC чтения и показа артефактов; удаление с сессией и ротация.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Проверка ui-smoke в Arena и Done-loop получает PROJECTHUB_ARTIFACTS_DIR, артефакты попадают в CheckRunResult и в userData/visual
- [x] #2 Вердикт browser_* применяется для агентов ProjectHub (permission-prompt-tool) и терминальных хуков; автономный запуск отклоняет host
- [x] #3 IPC visual:readArtifact и visual:revealArtifact не выходят за userData/visual; каталог удаляется вместе с сессией
- [x] #4 Done-loop сверяет скриншоты отчёта с артефактами итерации
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-27: visualArtifactService.ts (<userData>/visual), executeCheck с целью артефактов (PROJECTHUB_ARTIFACTS_DIR и ${artifactsDir}; судья judge-<время>, Done-loop iter-N, прочие adhoc), контекст { autonomous, workDir } в evaluateToolRequest из claudeBridgeService и terminalHookService, IPC visual:readArtifact/revealArtifact, удаление каталога вместе с сессией. Тесты: visualCheckFleet (настоящий runOnce и Done-loop), claudeCliBrowserHitl.
<!-- SECTION:NOTES:END -->
