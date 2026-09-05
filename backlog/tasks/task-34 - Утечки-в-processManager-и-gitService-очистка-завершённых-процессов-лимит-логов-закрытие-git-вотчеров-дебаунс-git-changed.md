---
id: TASK-34
title: >-
  Утечки в processManager и gitService: очистка завершённых процессов, лимит
  логов, закрытие git-вотчеров, дебаунс git:changed
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
labels:
  - audit
  - memory-leak
  - process-manager
  - git
  - P1
dependencies: []
references:
  - electron/services/processManager.ts
  - electron/services/gitService.ts
  - src/store/useProjectStore.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 2.1, 2.2, 3.3 (doc-7).

`processManager.activeProcesses` никогда не очищается после завершения процесса; `logBuffer` ограничен 2000 чанками (не строками), чанк до 64 КБ, то есть до ~128 МБ на процесс. `gitService.watchProjectGit` создаёт chokidar-вотчер на корень каждого открытого проекта с `depth: 3` и никогда не закрывает его (`unwatchProjectGit` нигде не вызывается); список `ignored` не включает `venv`, `target`, `build`, `coverage`, `.next`, `__pycache__`. Любое изменение файла в проекте через 400 мс запускает в рендерере `loadGitRepoDetails` с шестью git-командами, что во время сборки или `npm install` даёт шторм процессов git.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Завершённые процессы удаляются из activeProcesses через таймаут (например, 10 минут) или при превышении лимита записей, статус остаётся доступным через .env-state
- [ ] #2 logBuffer ограничен по суммарному объёму байт (например, 2 МБ) с усечением старых данных
- [ ] #3 gitService.unwatchProjectGit вызывается при deactivateProject/closeCurrentProject (новый IPC git:unwatch) и при удалении проекта из реестра
- [ ] #4 Список ignored вотчера расширен типовыми каталогами сборки и окружений; глубина корневого вотчера снижена или заменена на вотчер только .git/HEAD, .git/index, .git/refs плюс git status по дебаунсу
- [ ] #5 Дебаунс git:changed увеличен (не менее 1,5 с) и события во время активного процесса из processManager для того же проекта агрегируются
- [ ] #6 Проверено: после открытия и закрытия 10 проектов число активных FSWatcher равно числу открытых проектов
<!-- AC:END -->
