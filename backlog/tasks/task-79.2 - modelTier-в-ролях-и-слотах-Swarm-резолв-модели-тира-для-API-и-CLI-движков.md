---
id: TASK-79.2
title: 'modelTier в ролях и слотах Swarm, резолв модели тира для API и CLI-движков'
status: Done
assignee: []
created_date: '2026-09-19 06:17'
updated_date: '2026-09-19 07:57'
labels:
  - ai
  - roles
  - routing
milestone: m-0
dependencies:
  - TASK-79.1
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
modified_files:
  - electron/services/roleTypes.ts
  - electron/services/roleService.ts
  - electron/services/builtinRoles.ts
  - electron/services/swarmTypes.ts
  - electron/services/agentFleetService.ts
  - tests/unit/roleService.test.ts
  - backlog/decisions/decision-9 - Роль-агента-как-first-class-сущность.md
parent_task_id: TASK-79
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-44 п. 4, 5. Поле `modelTier` в `RoleDefinition` (frontmatter, обратная совместимость с `model`), `AgentSlotConfig`, встроенные роли (architect/reviewer — frontier, implementer/tester — balanced, doc-writer — cheap), `startAssignedAgent`; резолв первой модели цепочки для api, claude-cli, codex-cli (`-m` без проверки), gemini-cli.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Роль и слот хранят modelTier; старые роли с model работают как раньше
- [x] #2 Явная модель важнее тира; без записей тира для движка — прежнее поведение с записью в лог
- [x] #3 Встроенные роли получили тиры; тесты roleService
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-44 п. 4–5.
- `RoleDefinition.modelTier` (frontmatter `modelTier`/`model_tier`, неизвестное значение — ошибка разбора роли; запись только валидного тира), `AgentSlotConfig.modelTier`, `startAssignedAgent` переносит тир роли в слот.
- Встроенные роли: architect/reviewer — frontier, implementer/tester — balanced, doc-writer — cheap; модели вендора в ролях нет.
- Резолв: `agentFleetService.prepareModelRouting` строит цепочку только для слота с тиром; активное звено — `activeLinks`, движки берут модель через `effectiveModel` (claude-cli `--model`, codex `-m` без проверки, gemini `-m`), API — `effectiveProviderConfig` (звено тира → `providerConfigFromSpec`, усилие и температура слота переносятся). Сигнатуры `resolveSlotProviderConfig` и `buildEngineInvocation` не менялись (impact GitNexus: CRITICAL, всё внутри agentFleetService/arenaJudgeService).
- Явная модель слота важнее тира и становится первым звеном; слот без тира — одна попытка, `modelRouting` нет (как раньше). Тир без звеньев для движка — лог «тир … не настроен», `source: default`.
- decision-9 получил строку-ссылку на новые поля роли.
- Тесты: `roleService.test.ts` (парсинг, ошибка, запись/чтение, старая роль с model, встроенные тиры), `modelFallback.test.ts`.
<!-- SECTION:NOTES:END -->
