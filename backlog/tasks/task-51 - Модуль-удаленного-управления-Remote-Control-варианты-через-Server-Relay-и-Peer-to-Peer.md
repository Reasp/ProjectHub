---
id: TASK-51
title: >-
  Модуль удаленного управления (Remote Control): варианты через Server Relay и
  Peer-to-Peer
status: Done
assignee: []
created_date: '2026-09-07 23:56'
updated_date: '2026-09-08 00:13'
labels:
  - remote-control p2p webrtc relay mobile security
dependencies: []
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Реализация архитектуры и интерфейса удаленного управления десктопным приложением ProjectHub со смартфонов, планшетов и других ПК с поддержкой как прямого Peer-to-Peer соединения (WebRTC / LAN Direct), так и через центральный релей-сервер со сквозным E2EE шифрованием.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Встроенный сервис RemoteControlService в Electron main с поддержкой режимов LAN Direct, WebRTC P2P и Server Relay
- [x] #2 Легковесный автономный Relay-сервер на Node.js (scripts/remote-relay-server.mjs) с поддержкой E2EE шифрования (AES-256-GCM)
- [x] #3 Адаптивный мобильный веб-клиент для удаленного управления (проекты, задачи Kanban, процессы и терминал логов, чат AI Studio и подтверждение HITL)
- [x] #4 Десктопное модальное окно управления RemoteControlModal с генерацией QR-кода, выбором режима подключения, списком устройств и настройками безопасности
- [x] #5 Индикатор статуса RemoteControlBadge в шапке приложения Header.tsx с отображением активных подключений
- [x] #6 Полная локализация (en/ru), валидация документации npm run lint:docs, тесты npm test и сборка npm run pack:win
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Разработка src/types/remote.ts (RPC протокол, типы подключений, E2EE сообщения)
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализован модуль удаленного управления ProjectHub (TASK-51) с поддержкой Server Relay и WebRTC Peer-to-Peer, сквозным шифрованием AES-256-GCM, мобильным веб-интерфейсом и десктопным бейджем/модальным окном с генерацией QR-кода.
<!-- SECTION:FINAL_SUMMARY:END -->
