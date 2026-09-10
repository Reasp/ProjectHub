---
id: TASK-65
title: >-
  Ремонт Remote Control: единый формат E2EE, реализация RPC, аутентификация
  релея, per-device токены
status: To Do
assignee: []
created_date: '2026-09-10 07:20'
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
- [ ] #1 Mini App и встроенный клиент обмениваются с хостом зашифрованными пакетами одного формата; тест «браузер шифрует, Node расшифровывает и наоборот» проходит
- [ ] #2 Все методы RemoteRpcMethod реализованы в dispatchRpc; логи процессов и AI Studio в Mini App работают или удалены из UI
- [ ] #3 Запрос HITL появляется на телефоне и в Mini App, решение применяется по requestId и закрывает запрос на десктопе
- [ ] #4 Устройства имеют собственные токены с правами и отзывом, PIN защищён rate-limit и константным сравнением, секреты хранятся через safeStorage
- [ ] #5 Релей не позволяет занять чужой hostId, требует подпись хоста и аутентификацию клиента; есть Dockerfile и инструкция self-hosted деплоя
- [ ] #6 Эндпоинты /api/* недоступны без токена, пути проектов и имя машины не раскрываются анонимно
- [ ] #7 Выбор режима и адрес релея из UI применяются, QR и deep-link содержат корректные данные
- [ ] #8 README и документация не упоминают WebRTC как реализованный режим
- [ ] #9 Unit-тесты на аутентификацию, формат пакетов, права и rate-limit добавлены, npm run build проходит
<!-- AC:END -->
