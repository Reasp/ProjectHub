---
id: TASK-57
title: >-
  Единый HITL-контур для всех агентов: очередь запросов с requestId, политики по
  роли, аудит-лог решений, отказ от skip-permissions в Swarm
status: To Do
assignee: []
created_date: '2026-09-10 07:15'
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
- [ ] #1 Все агенты, запускаемые ProjectHub (AI Studio, Swarm, Handoff, назначенные задачи), проходят через один hitlService; флаг --dangerously-skip-permissions используется только как залогированный fallback при недоступном HITL-сервере
- [ ] #2 Очередь запросов персистится, восстанавливается после перезапуска, истекает по таймауту с решением deny и отменяется при завершении сессии
- [ ] #3 Решение всегда адресуется по requestId; удалённое и локальное решения используют один метод, повторное решение возвращает «уже решено»; одобрение «верхнего в очереди» удалено из App.tsx
- [ ] #4 Политики auto-approve берутся из роли и только сужают глобальные; запись вне корня проекта отклоняется всегда
- [ ] #5 Аудит-лог решений пишется в jsonl с ротацией, доступен в UI с фильтрами и экспортом, не содержит секретов и содержимого файлов
- [ ] #6 Панель «Ожидают решения» показывает запросы всех сессий; события hitl:* и agent:* публикуются в шину и доступны подписчикам
- [ ] #7 Unit-тесты на очередь, адресацию, политики и формат аудита добавлены, npm run build проходит
<!-- AC:END -->
