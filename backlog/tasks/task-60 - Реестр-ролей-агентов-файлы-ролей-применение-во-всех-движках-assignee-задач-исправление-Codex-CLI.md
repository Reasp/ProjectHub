---
id: TASK-60
title: >-
  Реестр ролей агентов: файлы ролей, применение во всех движках, assignee задач,
  исправление Codex CLI
status: Done
assignee:
  - veshiy666@gmail.com
created_date: '2026-09-10 07:17'
updated_date: '2026-09-11 11:43'
labels:
  - ade-roadmap
  - roles
  - multi-agent
  - swarm
  - backlog
  - P1
dependencies: []
references:
  - electron/services/agentFleetService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/aiAgentService.ts
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - electron/ipc/backlogIpc.ts
documentation:
  - backlog/decisions/decision-9 - Роль-агента-как-first-class-сущность.md
  - >-
    backlog/decisions/decision-4 -
    Claude-Code-CLI-как-основной-агентный-движок-API-провайдеры-как-дополнение.md
modified_files:
  - electron/services/roleTypes.ts
  - electron/services/roleService.ts
  - electron/services/builtinRoles.ts
  - electron/services/roleEngineAdapter.ts
  - electron/services/swarmTypes.ts
  - electron/services/agentFleetService.ts
  - electron/services/aiAgentService.ts
  - electron/services/appPaths.ts
  - electron/ipc/rolesIpc.ts
  - electron/ipc/aiIpc.ts
  - electron/ipc/backlogIpc.ts
  - electron/ipc/index.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useRolesStore.ts
  - src/store/useSwarmStore.ts
  - src/store/useProjectStore.ts
  - src/components/ai/roles/RolesSettingsModal.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/components/ai/AIStudioView.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - src/lib/engineCapabilities.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - scripts/validate-docs.mjs
  - tests/unit/roleService.test.ts
  - tests/unit/roleEngineAdapter.test.ts
  - tests/unit/agentFleetService.test.ts
  - backlog/decisions/decision-9 - Роль-агента-как-first-class-сущность.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-9, decision-4).

**Что не так сейчас**
- Роль агента это строка `role` и текст `systemPromptAddon` в `AgentSlotConfig`. `systemPromptAddon` применяется только в `runApiAgent`; для `claude-cli` и `codex-cli` игнорируется, CLI-агент получает голый промпт.
- Поле `cliCommand` объявлено, но нигде не используется.
- Пресеты ролей («Архитектор → Кодер → Тестировщик») захардкожены в `NewSwarmModal.tsx`, main-процесс о них не знает.
- Нет привязки роли к модели, инструментам, правам auto-approve, DoD и бюджету. Per-агентного выбора модели в UI нет (провайдер с захардкоженной моделью).
- Codex CLI вызывается с флагом `-m <prompt>` (в Codex это выбор модели), вызов практически всегда падает и молча уходит в fallback на OpenRouter `openai/gpt-4o`. Gemini CLI не поддерживается.
- Handoff передаёт результат конкатенацией stdout без лимита и без артефактов.
- В задачах Backlog.md `assignee` пишется как `[]`, но GUI его не читает и не редактирует; назначить задачу агенту/роли/машине нельзя.

**Что сделать**
1. Формат роли: markdown с frontmatter (`slug`, `name`, `engine`, `model`, `provider`, `tools`, `permissions`, `dod`, `handoffTo`, `maxTurns`, `budgetUsd`), тело файла это системный промпт. Глобальные роли в `<userData>/roles/`, проектные в `<project>/.projecthub/roles/` (переопределяют по `slug`). Загрузчик и валидатор в чистом модуле с unit-тестами; `validate-docs` расширяется на роли проекта.
2. Стартовые роли, поставляемые с приложением: `architect`, `implementer`, `reviewer`, `tester`, `doc-writer` с разумными allow-списками инструментов и путей.
3. Единый адаптер применения роли к движку: для `claude-cli` `--append-system-prompt`, `--allowedTools`/`--disallowedTools`, `--model`, `--max-turns`; для `codex-cli` правильный вызов (`codex exec <prompt>` или актуальный синтаксис, проверить по установленной версии) и его флаги; добавить `gemini-cli`; для API-движка system prompt и фильтр инструментов. Матрица «что движок умеет ограничить» показывается в UI; неподдерживаемое ограничение даёт предупреждение, а не молчание.
4. UI: экран «Роли» в настройках (список, редактор frontmatter и промпта, копирование в проект), выбор роли и модели для каждого слота в `NewSwarmModal`, Handoff как цепочка ролей с проверкой `handoffTo`.
5. Handoff-артефакты: результат этапа это коммит в общем worktree, файл отчёта `.projecthub/handoff/<stage>.md` и резюме ограниченной длины; следующий этап получает ссылки на файлы и резюме, а не весь stdout.
6. `assignee` задачи: чтение и редактирование в `TaskDetailModal`, значения `agent:<roleSlug>` и `agent:<roleSlug>@<hostId>`, кнопка «Запустить назначенного агента» создаёт worktree задачи и стартует агента с ролью; статус агента отображается на карточке.
7. Удалить мёртвое поле `cliCommand` или задействовать его для кастомных CLI-движков (решить в ходе реализации, зафиксировать в notes).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Роли хранятся файлами в userData и в проекте, загружаются с валидацией, проектная роль переопределяет глобальную по slug; пять стартовых ролей поставляются с приложением
- [x] #2 Системный промпт, модель, allow-список инструментов и лимиты роли применяются ко всем движкам (claude-cli, codex-cli, gemini-cli, api); неподдерживаемое ограничение показывает предупреждение в UI
- [ ] #3 Вызов Codex CLI исправлен и проверен на установленной версии; fallback на OpenRouter происходит только с явным сообщением в логах и UI
- [x] #4 В NewSwarmModal для каждого слота выбирается роль и модель; Handoff строится из ролей и передаёт артефакты (коммит, файл отчёта, резюме), а не сырой stdout
- [x] #5 Поле assignee задачи редактируется в GUI, принимает agent:<role>[@host], кнопка запуска назначенного агента создаёт worktree и стартует агента с ролью; статус агента виден на карточке
- [x] #6 Экран «Роли» в настройках позволяет создавать, редактировать и копировать роли в проект
- [x] #7 Unit-тесты на загрузчик/валидатор ролей и адаптер аргументов движков, npm run build проходит
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: `electron/services/roleTypes.ts`/`roleService.ts`/`builtinRoles.ts` — файловый реестр ролей (project > global > builtin), валидатор `parseRoleFile` с unit-тестами; `roleEngineAdapter.ts` — единый адаптер аргументов движка + матрица `ENGINE_CAPABILITIES`, тоже с unit-тестами. `AgentSlotConfig.engine` расширен `gemini-cli`, поле `cliCommand` удалено (было мертво). `agentFleetService.ts`: `runClaudeCliAgent` теперь применяет `--append-system-prompt`/`--allowedTools`/`--max-budget-usd` роли и считает ходы сам (у Claude CLI нет флага `--max-turns` — проверено локально через `claude --help`); `runCodexCliAgent` переписан на `codex exec --json --sandbox --ask-for-approval` (был баг `-m <prompt>`); добавлен `runGeminiCliAgent`. Handoff пишет отчёт `.projecthub/handoff/<n>-<roleSlug>.md`, резюме (лимит 2000 симв.) и `commitHash` вместо сырого stdout без лимита. `startAssignedAgent` + IPC `swarm:runAssigned` запускают роль на assignee задачи (`SwarmSession.origin: 'assigned'`). `backlog:getTasks`/`saveFullTask` читают и пишут `assignee`. Новый экран «Роли» в AI Studio (`RolesSettingsModal.tsx`) и выбор роли в `NewSwarmModal`. `scripts/validate-docs.mjs` обобщён (`requiredFields`) и проверяет `.projecthub/roles`. decision-9 переведён в `accepted` с разделом «Уточнения по факту реализации».

Не сделано / известные ограничения:
- AC #3 не закрыт полностью: `codex`/`gemini` CLI не установлены на машине реализации — флаги адаптера взяты из актуальной публичной документации (developers.openai.com/codex, geminicli.com), а НЕ проверены эмпирически. Нужен ручной smoke-test на машине с этими CLI, прежде чем считать критерий выполненным.
- Handoff проверяет `handoffTo` мягко (предупреждение в UI), не блокирует запуск при несовпадении цепочки.
- `assignee` в GUI — текстовое поле с datalist-автодополнением, а не строгий `<select>`; `hostId` вне локального хоста явно отклоняется (федерация — TASK-66).
- `npm run build` (lint 0 ошибок/484 предупреждения — не выше базовой линии, test 281/281, tsc, vite, check-bundle) и `npm run lint:docs` зелёные; `npm run pack:win` выполнен.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude
created: 2026-09-11 11:23
---
Переведено в Done по решению пользователя (2026-09-11). **AC #3 остаётся неотмеченным**: `codex` и `gemini` CLI на машине по-прежнему не установлены (проверено `command -v` 11.09.2026), поэтому флаги адаптера так и взяты из публичной документации, а не проверены эмпирически. Что именно ждёт ручного smoke-теста, когда CLI появятся: вызов `codex exec --json --sandbox --ask-for-approval` в `runCodexCliAgent` и аргументы `runGeminiCliAgent` в `agentFleetService.ts`, плюс проверка, что fallback на OpenRouter срабатывает только с явным сообщением в логах и UI.
---

author: Claude
created: 2026-09-11 11:43
---
Проверка Codex CLI снята с долга по решению пользователя (2026-09-11): подписка на Codex не оплачена, поэтому эмпирически проверить `codex exec --json --sandbox --ask-for-approval` невозможно в принципе — это не незакрытая работа, а вне области работ. Код адаптера остаётся как есть (флаги по документации developers.openai.com/codex); если подписка появится — прогнать smoke-тест тогда. Из AC #3 фактически остаётся открытой только часть про Gemini CLI (`runGeminiCliAgent`), если доступ к нему есть.
---
<!-- COMMENTS:END -->
