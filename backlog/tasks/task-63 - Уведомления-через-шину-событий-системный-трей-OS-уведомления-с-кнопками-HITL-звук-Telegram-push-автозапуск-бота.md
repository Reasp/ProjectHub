---
id: TASK-63
title: >-
  Уведомления через шину событий: системный трей, OS-уведомления с кнопками
  HITL, звук, Telegram-push, автозапуск бота
status: Done
assignee: []
created_date: '2026-09-10 07:18'
updated_date: '2026-09-11 09:01'
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
modified_files:
  - electron/services/notificationTypes.ts
  - electron/services/notificationRules.ts
  - electron/services/notificationService.ts
  - electron/services/trayService.ts
  - electron/services/trayIcons.ts
  - electron/services/telegramService.ts
  - electron/services/hitlTypes.ts
  - electron/services/processManager.ts
  - electron/services/agentFleetService.ts
  - electron/services/prService.ts
  - electron/services/remoteControlService.ts
  - electron/ipc/notificationsIpc.ts
  - electron/ipc/index.ts
  - electron/ipc/mcpIpc.ts
  - electron/workers/telegramBot.mjs
  - electron/main.ts
  - electron/preload.ts
  - scripts/telegram-bot.mjs
  - scripts/gen-tray-icons.mjs
  - src/types/electron.d.ts
  - src/store/useNotificationStore.ts
  - src/lib/notificationSound.ts
  - src/components/notifications/NotificationSettingsModal.tsx
  - src/components/notifications/NotificationsBadge.tsx
  - src/components/layout/Header.tsx
  - src/components/processes/ProcessesView.tsx
  - src/App.tsx
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - tests/unit/notificationRules.test.ts
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
- [x] #1 Системный трей показывает состояние приложения, очередь HITL и активные сессии; закрытие окна сворачивает в трей, выход спрашивает подтверждение при активных агентах
- [x] #2 OS-уведомление о запросе HITL содержит кнопки решения (где поддерживается) и открывает окно по клику; завершение и падение агента приходят уведомлением
- [ ] #3 Telegram получает push о HITL с inline-кнопками, решение с кнопки применяется по requestId; push о завершении агента и PR настраиваемы
- [ ] #4 Telegram-бот запускается и останавливается приложением при заданном токене и виден в менеджере процессов
- [x] #5 Настройки доставки по типу события и каналу, тихие часы и дедупликация работают; решение с одного канала закрывает уведомления на других
- [x] #6 Unit-тесты на правила доставки и дедупликацию, npm run build проходит
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: `notificationTypes.ts` + `notificationRules.ts` (чистый модуль: матрица «событие × канал», тихие часы, дедупликация, `describeBusEvent`, тексты Telegram — 27 unit-тестов в `tests/unit/notificationRules.test.ts`) и `notificationService.ts` — единственный подписчик шины, исполняющий доставку; настройки в `<userData>/notifications.json`.

Шина (`appEventBus` из TASK-57) дополнена типами `swarm:finished` (публикует `agentFleetService.finishSession`/`stopSwarm`), `process:crashed` (`processManager.broadcastStatus` при статусе `failed`), `pr:created`/`pr:checksFailed` (`prService`), `remote:deviceConnected` (`remoteControlService`). Прежняя точечная отправка Telegram о падении процесса из `remoteControlService` удалена — теперь всё идёт через матрицу каналов.

Трей: `trayService.ts` + `trayIcons.ts` (PNG 32×32 вшиты base64, генератор `scripts/gen-tray-icons.mjs`). Иконка idle/working/attention, меню с очередью HITL, активными сессиями и быстрыми действиями; закрытие окна сворачивает в трей (`minimizeToTray`), выход — из меню с нативным `dialog.showMessageBox` при активных агентах.

Telegram: `telegramService.ts` шлёт push с inline-кнопками `hitl:<allow|deny>:<requestId>` и снимает клавиатуру, когда запрос решён любым каналом; демон бота переехал в `electron/workers/telegramBot.mjs` (только воркеры попадают в `app.asar`), запускается `processManager` через `process.execPath` + `ELECTRON_RUN_AS_NODE`, секреты передаются окружением. Нажатия кнопок бот применяет через новые авторизованные эндпоинты Remote Control `POST /api/hitl/decide` и `GET /api/hitl/pending` — тем же `hitlService.decide`, что и окно (повтор получает 409). `scripts/telegram-bot.mjs` остался обёрткой для `npm run telegram-bot`.

UI: бейдж в шапке + модалка `NotificationSettingsModal` (createPortal, `z-[9999]`, правило 19) с матрицей, тихими часами, громкостью, окном дедупликации, сворачиванием в трей, управлением ботом и журналом доставок; звук — синтез WebAudio (`src/lib/notificationSound.ts`); клик по уведомлению/пункту трея ведёт в нужную вкладку (`notify:navigate` → `App.tsx`). Служебные процессы (`<userData>/services`) показываются отдельной секцией во вкладке «Процессы». i18n ru/en/types дополнены секцией `notifications`. decision-13 переведён в `accepted` с разделом «Уточнения по факту реализации».

Проверено вживую на собранном `release/win-unpacked/ProjectHub.exe`: трей создаётся (`[Tray] System tray initialised`), меню трея открывается с корректным состоянием, «Выход» даёт штатный graceful shutdown, закрытие окна сворачивает в трей (процесс жив, лог `Window hidden to tray`), модалка настроек открывается и «Проверить» реально показывает системное уведомление Windows и пишет запись в журнал. Запуск воркера бота из `app.asar` проверен отдельно (`ELECTRON_RUN_AS_NODE` + путь внутри asar — скрипт стартует и доходит до вызова Bot API).

Не сделано / известные ограничения:
- AC #3 и #4 не закрыты: на машине реализации нет токена Telegram-бота и нет доступа к `api.telegram.org` (`fetch failed`), поэтому push с inline-кнопками, применение решения по нажатию и старт/останов демона приложением проверены только по коду и по пути запуска воркера. Нужен ручной smoke-test с настоящим ботом.
- Кнопки «Разрешить/Отклонить» внутри системного уведомления доступны только на macOS (`Notification.actions`); на Windows/Linux клик открывает Центр решений. Ограничение показано в UI (`capabilities.osActions`) и зафиксировано в decision-13.
- Рассылка уведомлений в канал `remote` ограничена доверенными устройствами текущего хоста; федеративные хосты — TASK-66.

`npm run build` (lint 0 ошибок / 510 предупреждений — ниже базовой линии 513, test 410/410, tsc, vite, check-bundle), `npm run lint:docs` и `npm run pack:win` зелёные; `.rag-index` пересобран.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude Opus 5
created: 2026-09-11 09:01
---
Закрыто по решению пользователя. AC #3 и #4 (Telegram push с inline-кнопками и управление демоном бота из приложения) остаются непроверенными вживую: на машине реализации нет токена бота и нет доступа к `api.telegram.org`. Код реализован полностью, путь запуска воркера из `app.asar` проверен. Если при первом использовании с настоящим ботом что-то не сойдётся — заводить отдельную задачу-багфикс, а не переоткрывать эту.
---
<!-- COMMENTS:END -->
