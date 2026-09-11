---
id: TASK-66
title: >-
  Федерация компьютеров: каталог хостов на релее, hub-режим и назначение задач
  между машинами
status: Done
assignee: []
created_date: '2026-09-10 07:21'
updated_date: '2026-09-11 11:24'
labels:
  - ade-roadmap
  - remote
  - federation
  - multi-agent
  - P1
dependencies:
  - TASK-60
  - TASK-65
references:
  - electron/services/remoteControlService.ts
  - scripts/remote-relay-server.mjs
  - src/components/layout/Sidebar.tsx
  - src/components/remote/RemoteControlBadge.tsx
  - src/types/remote.ts
  - electron/services/backlogWatcher.ts
documentation:
  - >-
    backlog/decisions/decision-11 -
    Федерация-компьютеров-и-Remote-Control-identity-на-ключевой-паре-релей-как-каталог-hub-режим.md
  - backlog/decisions/decision-9 - Роль-агента-как-first-class-сущность.md
modified_files:
  - electron/services/federationProtocol.ts
  - electron/services/federationClientService.ts
  - electron/services/lanDiscoveryMessage.ts
  - electron/services/lanDiscoveryService.ts
  - electron/services/assignedTaskRules.ts
  - electron/services/assignedTaskRunner.ts
  - electron/services/remoteControlService.ts
  - electron/services/backlogWatcher.ts
  - electron/services/hitlTypes.ts
  - electron/ipc/federationIpc.ts
  - electron/ipc/index.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - electron/main.ts
  - scripts/remoteRelayCatalog.mjs
  - scripts/remote-relay-server.mjs
  - scripts/federation-smoke.mjs
  - src/utils/assignee.ts
  - src/types/remote.ts
  - src/types/electron.d.ts
  - src/store/useFederationStore.ts
  - src/components/federation/RemoteHostsModal.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - src/components/remote/RemoteControlBadge.tsx
  - src/App.tsx
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - tests/unit/assignee.test.ts
  - tests/unit/remoteRelayCatalog.test.ts
  - tests/unit/federationProtocol.test.ts
  - tests/unit/assignedTaskRules.test.ts
  - tests/unit/lanDiscoveryMessage.test.ts
  - tests/unit/remoteControlAuth.test.ts
  - >-
    backlog/decisions/decision-19 -
    Каталог-федерации-по-общему-секрету-обнаружение-в-LAN-и-автозапуск-назначенных-задач.md
  - >-
    backlog/decisions/decision-11 -
    Федерация-компьютеров-и-Remote-Control-identity-на-ключевой-паре-релей-как-каталог-hub-режим.md
  - deploy/relay/README.md
  - README.md
  - package.json
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-11, decision-9). Цель проекта: управлять ADE с нескольких компьютеров как одним рабочим пространством.

**Что не так сейчас**
- «Федерация» существует как модель `FederationHost`, три HTTP-эндпоинта и селектор в UI. `POST /api/federation/register` ниоткуда не вызывается, хост не шлёт `host_meta_update` релею, `lastSeen` обновляется только локально. Список хостов всегда содержит только себя.
- ProjectHub не умеет быть клиентом другого ProjectHub: нет исходящих соединений к пирам. Фактически только телефон → один ПК, адрес и ключ каждого ПК вводятся вручную.
- Адрес туннеля Cloudflare меняется при каждом рестарте; стабильных адресов нет.
- Назначить задачу агенту на другой машине нельзя.

**Зависимости**: ремонт контура и identity на ключевой паре (TASK-65), роли и `assignee` (TASK-60).

**Что сделать**
1. Каталог хостов на релее: хост регистрируется подписью ключа, публикует `machineName`, платформу, версию, список проектов (имена и хэши путей), активных агентов, размер очереди HITL, heartbeat; релей хранит каталог по идентификатору пользователя и отдаёт его доверенным устройствам. LAN-обнаружение через mDNS как дополнение.
2. Hub-режим: узел «Удалённые хосты» в сайдбаре; подключение к хосту как устройство с правами своего токена; просмотр проектов, задач (Kanban read/write через RPC), процессов и логов, агентов и арены, очереди HITL удалённого хоста в том же интерфейсе с явной пометкой хоста.
3. Единый RPC для телефона и ПК: старт агента с ролью в задаче, отправка промпта в AI Studio, запуск действий, решения HITL по `requestId`, подписка на события с догоном по `lastEventId`.
4. Назначение между машинами: `assignee: agent:<role>@<hostId>` в задаче; хост, увидев своё назначение (через backlog-вотчер после `git pull` или через RPC), создаёт worktree и запускает агента, публикует статус в федерацию; карточка задачи показывает хост и статус.
5. Синхронизация проектной части через git: hub может инициировать `git pull/push` на удалённом хосте (RPC из задачи ремонта), чтобы задачи и `.rag-index` совпадали.
6. Версия протокола в handshake, понятная ошибка при несовместимости; офлайн хостов отображается как статус, а не ошибка.
7. Тесты: каталог и heartbeat с мок-релеем, права токенов в hub-режиме, разбор `assignee`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Два ProjectHub на разных ПК видят друг друга в каталоге хостов через релей (и в LAN без релея), с актуальным heartbeat и метаданными
- [x] #2 Из одного ProjectHub можно открыть проекты, задачи, процессы, агентов и очередь HITL другого и выполнять действия по правам токена
- [x] #3 Назначение agent:<role>@<hostId> в задаче приводит к запуску агента на нужном хосте, статус виден на карточке с обоих ПК
- [x] #4 Решение HITL, принятое на любом доверенном устройстве или ПК, применяется по requestId и закрывает запрос везде
- [x] #5 Несовместимые версии протокола дают понятную ошибку; офлайн хосты показываются статусом
- [x] #6 Тесты на каталог, heartbeat, права и разбор assignee добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано.

**Каталог хостов на релее (AC #1).** Хосты одного пользователя группируются по `ownerId` —
sha256 общего секрета федерации, задаваемого в настройках Remote Control (хранится в
`safeStorage`, релею уходит только хэш). Каталог отдаётся по уже аутентифицированному подписью
сокету: `catalog_request` → `catalog`, плюс рассылка соседям при подключении/отключении хоста и
после heartbeat (троттлинг 2 с). Хост шлёт `host_meta_update` раз в 30 с (имя, платформа, версия,
счётчики проектов/процессов/агентов/HITL, проекты — имена и ХЭШИ путей); без heartbeat 90 с —
офлайн. Чистые функции вынесены в `scripts/remoteRelayCatalog.mjs`, метаданные фильтруются белым
списком, `hostId`/`ownerId` подменить нельзя. LAN без релея — собственный UDP-multicast анонс
(`lanDiscoveryService`/`lanDiscoveryMessage`, 239.255.42.56:42056, TTL 1) вместо mDNS-библиотеки,
с той же фильтрацией по `ownerId`; адрес берётся из UDP-пакета, а не из его содержимого.

**Hub-режим (AC #2).** `federationClientService` — зеркало `remoteControlService`: исходящие
E2EE-соединения к другим ProjectHub (LAN напрямую или через релей), RPC с таймаутом и
идемпотентным id, приём событий, догон по `lastEventId`, backoff. Чистая часть (адрес сокета,
сверка версий, backoff, обёртка пакетов) — `federationProtocol.ts`. UI: узел «Удалённые хосты» в
сайдбаре → `RemoteHostsModal` (createPortal, `z-[9999]` по правилу 19) с вкладками обзор/задачи/
процессы/агенты/HITL и явной пометкой хоста; стор `useFederationStore` держит удалённые данные
отдельно от локальных, чтобы очереди двух машин не сливались.

**RPC (AC #2/#3).** Добавлены `get_roles`, `get_swarms`, `start_assigned_agent`, `stop_swarm`.
Права — по per-device токену подключившегося ПК: hub не получает ничего сверх обычного
устройства, `start_assigned_agent` запрещён при `readOnly`/`hitl` и в глобальном readOnly, запрос
с чужим `hostId` отклоняется.

**Назначение между машинами (AC #3).** Разбор `assignee` вынесен в чистый `src/utils/assignee.ts`
(попутно исправлен баг: у человека `@veshiy666@gmail.com` хвост после `@` читался как `hostId`).
Назначение на чужой хост маршрутизируется в `swarm:runAssigned` через hub-соединение (маршрутизация
в IPC-слое, `agentFleetService` о федерации не знает). Назначение на свой хост может запускаться
автоматически backlog-вотчером после `git pull` — **выключено по умолчанию**, правила в
`assignedTaskRules.ts`: только явный `@<свой hostId>`, только статусы To Do/In Progress, только
если по задаче нет активного роя, пауза 10 минут. В карточке задачи автодополнение предлагает
`agent:<роль>@<хост>` по подключённым машинам и показывает статус хоста.

**HITL (AC #4).** Очередь удалённого хоста видна во вкладке HITL, решение уходит RPC
`hitl_decision` строго по `requestId` в тот же `hitlService.decide` — первый ответ выигрывает,
откуда бы ни пришёл. События `ai:hitl*` с удалённого хоста обновляют очередь без ручного refresh.

**Версии и офлайн (AC #5).** `relay_ack` и все четыре `handshake_ack` несут `protocolVersion`;
несовпадение даёт понятное сообщение с обоими номерами и не рвёт транспорт для телефона.
Офлайн — статус (`offline`) с автопереподключением, а не ошибка; исчезнувшие из каталога хосты
помечаются офлайн, а не удаляются.

**Проверки (AC #6).** Новые unit-тесты: `assignee` (16), `remoteRelayCatalog` (11),
`federationProtocol` (16), `assignedTaskRules` (8), `lanDiscoveryMessage` (6) + 4 теста прав
hub-RPC в `remoteControlAuth`. Итого `npm test` — 471 тест в 49 файлах, зелёные. Дополнительно
`npm run federation-smoke` поднимает настоящий relay и три хоста на живых сокетах: каталог,
heartbeat, изоляция по владельцу, уход хоста — 10/10. `npm run build` (lint 0 ошибок /
510 предупреждений — ровно базовый уровень, ни одного нового; tsc; vite; check-bundle),
`npm run lint:docs` и `npm run pack:win` зелёные.

**Документация.** ADR [[decision-19]] (owner-scoped каталог, UDP-multicast вместо mDNS, правила
автозапуска, границы прав hub) — `accepted`; [[decision-11]] переведён в `accepted` с разделом
реализации; обновлены `deploy/relay/README.md` и README; `npm run index-docs` пересобран.

**Не сделано / ограничения:**
- Проверка двух РЕАЛЬНЫХ ProjectHub на разных ПК не проводилась — вторая машина недоступна.
  Проверены: каталог релея на живых сокетах (`federation-smoke`), протокол и права — юнитами.
  Перед Done стоит прогнать ручной сценарий на двух машинах: сопряжение по PIN, вкладки hub,
  решение HITL с соседнего ПК, назначение `agent:<role>@<hostId>`.
- Git-синхронизация проектной части (п.5 задачи) — используется существующий RPC `git_pull`/
  `git_push`; отдельной кнопки «синхронизировать хост» в hub-UI нет.
- Терминал и логи процессов удалённого хоста показываются списком без стрима вывода
  (`get_process_logs` доступен по RPC, но отдельной панели логов в модалке нет).
- LAN-обнаружение не проходит через маршрутизаторы и гостевые сети с изоляцией клиентов —
  там работает релей.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: Claude
created: 2026-09-11 11:24
---
Переведено в Done по решению пользователя (2026-09-11). Все шесть критериев закрыты кодом и тестами, но сценарий на двух РЕАЛЬНЫХ машинах так и не прогонялся — второй ПК был недоступен. Проверено замещающими средствами: `npm run federation-smoke` (живой relay + три хоста на настоящих сокетах, 10/10) и unit-тесты протокола, каталога и прав. Когда появится вторая машина, стоит пройти вручную: сопряжение по PIN, вкладки hub-режима, решение HITL с соседнего ПК, назначение `agent:<role>@<hostId>`. Остальные ограничения (нет кнопки git-синхронизации в hub-UI, нет стрима логов удалённых процессов) описаны в Implementation Notes и тянут на отдельные задачи, а не на блокеры.
---
<!-- COMMENTS:END -->
