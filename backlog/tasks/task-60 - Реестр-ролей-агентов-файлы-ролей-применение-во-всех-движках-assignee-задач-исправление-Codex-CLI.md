---
id: TASK-60
title: >-
  Реестр ролей агентов: файлы ролей, применение во всех движках, assignee задач,
  исправление Codex CLI
status: To Do
assignee: []
created_date: '2026-09-10 07:17'
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
- [ ] #1 Роли хранятся файлами в userData и в проекте, загружаются с валидацией, проектная роль переопределяет глобальную по slug; пять стартовых ролей поставляются с приложением
- [ ] #2 Системный промпт, модель, allow-список инструментов и лимиты роли применяются ко всем движкам (claude-cli, codex-cli, gemini-cli, api); неподдерживаемое ограничение показывает предупреждение в UI
- [ ] #3 Вызов Codex CLI исправлен и проверен на установленной версии; fallback на OpenRouter происходит только с явным сообщением в логах и UI
- [ ] #4 В NewSwarmModal для каждого слота выбирается роль и модель; Handoff строится из ролей и передаёт артефакты (коммит, файл отчёта, резюме), а не сырой stdout
- [ ] #5 Поле assignee задачи редактируется в GUI, принимает agent:<role>[@host], кнопка запуска назначенного агента создаёт worktree и стартует агента с ролью; статус агента виден на карточке
- [ ] #6 Экран «Роли» в настройках позволяет создавать, редактировать и копировать роли в проект
- [ ] #7 Unit-тесты на загрузчик/валидатор ролей и адаптер аргументов движков, npm run build проходит
<!-- AC:END -->
