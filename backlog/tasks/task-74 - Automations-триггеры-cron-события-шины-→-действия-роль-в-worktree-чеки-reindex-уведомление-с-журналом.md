---
id: TASK-74
title: >-
  Automations: триггеры (cron, события шины) → действия (роль в worktree, чеки,
  reindex, уведомление) с журналом
status: To Do
assignee: []
created_date: '2026-09-15 03:11'
labels:
  - automation
  - eventbus
  - swarm
  - scheduler
milestone: m-0
dependencies: []
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude Code получил Routines (cron и GitHub-триггеры), Codex Cloud/Cursor запускают фоновых агентов по событиям. В ProjectHub уже есть кирпичи: `eventBus`, `notificationRules` (событие → канал), `assignedTaskRunner` + `assignedTaskRules` (единственный автозапуск агента — по назначению задачи на хост, TASK-66), Arena-чеки. Задача обобщает их в единый механизм «Automations»: правило = триггер + условие + действие, с UI и журналом (doc-10, раздел «Автоматизации»).

## Модель
- **Триггеры**: `cron` (выражение, локальное время), события шины: `task.assigned`, `task.statusChanged` (напр. → Review), `pr.opened`, `pr.checksFailed`, `docs.changed`, `process.crashed`, `swarm.finished`, `device.connected`; ручной запуск.
- **Условия**: проект, фильтр по labels/assignee/статусу, «нет активного swarm по задаче», cooldown (переиспользовать `assignedTaskRules`).
- **Действия**: запустить роль в worktree по задаче (через `agentFleetService`, одиночный слот или режим «до готовности»), запустить чеки (`arenaChecks`), `reindex_docs`, уведомление (каналы `notificationService`), выполнить action из `.projecthub.json` (Action Runner).
- **Ограничения безопасности** ([[decision-26]] п. 5): автозапуск только с sandbox `workspace-write` и HITL-политикой роли; `danger-full-access`/полный auto-approve недоступен для автоматизаций; дневной лимит бюджета на правило.
- Хранение: `<userData>/automations.json` (глобальные) + `.projecthub.json` (проектные); журнал запусков (`automations-log.jsonl`, ротация).

## Что сделать
1. `electron/services/automationRules.ts` — чистый модуль: схема правила (zod), матчинг события/условий, расчёт следующего cron-срабатывания, unit-тесты.
2. `automationService.ts` — подписка на `eventBus`, планировщик cron, запуск действий, журнал, защита от циклов (правило не реагирует на события, порождённые своим же действием).
3. `assignedTaskRunner` переписывается как встроенное правило Automations (обратная совместимость настройки автозапуска).
4. UI: модал/вкладка «Automations» — список правил, вкл/выкл, «запустить сейчас», журнал с результатом и ссылкой на сессию swarm; i18n; модалки по decision-17.
5. IPC + MCP-инструменты (`automation_list`, `automation_run`) в `mcpServerService` для внешнего управления (Telegram/Remote Control).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Чистый модуль правил (схема, матчинг, cron-расчёт, cooldown, защита от циклов) покрыт unit-тестами
- [ ] #2 Поддержаны триггеры cron и не менее шести событий шины; действия: роль в worktree, чеки, reindex, уведомление, action из .projecthub.json
- [ ] #3 Автозапуск назначенных задач (TASK-66) работает как встроенное правило без регрессии тестов assignedTaskRules
- [ ] #4 Автоматизации запускают агентов только в sandbox workspace-write с HITL-политикой роли и дневным лимитом бюджета; превышение останавливает правило и уведомляет
- [ ] #5 UI списка правил с вкл/выкл, «запустить сейчас» и журналом запусков; i18n ru/en; модалки по decision-17
- [ ] #6 MCP-инструменты automation_list/automation_run во встроенном MCP-сервере
- [ ] #7 ADR о модели автоматизаций и границах автономности (правило 18); lint/test зелёные, pack:win собран
<!-- AC:END -->
