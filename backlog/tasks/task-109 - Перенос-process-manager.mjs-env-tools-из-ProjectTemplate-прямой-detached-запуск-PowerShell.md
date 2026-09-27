---
id: TASK-109
title: >-
  Перенос process-manager.mjs env-tools из ProjectTemplate: прямой
  detached-запуск PowerShell
status: To Do
assignee: []
created_date: '2026-09-27 23:49'
labels:
  - infra
  - template-sync
dependencies: []
priority: low
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обнаружено при сверке в TASK-107: `scripts/env/process-manager.mjs` в F:\ProjectTemplate новее, чем в ProjectHub. Шаблон запускает PowerShell-обёртку напрямую (`spawn('powershell.exe', [...], { detached: true })`), а хаб — через `cmd /c start /b`, который, по заметке шаблона (его TASK-1), работал нестабильно при закрытии терминала и потере stdin. Нужно сравнить поведение, перенести вариант шаблона в хаб (или обосновать отказ) и проверить env-tools вживую: start_process/tail_log/stop_process, переживание закрытия родителя.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Различия process-manager.mjs хаба и шаблона разобраны, решение записано в задаче
- [ ] #2 env-tools в хабе проверен вживую: запуск, лог, остановка, переживание завершения родителя
- [ ] #3 npm test и npm run lint зелёные
<!-- AC:END -->
