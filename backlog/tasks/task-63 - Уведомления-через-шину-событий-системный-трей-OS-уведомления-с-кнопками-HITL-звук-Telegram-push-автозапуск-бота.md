---
id: TASK-63
title: >-
  Уведомления через шину событий: системный трей, OS-уведомления с кнопками
  HITL, звук, Telegram-push, автозапуск бота
status: To Do
assignee: []
created_date: '2026-09-10 07:18'
labels:
  - ade-roadmap
  - notifications
  - hitl
  - telegram
  - P1
dependencies:
  - TASK-57
references:
  - electron/main.ts
  - electron/services/remoteControlService.ts
  - scripts/telegram-bot.mjs
  - electron/services/processManager.ts
  - src/components/remote/RemoteControlBadge.tsx
documentation:
  - >-
    backlog/decisions/decision-13 -
    Уведомления-через-единую-шину-событий-трей-системные-уведомления-звук-и-Telegram.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-13).

**Что не так сейчас**
- Системного трея нет (`Tray` не импортируется), Electron `Notification` и Web Notification API не используются, звука нет.
- Единственный внешний канал: Telegram-сообщение при падении процесса с ненулевым кодом (`remoteControlService.sendTelegramNotification`). Push о запросе HITL, завершении агента, готовом PR отсутствуют.
- Telegram-бот запускается только вручную командой `npm run telegram-bot`, приложение его не поднимает.
- Если окно свёрнуто или пользователь за другим ПК, он не узнаёт, что агент ждёт решения или закончил.

**Зависимость**: шина событий `hitl:*` и `agent:*` из TASK-57.

**Что сделать**
1. `eventBus` в main (если не создан в TASK-57): события `agent:started|finished|failed`, `hitl:requested|decided|expired`, `swarm:finished`, `process:crashed`, `pr:created|checksFailed`, `remote:deviceConnected` с полями `severity`, `projectPath`, `hostId`, текст, действие по клику.
2. Системный трей: иконка состояния (idle, working, needs-attention), меню с активными сессиями, очередью HITL и быстрыми действиями; закрытие окна сворачивает в трей, полный выход через меню с подтверждением при активных агентах.
3. Electron `Notification` с действиями «Разрешить/Отклонить» для HITL там, где ОС поддерживает; клик открывает окно на нужном экране.
4. Звуковой сигнал (настраиваемый, по умолчанию только для `needs-attention`).
5. Telegram: push с inline-кнопками решения для HITL (callback идёт через Remote Control по `requestId`), сообщения о завершении агента и PR; бот-демон запускается и останавливается приложением через `processManager` при заданном токене.
6. Настройки доставки: матрица «тип события × канал», «тихие часы», дедупликация; решение с любого канала закрывает уведомление на остальных.
7. Unit-тесты на правила доставки и дедупликацию.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Системный трей показывает состояние приложения, очередь HITL и активные сессии; закрытие окна сворачивает в трей, выход спрашивает подтверждение при активных агентах
- [ ] #2 OS-уведомление о запросе HITL содержит кнопки решения (где поддерживается) и открывает окно по клику; завершение и падение агента приходят уведомлением
- [ ] #3 Telegram получает push о HITL с inline-кнопками, решение с кнопки применяется по requestId; push о завершении агента и PR настраиваемы
- [ ] #4 Telegram-бот запускается и останавливается приложением при заданном токене и виден в менеджере процессов
- [ ] #5 Настройки доставки по типу события и каналу, тихие часы и дедупликация работают; решение с одного канала закрывает уведомления на других
- [ ] #6 Unit-тесты на правила доставки и дедупликацию, npm run build проходит
<!-- AC:END -->
