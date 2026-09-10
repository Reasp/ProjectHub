---
id: TASK-59
title: >-
  Мелкий долг после ревизии: единый appPaths вместо ~/.projecthub, дефолт языка,
  задачи 51/52 в completed, лишние файлы в корне, release_tmp
status: To Do
assignee: []
created_date: '2026-09-10 07:16'
labels:
  - ade-roadmap
  - tech-debt
  - cleanup
  - P2
dependencies: []
references:
  - electron/services/appPaths.ts
  - electron/services/agentFleetService.ts
  - electron/services/remoteControlService.ts
  - index.html
  - src/store/useProjectStore.ts
  - src/components/processes/ProcessesView.tsx
  - scripts/pack-win.mjs
documentation:
  - >-
    backlog/decisions/decision-7 -
    Local-first-хранение-состояния-и-отсутствие-телеметрии.md
  - >-
    backlog/decisions/decision-3 -
    Backlog.md-как-единственный-источник-истины-для-задач-документов-и-решений.md
priority: low
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-7, decision-3). Мелкие несоответствия, которые не стоит тянуть в большие задачи.

**Что сделать**
1. Заменить все жёсткие `os.homedir()/.projecthub` в сервисах (`agentFleetService`, `claudeBridgeService` для `claude_config`, `aiSessionStore`, `remoteControlService`, `secretStorageService` и др.) на `appPaths`; сохранить fallback на `~/.projecthub` для скриптов и тестов; при первом запуске новой версии мигрировать существующие файлы из старого пути, если новый пуст.
2. Согласовать язык по умолчанию: `index.html` содержит `lang="ru"`, а стор ставит `en`. Выбрать один дефолт (предлагается: язык системы, fallback `en`) и выставлять атрибут `lang` динамически при переключении.
3. Перенести `task-51` и `task-52` (статус Done) из `backlog/tasks/` в `backlog/completed/` штатной командой Backlog.md.
4. Удалить `contextdump.md` и `infra-dev.md` из корня репозитория, если они дублируют doc-9 и CLAUDE.md; если `infra-dev.md` является источником для `sync-rules`, оставить и описать это в README, иначе удалить.
5. Удалить каталог `release_tmp_1788738990099/` (уже в .gitignore) и проверить, что `pack-win.mjs` чистит временные каталоги после успешной сборки.
6. Исправить ошибку ESLint `react-hooks/rules-of-hooks` (условный вызов `useDialog`) в `src/components/processes/ProcessesView.tsx` в рамках TASK-48, либо здесь, если TASK-48 отложена.
7. Каждый JSON-файл состояния получает поле `version` и функцию миграции при чтении (decision-7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 grep по os.homedir() и '.projecthub' в electron/ не находит жёстких путей к состоянию, все сервисы используют appPaths; существующие данные мигрируют при первом запуске
- [ ] #2 Дефолт языка определяется одним правилом, атрибут lang в html меняется при переключении языка
- [ ] #3 task-51 и task-52 лежат в backlog/completed, веб-интерфейс Backlog.md показывает их без ошибок
- [ ] #4 В корне репозитория нет contextdump.md; судьба infra-dev.md решена и описана в README; release_tmp_* удалён
- [ ] #5 npm run lint даёт 0 ошибок
- [ ] #6 Файлы состояния в userData содержат поле version и читаются через миграцию
<!-- AC:END -->
