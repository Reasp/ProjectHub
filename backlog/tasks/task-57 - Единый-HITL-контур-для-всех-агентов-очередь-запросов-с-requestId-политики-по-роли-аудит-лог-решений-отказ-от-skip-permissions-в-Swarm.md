---
id: TASK-57
title: >-
  Единый HITL-контур для всех агентов: очередь запросов с requestId, политики по
  роли, аудит-лог решений, отказ от skip-permissions в Swarm
status: Review
assignee: []
created_date: '2026-09-10 07:15'
updated_date: '2026-09-10 12:54'
labels:
  - ade-roadmap
  - hitl
  - security
  - swarm
  - P0
dependencies: []
references:
  - electron/services/claudeBridgeService.ts
  - electron/services/agentFleetService.ts
  - electron/services/aiAgentService.ts
  - electron/services/mcpServerService.ts
  - src/App.tsx
  - src/components/ai/AISettingsModal.tsx
documentation:
  - >-
    backlog/decisions/decision-10 -
    Единый-HITL-контур-для-всех-агентов-и-аудит-лог-решений.md
  - >-
    backlog/decisions/decision-5 -
    Модель-безопасности-десктопа-изоляция-рендерера-реестр-проектов-локальный-MCP-и-секреты.md
  - backlog/docs/doc-8 - Human-in-the-loop-для-режима-Claude-CLI-в-AI-Studio.md
modified_files:
  - electron/services/hitlService.ts
  - electron/services/hitlPolicy.ts
  - electron/services/hitlAudit.ts
  - electron/services/hitlTypes.ts
  - electron/services/eventBus.ts
  - electron/ipc/hitlIpc.ts
  - electron/ipc/index.ts
  - electron/main.ts
  - electron/preload.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/agentFleetService.ts
  - electron/services/swarmTypes.ts
  - electron/services/aiAgentService.ts
  - electron/services/mcpServerService.ts
  - electron/services/remoteControlService.ts
  - src/App.tsx
  - src/store/useHitlStore.ts
  - src/store/useAIStudioStore.ts
  - src/components/hitl/HitlCenterModal.tsx
  - src/components/hitl/HitlBadge.tsx
  - src/components/layout/Header.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/ai/AISettingsModal.tsx
  - src/types/electron.d.ts
  - src/types/remote.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/hitlService.test.ts
  - tests/unit/hitlPolicy.test.ts
  - tests/unit/hitlAudit.test.ts
  - backlog/docs/doc-8 - Human-in-the-loop-для-режима-Claude-CLI-в-AI-Studio.md
  - >-
    backlog/decisions/decision-10 -
    Единый-HITL-контур-для-всех-агентов-и-аудит-лог-решений.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-10, decision-5).

**Что не так сейчас**
- HITL работает только для AI Studio с Claude CLI (`claudeBridgeService.handleCliPermissionRequest` через `--permission-prompt-tool` и встроенный MCP-сервер).
- Swarm-агенты стартуют с `--dangerously-skip-permissions` (`agentFleetService.ts`, строка с формированием args) и полностью вне контура; API-движок `aiAgentService` проверяет инструменты своим кодом, отдельным от политик Claude CLI.
- Решения об одобрении нигде не логируются (нет ни файла, ни события аудита).
- Очередь ожидающих запросов живёт в памяти и адресуется «верхним» элементом: `App.tsx` при удалённом решении одобряет `top.id` без сверки `requestId`, что позволяет одобрить не тот запрос.
- Remote Control не получает события о запросах (см. TASK-65), Telegram не получает push о HITL.

**Что сделать**
1. `hitlService` в main: очередь запросов с полями `requestId`, `sessionId`, `agentId`, `role`, `hostId`, `tool`, `payload` (команда, путь, дифф), `createdAt`, `expiresAt`; персистентность очереди в `<userData>/hitl/pending.json`; отмена при завершении сессии; таймаут с решением по умолчанию `deny`.
2. Единый вход для всех движков: Swarm и назначенные задачи запускают Claude CLI с тем же `--permission-prompt-tool`; для Codex/Gemini CLI использовать их механизм подтверждений или прокси-обёртку инструментов; API-движок вызывает `hitlService` из своего tool-loop. Флаг `--dangerously-skip-permissions` остаётся только как явный fallback при недоступном HITL-сервере и включённом auto-approve, с записью в аудит и предупреждением в UI.
3. Политики привязаны к роли (decision-9): allow/deny инструментов, путей, команд, таймаут команды; глобальные настройки пользователя как значения по умолчанию, роль может только сужать; запись вне корня проекта запрещена всегда.
4. Все решения адресуются по `requestId`; удалённые и локальные ответы идут через один метод `decide(requestId, decision, source)`; первый ответ выигрывает, остальные получают «уже решено».
5. Аудит-лог `<userData>/audit/hitl-<yyyy-mm>.jsonl`: кто решил (локально, устройство `deviceId`, авто-правило), что одобрено (инструмент, путь, хэш команды), результат выполнения; ротация по месяцам; экран «История решений» в настройках с фильтрами и экспортом. Секреты и содержимое файлов в лог не попадают.
6. События шины `hitl:requested|decided|expired` и `agent:started|finished|failed` для рендерера, Remote Control и уведомлений (TASK-63).
7. Единая панель «Ожидают решения» в UI со всеми запросами всех сессий и хостов, бейдж в сайдбаре и заголовке.
8. Unit-тесты: очередь и таймауты, адресация по `requestId`, политики роли, формат аудита.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все агенты, запускаемые ProjectHub (AI Studio, Swarm, Handoff, назначенные задачи), проходят через один hitlService; флаг --dangerously-skip-permissions используется только как залогированный fallback при недоступном HITL-сервере
- [x] #2 Очередь запросов персистится, восстанавливается после перезапуска, истекает по таймауту с решением deny и отменяется при завершении сессии
- [x] #3 Решение всегда адресуется по requestId; удалённое и локальное решения используют один метод, повторное решение возвращает «уже решено»; одобрение «верхнего в очереди» удалено из App.tsx
- [x] #4 Политики auto-approve берутся из роли и только сужают глобальные; запись вне корня проекта отклоняется всегда
- [x] #5 Аудит-лог решений пишется в jsonl с ротацией, доступен в UI с фильтрами и экспортом, не содержит секретов и содержимого файлов
- [x] #6 Панель «Ожидают решения» показывает запросы всех сессий; события hitl:* и agent:* публикуются в шину и доступны подписчикам
- [x] #7 Unit-тесты на очередь, адресацию, политики и формат аудита добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. hitlService (очередь по requestId, pending.json, таймаут deny, отмена по сессии, аудит jsonl, шина событий) + чистые модули hitlPolicy/hitlAudit/hitlTypes/eventBus.
2. claudeBridgeService: requestApproval/sendApprovalResponse → hitlService; вердикт политики через evaluateToolRequest; prepareCliPermissions публичный с meta агента; события agent:*; результаты инструментов CLI в аудит по tool_use_id.
3. agentFleetService: Swarm/Handoff через тот же --permission-prompt-tool, права роли из AgentSlotConfig.permissions, fallback --dangerously-skip-permissions только с записью в аудит и при auto-approve.
4. Источники решений: MCP-инструмент approve_action (requestId обязателен, + list_pending_approvals), Remote Control hitl_decision по requestId + рассылка ai:hitl/ai:hitlDecided/agent:*.
5. IPC hitl:* и bus:event, preload, типы рендерера.
6. UI: useHitlStore, Центр решений (очередь всех сессий + история с фильтрами/экспортом), бейдж в шапке и сайдбаре, таймаут в настройках AI Studio, предупреждение о fallback; удаление одобрения «верхнего» из App.tsx.
7. Unit-тесты hitlService/hitlPolicy/hitlAudit; doc-8 и decision-10 (accepted); index-docs; build + pack:win.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Реализовано (2026-09-10)**

Новые модули main: `electron/services/hitlTypes.ts`, `hitlPolicy.ts` (чистые `applyRolePermissions`, `evaluateToolRequest`, `isPathExcluded`, `isCommandDenied`, `isToolAllowed`), `hitlAudit.ts` (jsonl по месяцам, `redactSecrets`, `hashCommand`, экспорт csv/json/jsonl), `hitlService.ts` (очередь, `decide(requestId, response, source)`, `cancelSession`, `shutdown`, `init` с восстановлением `pending.json` как `orphaned`, `recordAutoDecision`/`recordOutcome`/`recordFallback`), `eventBus.ts` (`appEventBus`), `electron/ipc/hitlIpc.ts`.

Изменения: `claudeBridgeService` (очередь делегирована в hitlService; `ApprovalRequest = HitlRequest` с полями origin/engine/agentId/role/hostId/tool/expiresAt/orphaned; `prepareCliPermissions` публичный с `meta`; авто-решения в аудит; `noteCliUserEvent` — результаты tool_result в аудит; события `agent:*`), `agentFleetService` (`prepareAgentHitl`, `runClaudeCliAgent` без skip-permissions, отмена очереди при завершении агента, события `agent:*`), `swarmTypes.AgentSlotConfig.permissions`, `aiAgentService.AutoApproveRules.approvalTimeoutMin/allowedTools`, `mcpServerService` (`projecthub_approve_action` с обязательным requestId, `projecthub_list_pending_approvals`), `remoteControlService` (`hitl_decision` по requestId, `get_pending_approvals`, подписка на шину → `ai:hitl`/`ai:hitlDecided`/`agent:*`, встроенный веб-клиент с очередью по requestId), `main.ts` (init/shutdown hitlService), preload/electron.d.ts, `src/store/useHitlStore.ts`, `src/components/hitl/HitlCenterModal.tsx`, `HitlBadge.tsx`, Header/Sidebar/App/AISettingsModal, i18n (`hitl`), doc-8, decision-10 (status accepted + раздел «Реализация»).

**Ограничения и что осталось другим задачам**
- API-движок в Swarm (`runApiAgent`) не выполняет инструменты (только логирует `toolCall`), поэтому через контур не проходит — адаптер движков в TASK-60.
- Codex CLI/Gemini CLI: обёртка подтверждений в TASK-60 (вызов Codex сейчас сломан, см. TASK-60).
- Telegram Mini App по-прежнему не отвечает на HITL (E2EE-формат и обработчики кнопок) — TASK-65; RPC `hitl_decision` уже принимает `requestId`.
- Права роли задаются полем `AgentSlotConfig.permissions` (UI выбора ролей в NewSwarmModal — TASK-60).
- Таймаут по умолчанию 24 ч (как MCP_TOOL_TIMEOUT), настраивается в AI Studio → Auto-approve.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Единый HITL-контур реализован: очередь `hitlService` с адресацией по `requestId`, персистентность `<userData>/hitl/pending.json` (восстановление как `orphaned`), таймаут deny (24 ч по умолчанию, настраивается), отмена по сессии, аудит `<userData>/audit/hitl-<yyyy-mm>.jsonl` без секретов (SHA-256 команды + превью с редактированием), шина `appEventBus` (`hitl:*`, `agent:*`) с трансляцией в рендерер и Remote Control. AI Studio (CLI и API), Swarm и Handoff проходят через один `prepareCliPermissions`/`hitlService`; `--dangerously-skip-permissions` только как fallback с записью `fallback` в аудит и предупреждением в UI. Политика роли (`applyRolePermissions`) только сужает глобальные настройки; запись вне корня проекта — deny всегда. Решения из окна, Remote Control (`hitl_decision` с `requestId`) и MCP (`projecthub_approve_action`) идут через один `decide()`, повторное — `already_decided`; одобрение «верхнего в очереди» удалено из App.tsx. UI: «Центр решений» (очередь всех сессий + история с фильтрами и экспортом CSV/JSONL/JSON), бейджи в шапке и сайдбаре, таймаут в настройках AI Studio. Тесты: 30 файлов / 258 тестов зелёные, `npm run build` и `pack:win` проходят. Ограничения (API-движок Swarm без инструментов, Codex/Gemini, Telegram Mini App) описаны в Implementation Notes и отнесены к TASK-60/TASK-65.
<!-- SECTION:FINAL_SUMMARY:END -->
