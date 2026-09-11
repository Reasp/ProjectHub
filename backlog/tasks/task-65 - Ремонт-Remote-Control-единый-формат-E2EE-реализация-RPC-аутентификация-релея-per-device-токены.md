---
id: TASK-65
title: >-
  Ремонт Remote Control: единый формат E2EE, реализация RPC, аутентификация
  релея, per-device токены
status: Review
assignee:
  - 'agent:implementer'
created_date: '2026-09-10 07:20'
updated_date: '2026-09-11 07:03'
labels:
  - ade-roadmap
  - remote
  - security
  - telegram
  - P0
dependencies:
  - TASK-57
references:
  - electron/services/remoteControlService.ts
  - src/telegram-mini-app/index.html
  - src/utils/remoteCryptoNode.ts
  - src/utils/remoteCryptoWeb.ts
  - scripts/remote-relay-server.mjs
  - scripts/telegram-bot.mjs
  - src/components/remote/RemoteControlBadge.tsx
  - src/types/remote.ts
  - README.md
documentation:
  - >-
    backlog/decisions/decision-11 -
    Федерация-компьютеров-и-Remote-Control-identity-на-ключевой-паре-релей-как-каталог-hub-режим.md
  - >-
    backlog/decisions/decision-5 -
    Модель-безопасности-десктопа-изоляция-рендерера-реестр-проектов-локальный-MCP-и-секреты.md
modified_files:
  - README.md
  - >-
    backlog/decisions/decision-11 -
    Федерация-компьютеров-и-Remote-Control-identity-на-ключевой-паре-релей-как-каталог-hub-режим.md
  - >-
    backlog/decisions/decision-5 -
    Модель-безопасности-десктопа-изоляция-рендерера-реестр-проектов-локальный-MCP-и-секреты.md
  - backlog/docs/doc-9 - Контекст-проекта-и-состояние-системы-Context-Dump.md
  - deploy/relay/Dockerfile
  - deploy/relay/README.md
  - deploy/relay/package.json
  - electron/ipc/backlogIpc.ts
  - electron/ipc/mcpIpc.ts
  - electron/preload.ts
  - electron/services/backlogTaskCreate.ts
  - electron/services/remoteControlService.ts
  - public/remote-crypto.js
  - public/telegram-mini-app/index.html
  - scripts/remote-relay-server.mjs
  - scripts/remoteRelayAuth.mjs
  - scripts/telegram-bot.mjs
  - src/components/remote/RemoteControlBadge.tsx
  - src/i18n/en.ts
  - src/i18n/ru.ts
  - src/i18n/types.ts
  - src/types/electron.d.ts
  - src/types/remote.ts
  - tests/unit/remoteControlAuth.test.ts
  - tests/unit/remoteRelayAuth.test.ts
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-11, decision-5). Задачи TASK-51 и TASK-52 закрыты как Done, но контур не работает end-to-end.

**Что не так сейчас**
- Telegram Mini App шифрует пакеты как `{type:'encrypted', iv, payload}` в base64, хост принимает только `{e2ee:true, iv, tag, data}` в hex (`remoteCryptoNode.ts`). С заданным ключом ни один RPC не отвечает. Готовый `remoteCryptoWeb.ts` в Mini App не используется.
- WebRTC P2P отсутствует: `RTCPeerConnection` в коде нет, режим `webrtc` лишь ретранслирует событие `signal`. README и AC TASK-51 неверны.
- RPC `create_task`, `git_pull`, `git_push`, `send_ai_prompt`, `run_action` объявлены в `src/types/remote.ts` и в `writeMethods`, но отсутствуют в `dispatchRpc`.
- HITL удалённо не работает: событие `ai:hitl` не эмитится нигде, `hitl_decision` лишь шлёт `remote:hitlDecisionMade` в рендерер, подписчика нет; кнопки в Mini App без обработчиков. AI Studio в Mini App мёртвый UI (`ai-send-btn` без обработчика, `ai:chunk` никто не шлёт). Живые логи: хост шлёт `process:logChunk`, Mini App слушает `process:log`.
- UI-бейдж читает и шлёт `relayUrl/useRelay/useP2P`, а `updateConfig` знает только `mode/relayServerUrl`: режим и адрес релея из UI не применяются, в QR попадает `relay=undefined`. Deep-link `startapp=k_<hex>` парсится без снятия префикса.
- Безопасность: PIN из 6 цифр без rate-limit и с неконстантным сравнением; ключ и PIN в открытом `remote-control.json`; один общий секрет на все устройства; через релей `client_connected` принимается без аутентификации; релей позволяет занять чужой `hostId`; `/api/status`, `/api/federation/info`, `/api/federation/register` доступны без токена через публичный туннель с CORS `*`; `start_process` выполняет произвольную команду при выключенном по умолчанию `readOnly`.
- Mini App не переподключается; офлайн-очереди и повторов нет.

**Зависимость**: очередь HITL с `requestId` из TASK-57.

**Что сделать**
1. Единый E2EE-протокол на всех клиентах через общий `remoteCryptoWeb.ts`; хост отклоняет незашифрованные пакеты через релей. Тесты протокола (шифрование в браузере, расшифровка в Node и обратно).
2. Реализовать все объявленные RPC в `dispatchRpc`; удалить или реализовать AI Studio в Mini App (минимум: отправка промпта, стрим ответа, список сессий); исправить имена событий логов.
3. Подключить HITL: подписка на `hitl:requested|decided` (TASK-57), рассылка доверенным устройствам, `hitl_decision` вызывает `hitlService.decide(requestId, ...)`; кнопки в Mini App и встроенном клиенте.
4. Аутентификация: identity хоста и устройств на ключевой паре (Ed25519), сопряжение по QR/PIN один раз, per-device токены с правами (`readOnly`, `hitl`, `full`) и отзывом; PIN с rate-limit и блокировкой, константное сравнение; секреты через `safeStorage`.
5. Релей: регистрация хоста подписью ключа, невозможность захвата `hostId`, `host_meta_update` от хоста, Dockerfile и документация self-hosted деплоя с TLS; клиент через релей проходит ту же аутентификацию, что и в LAN.
6. Закрыть эндпоинты `/api/*` токеном, убрать раскрытие путей проектов и имени машины без авторизации, ограничить CORS.
7. Согласовать контракт UI ↔ сервис (`mode`, `relayServerUrl`), исправить QR и парсер deep-link.
8. Переподключение с экспоненциальной задержкой во всех клиентах, идемпотентные `requestId` для RPC, догон событий по `lastEventId`.
9. Убрать WebRTC из README, doc-9 и описаний; зафиксировано в decision-11.
10. Unit-тесты на `remoteControlService`: аутентификация, формат пакетов, права токенов, rate-limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mini App и встроенный клиент обмениваются с хостом зашифрованными пакетами одного формата; тест «браузер шифрует, Node расшифровывает и наоборот» проходит
- [x] #2 Все методы RemoteRpcMethod реализованы в dispatchRpc; логи процессов и AI Studio в Mini App работают или удалены из UI
- [x] #3 Запрос HITL появляется на телефоне и в Mini App, решение применяется по requestId и закрывает запрос на десктопе
- [x] #4 Устройства имеют собственные токены с правами и отзывом, PIN защищён rate-limit и константным сравнением, секреты хранятся через safeStorage
- [x] #5 Релей не позволяет занять чужой hostId, требует подпись хоста и аутентификацию клиента; есть Dockerfile и инструкция self-hosted деплоя
- [x] #6 Эндпоинты /api/* недоступны без токена, пути проектов и имя машины не раскрываются анонимно
- [x] #7 Выбор режима и адрес релея из UI применяются, QR и deep-link содержат корректные данные
- [x] #8 README и документация не упоминают WebRTC как реализованный режим
- [x] #9 Unit-тесты на аутентификацию, формат пакетов, права и rate-limit добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План реализации (2026-09-11)

Архитектура уже зафиксирована в decision-11 (Ed25519-identity, LAN+Relay без WebRTC, единый
формат E2EE, per-device токены) и decision-5 (инварианты безопасности сетевых интерфейсов).
Ниже — план внедрения по фазам, с конкретными файлами.

### Ресёрч (сделан)
- `remoteControlService.ts`: `subscribeToEventBus` уже транслирует `hitl:requested/decided` как
  `ai:hitl`/`ai:hitlDecided` (сделано в TASK-57), `hitl_decision` уже вызывает `hitlService.decide`.
  Значит из п.3 задачи (HITL) серверная часть готова — не хватает только UI-обвязки в Mini App.
- Формат E2EE рассинхронизирован: Node/Web (`remoteCryptoNode.ts`/`remoteCryptoWeb.ts`) дают канон
  `{e2ee:true, iv/tag/data в hex}` (подтверждено тестами `remoteCrypto.test.ts`), но
  `telegram-mini-app/index.html` использует свою реализацию `{type:'encrypted', iv, payload}` в
  base64 — несовместимо. Mini App не имеет сборки (чистый HTML+inline `<script>`), поэтому
  переиспользовать TS-модуль напрямую нельзя.
- Событие логов: сервер и embedded-клиент шлют `process:logChunk`, Mini App слушает `process:log`
  — рассинхрон, чинить на стороне Mini App (канон — `process:logChunk`, так его ждут тесты и
  embedded-клиент).
- `dispatchRpc` не реализует `create_task`, `git_pull`, `git_push`, `send_ai_prompt`, `run_action`
  (объявлены в `writeMethods`/`RemoteRpcMethod`, но `default: throw Unknown RPC method`).
- `RemoteControlBadge.tsx` пишет/читает `relayUrl/useRelay/useP2P`, а канон в
  `RemoteControlConfig`/`updateConfig` — `mode`/`relayServerUrl`; из-за этого выбор режима и адрес
  релея из UI не применяются, QR получает `relay=undefined`.
- Deep-link Mini App (`parseInitialParams`) не понимает префикс `k_<hex>`, который шлёт QR из
  `RemoteControlBadge.tsx` (`startapp=k_<hex>`, чистый hex без base64) — не распознаётся.
- `scripts/remote-relay-server.mjs`: регистрация `role=host&hostId=...` без всякой аутентификации
  — любой клиент может перехватить чужой `hostId`; CORS `*`; `/api/federation/hosts` отдаёт список
  без токена.
- `scripts/telegram-bot.mjs`: отдельный конфиг (`.projecthub-telegram.json` в plaintext, cwd) не
  синхронизирован с `remoteControlService` (secrets в `safeStorage`) — нарушение decision-5 п.4.
- Ed25519: в зависимостях нет `tweetnacl`/`noble`; использовать нативный `node:crypto`
  (`generateKeyPairSync('ed25519', ...)`, `sign`/`verify`) на стороне Electron/Node без новой
  npm-зависимости. Для браузера (Mini App/embedded-клиент) — Web Crypto `SubtleCrypto` с Ed25519
  (поддержка есть в современных WebView/браузерах); если понадобится fallback для старых WebView —
  решить отдельно при реализации.
- Существующие тесты (`remoteControlAuth.test.ts`, `remoteCrypto.test.ts`) задают паттерн: мокать
  `electron` (`app.getPath`, `safeStorage`, `BrowserWindow`), импортировать сервис динамически,
  приводить к internal-интерфейсу для доступа к приватным методам.

### Фаза 1 — Корректность (сделать контур рабочим end-to-end): AC #1, #2, #3, #7, #8
1. Новый канонический браузерный модуль шифрования, отдаваемый как статический JS без сборки:
   `GET /remote-crypto.js` в `handleHttpRequest` (текст, эквивалентный `remoteCryptoWeb.ts`, но
   без TS-типов). `remoteCryptoWeb.ts` остаётся типизированным источником для React-кода.
2. Mini App (`telegram-mini-app/index.html`): убрать свои `deriveCryptoKey/encryptData/decryptData`,
   подключить `<script src="/remote-crypto.js">`, использовать `encryptPayloadWeb`/`decryptPayloadWeb`.
3. Mini App: `process:log` → `process:logChunk`.
4. Mini App: парсер deep-link — распознавать префикс `k_` (снимать его, остальное — hex-ключ).
5. Mini App: обработчики `hitl-allow`/`hitl-deny` (вызывают RPC `hitl_decision`), показ `hitl-container`
   по входящему `ai:hitl`; `ai-send-btn` → RPC `send_ai_prompt`, обработка `ai:chunk` в терминал/чат.
6. `RemoteControlBadge.tsx`: перевести на канон `mode`/`relayServerUrl`; убрать `useP2P`
   (webrtc уходит из scope, см. фазу 5); поправить QR (`relay=<relayServerUrl>`) и Telegram deep-link.
7. `dispatchRpc`: реализовать `create_task` (запись файла задачи backlog по аналогии с
   `updateTaskStatusInFile`/существующим сервисом создания задач), `git_pull`/`git_push` (через
   `gitService`, добавить методы если их там нет), `send_ai_prompt` (обёртка над
   `claudeBridgeService.runAgentTask`, чанки — `broadcastEvent('ai:chunk', ...)`, по аналогии с
   `ai:streamChat` в `aiIpc.ts`), `run_action` (через `actionConfigService` + `processManager`).

### Фаза 2 — Identity и токены: AC #4, #6
1. Ed25519-keypair хоста (`node:crypto`), приватный ключ — через существующий secrets-сервис
   (найти, как остальной код уже хранит секреты в `safeStorage`, переиспользовать, не изобретать
   новый файл формата) вместо plaintext `remote-control.json`.
2. Per-device токены: при первом сопряжении по PIN/ключу выдаётся token с правами
   (`readOnly|hitl|full`), хранится на хосте (пара deviceId↔token↔права), последующие переподключения
   — по токену, не по PIN. `disconnectDevice`/новый `revokeDeviceToken` для точечного отзыва
   (не только глобальный `regenerateToken`).
3. PIN: rate-limit + блокировка по IP/deviceId, `crypto.timingSafeEqual` вместо `===`.
4. `/api/federation/info`, `/api/federation/hosts`, `/api/federation/register` — требуют токен;
   CORS сузить (без `*`).
5. `scripts/telegram-bot.mjs`: свести конфиг к тому же источнику, что и `remoteControlService`
   (не plaintext `.projecthub-telegram.json`).

### Фаза 3 — Релей: AC #5
1. Регистрация хоста подписью (challenge-response на Ed25519), запрет перехвата `hostId`.
2. Аутентификация клиента через релей — тем же токеном, что и в LAN.
3. Dockerfile + README для self-hosted деплоя с TLS за reverse-proxy.

### Фаза 4 — Переподключение и идемпотентность: часть AC #7/#8
1. Экспоненциальный backoff на всех клиентах (Mini App, embedded-клиент, host→relay уже есть
   таймер 5с — заменить на backoff).
2. Идемпотентность RPC по `requestId` (короткий кэш последних ответов на хосте).
3. Догон событий по `lastEventId` (кольцевой буфer последних событий с monotonic id).

### Фаза 5 — Документация: AC #8
1. Убрать WebRTC как «реализованный режим» из README и упоминаний в докax; `RemoteConnectionMode`
   убрать `'webrtc'` (проверить все использования перед удалением типа).
2. decision-11: `proposed` → `accepted` по завершении.

### Фаза 6 — Тесты: AC #9
Ed25519 identity/подпись, выдача/права/отзыв токена, PIN rate-limit + constant-time, relay
hostId-hijack (тестируемый модуль вместо интеграционного WS), формат пакетов (уже есть), финально
`npm run build`.

### Порядок сдачи
Фазы 1→2→3→4→5→6 последовательно, с чекпоинтом у пользователя после фазы 1 (контур реально
работает) перед тяжёлой security-частью (фазы 2-3), учитывая объём и критичность security-решений.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация по фазам из плана — сделано:

**Фаза 1 (корректность).** `public/remote-crypto.js` — канонический браузерный E2EE-модуль
(`{e2ee:true, iv, tag, data}` hex, AES-256-GCM), отдаётся хостом на `GET /remote-crypto.js`;
Mini App (`public/telegram-mini-app/index.html`, перенесена из `src/` — иначе она НИКОГДА не
попадала в packaged-сборку, т.к. `electron-builder.files` берёт только `dist/**`, а `src/`
туда не входит: реальный баг, из-за которого в продакшене всегда отдавался fallback-клиент)
и встроенный веб-клиент теперь используют этот модуль вместо своей рассинхронизированной
реализации/полного отсутствия шифрования. `process:log` → `process:logChunk`. Deep-link
`k_<hex>` парсится. HITL-кнопки и AI Studio в Mini App подключены к `hitl_decision`/`ai:hitl`/
`send_ai_prompt`/`ai:chunk`. `dispatchRpc`: добавлены `create_task` (общая с IPC логика вынесена
в `backlogTaskCreate.ts`), `git_pull`/`git_push` (уже были в `gitService`), `send_ai_prompt`
(обёртка над `claudeBridgeService.runAgentTask`), `run_action`. `RemoteControlBadge.tsx` переведён
на канон `mode`/`relayServerUrl` — до этого читал/писал несуществующие поля (`relayUrl`,
`useRelay`, `useP2P`), т.к. `src/types/electron.d.ts` держал собственный, разошедшийся с рантаймом
набор типов `RemoteControlStatus`/`RemoteDevice`/`RemoteConfig`; теперь `electron.d.ts`
реэкспортирует типы из `src/types/remote.ts` — одного источника истины. Заодно найден и исправлен
баг `regenerateRemoteToken` (возвращал `RemoteControlStatus`, а тип и Badge ожидали `string`).

**Фаза 2 (identity/токены).** Ed25519 identity хоста на `node:crypto` (без новой npm-зависимости),
приватный ключ — только `secretStorageService`/`safeStorage`; туда же перенесены `secretKey`,
`pairingPin`, `telegramBotToken` (раньше — plaintext `remote-control.json`, с разовой миграцией
легаси-значений). Per-device токены с правами `readOnly|hitl|full` (по умолчанию — как текущий
глобальный `readOnly`, т.к. отдельной пер-девайсной UI ещё нет) и отзывом
(`disconnectDevice`/`regenerateToken` теперь чистят токены). PIN: rate-limit (5 попыток / 5 мин
блокировка) и `crypto.timingSafeEqual`. `/api/federation/*` требуют Bearer-токен (мастер-ключ или
любой per-device токен); `/api/status` урезан (без machineName/localIps/tunnelUrl);
`/api/qr` — удалён (отдавал мастер-секрет вообще без проверки, ничем не использовался). CORS `*`
снят везде. `scripts/telegram-bot.mjs` получил `hostToken`/`PROJECTHUB_HOST_TOKEN` для тех же
эндпоинтов (сам скрипт вне Electron — безопасно хранить секрет через safeStorage не может,
это осознанное ограничение отдельного процесса).

**Фаза 3 (релей).** `scripts/remote-relay-server.mjs`: регистрация хоста — challenge-response на
Ed25519 (хост подписывает nonce), trust-on-first-use по `hostId`+pubkey, повторная регистрация
другим ключом отклоняется (`4001`) — до этого `hostId` мог занять кто угодно. Чистая логика
вынесена в `scripts/remoteRelayAuth.mjs` для юнит-тестов без реального WS. Клиент, пришедший через
relay, больше не получает доступ автоматически (`isApproved:false` до explicit `handshake`-пакета
с PIN/ключом/токеном — обрабатывается в `handleIncomingClientMessage`, симметрично LAN). Dockerfile
+ инструкция self-hosted деплоя с TLS за reverse-proxy — `deploy/relay/`.

**Фаза 4 (переподключение).** Экспоненциальный backoff (Mini App, встроенный клиент,
host→relay). RPC-идемпотентность по `requestId` (кэш 60с). `get_events_since` — RPC для догона
событий по кольцевому буферу (200 последних) — готов на хосте, но ещё не вызывается клиентами при
переподключении (см. остаток ниже).

**Фаза 5 (документация).** WebRTC убран из README, doc-9, decision-11 note, типа
`RemoteConnectionMode` (теперь `'lan' | 'relay'`), мёртвого i18n-ключа `webrtcP2P`. decision-11
получил implementation note; статус решения остаётся `proposed` — пункты 4-5 (hub-режим) это
TASK-66, не эта задача.

**Фаза 6 (тесты).** `tests/unit/remoteControlAuth.test.ts` — Ed25519 identity/подпись, выдача/
права/отзыв токена, PIN rate-limit, handshake через relay-пакет (28 тестов). Новый
`tests/unit/remoteRelayAuth.test.ts` — decodePubkey/verifySignature/isHijackAttempt (9 тестов).
`npm run build` (lint+test+tsc+vite+check-bundle) проходит чисто, `npm run pack:win` выполнен.

**Осознанные остатки (не входили в фактически достижимый объём этой правки, не блокируют AC):**
1. AC#5 частично: relay проверяет подпись хоста и требует handshake от клиента (механизм готов),
   но `public/telegram-mini-app/index.html` и встроенный клиент пока не говорят на протоколе
   relay (`?role=client&hostId=...`) — они всегда подключались напрямую к серверу, который их
   раздал. Реальное "подключение клиента через relay к хосту без LAN" — предмет hub-режима
   TASK-66; проверено, что дыра в аутентификации закрыта уже сейчас.
2. `get_events_since` не вызывается клиентами при reconnect (сервер готов, обвязка в двух
   HTML-клиентах — нет).
3. Права per-device токена не настраиваются отдельно от глобального `readOnly` через UI.
4. Каталог `/api/federation/hosts` НА САМОМ relay (не на хосте) остаётся без токена — там же, где
   TASK-66 будет строить каталог хостов, есть смысл добавить аутентификацию заодно.

## Вторая итерация (2026-09-11): закрыты осознанные остатки, AC#5 полностью

**1. Клиенты умеют подключаться к хосту ЧЕРЕЗ relay (закрывает AC#5).**
Оба статических клиента (`public/telegram-mini-app/index.html`, встроенный веб-клиент в
`getEmbeddedWebClientHtml`) получили общий паттерн `buildWsUrl`: в relay-режиме сокет открывается
к самому relay (`?role=client&hostId=...&clientId=...`), а PIN/ключ/токен предъявляются хосту
отдельным зашифрованным пакетом `handshake` после `relay_ack`; в LAN — как раньше, через query.
Встроенный клиент знает `hostId`/`relayServerUrl`/`mode` самого хоста (инжектится в HTML как
`HOST_DEFAULTS`), Mini App получает их из deep-link/QR (`#hostId=...&relay=...&mode=...`,
`startapp=host_<hostId>`) или из новых полей настроек (адрес relay + Host ID + чекбокс режима).

Попутно исправлено: `handshake_ack` теперь шифруется, если запрос был зашифрован — через relay
per-device токен уезжал бы открытым текстом через чужой сервер; в QR/deep-link `hostId` уезжал в
параметре `host`, из-за чего Mini App подставляла `ph_host_...` как сетевой адрес и не могла
подключиться; сохранённая сессия Mini App читалась только при пустом ключе, поэтому deviceId и
токен терялись, если ключ приезжал из deep-link; в `sendRpc` встроенного клиента не было
таймаута — ответ не-`rpc_res` (например, ошибка «устройство не одобрено») вешал загрузку UI.
Оба клиента теперь запоминают `deviceId`/`deviceToken` и переподключаются по токену, а не по PIN.

**2. Догон событий работает end-to-end.** Live-события несут монотонный `eventId`, а
`handshake_ack` — текущий `lastEventId`. Клиент запоминает последний увиденный id (на первом
подключении просто берёт точку из ack, не проигрывая историю) и после переподключения вызывает
`get_events_since`, проигрывая пропущенное тем же обработчиком, что и live-события.

**3. Права per-device токена настраиваются из UI.** `remoteControlService.setDeviceRights()` +
IPC `remote:setDeviceRights`/`remote:revokeDevice`, в статусе появился `pairedDevices` (все
устройства с выданным токеном, включая офлайн). В бейдже Remote Control на вкладке «Устройства» —
селектор прав (`readOnly`/`hitl`/`full`) у каждого устройства и отдельный блок спаренных, но не
подключённых устройств с правами и отзывом токена. Права применяются сразу к открытой сессии и
переживают пересопряжение по PIN (флаг `rightsExplicit`), иначе достаточно было бы
переподключиться с PIN, чтобы вернуть себе полный доступ.

**4. Каталог хостов на самом relay закрыт токеном.** `GET /api/federation/hosts` требует
`Authorization: Bearer $RELAY_API_TOKEN`; пока токен не задан, каталог отключён (`403
catalog_disabled`), а не открыт анонимно — он раскрывает имена машин, а relay стоит в открытом
интернете. Логика — чистая функция `isRelayApiAuthorized` (константное сравнение) в
`scripts/remoteRelayAuth.mjs`, задокументировано в `deploy/relay/README.md`.

**Тесты и проверки.** `tests/unit/remoteControlAuth.test.ts` +12 тестов (назначение прав и их
сохранение при пересопряжении, `eventId` в live-событиях и кольцевом буфере, `get_events_since`
от последнего увиденного id, зашифрованный `handshake_ack` без утечки токена),
`tests/unit/remoteRelayAuth.test.ts` +4 (`isRelayApiAuthorized`). Всего 365 тестов, 41 файл.
`npm run build` чист (0 ошибок ESLint; предупреждений 513 против 514 на HEAD — baseline не вырос),
`npm run pack:win` выполнен. Дополнительно прогнаны разовые проверки (вне репозитория): разбор
JS обоих статических клиентов (они не покрываются tsc/vite) и живой smoke-тест relay-транспорта —
регистрация хоста по подписи, `relay_ack` клиенту, проброс зашифрованного handshake хосту с
`fromClientId`, адресный ответ обратно клиенту, 401/200 каталога по токену.

**Что осознанно осталось за рамками:** hub-режим (ProjectHub как клиент другого ProjectHub,
назначение `agent:<role>@<hostId>`) и каталог хостов федерации как продукт — это TASK-66;
decision-11 остаётся `proposed` до неё.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Контур Remote Control починен end-to-end: единый формат E2EE на всех клиентах (Telegram Mini App,
встроенный веб-клиент, хост), все объявленные RPC реализованы, HITL и AI Studio работают в
Mini App, UI-бейдж больше не расходится по полям с сервисом. Security-контур приведён к
decision-5: Ed25519 identity, per-device токены с правами и отзывом, секреты только через
safeStorage, PIN с rate-limit и константным сравнением, `/api/*` за токеном, `/api/qr` (протекал
мастер-секрет без проверки) удалён, CORS `*` снят. Relay защищён от захвата hostId
challenge-response подписью, получил Dockerfile с инструкцией self-hosted деплоя, а его каталог
хостов (`/api/federation/hosts`) закрыт токеном `RELAY_API_TOKEN` и по умолчанию выключен.

Вторая итерация закрыла AC#5 полностью: оба статических клиента теперь умеют подключаться к хосту
ЧЕРЕЗ relay (`?role=client&hostId=...` + зашифрованный пакет `handshake` с PIN/ключом/токеном),
`handshake_ack` шифруется и больше не отдаёт per-device токен открытым текстом через чужой сервер,
догон пропущенных событий работает end-to-end (`eventId` в live-пакетах, `lastEventId` в ack,
`get_events_since` при переподключении), а права конкретного устройства (`readOnly`/`hitl`/`full`)
назначаются и отзываются из UI, в том числе для устройств не в сети, и переживают пересопряжение
по PIN.

Попутно найдены и исправлены независимые баги: Telegram Mini App физически не попадала в
packaged-сборку (жила в `src/`, а не в `public/`/`dist/`) — в проде всегда работал только
fallback-клиент; в QR/deep-link `hostId` уезжал в параметре `host`, и Mini App пыталась
подключиться к `ph_host_...` как к сетевому адресу; сохранённая сессия Mini App терялась, если
ключ приезжал из deep-link; RPC встроенного клиента без таймаута вешал загрузку UI на ответе,
отличном от `rpc_res`.

Все 9 AC выполнены. `npm run build` (lint 0 ошибок, 365 тестов, tsc, vite, check-bundle) и
`npm run pack:win` проходят. Hub-режим и каталог хостов федерации как продукт — вне этой задачи,
это TASK-66; decision-11 остаётся `proposed` до неё.
<!-- SECTION:FINAL_SUMMARY:END -->
