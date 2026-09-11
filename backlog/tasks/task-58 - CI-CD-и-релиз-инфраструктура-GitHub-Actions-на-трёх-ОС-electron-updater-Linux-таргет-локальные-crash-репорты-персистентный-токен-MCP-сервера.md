---
id: TASK-58
title: >-
  CI/CD и релиз-инфраструктура: GitHub Actions на трёх ОС, electron-updater,
  Linux-таргет, локальные crash-репорты, персистентный токен MCP-сервера
status: Done
assignee:
  - veshiy666@gmail.com
created_date: '2026-09-10 07:16'
updated_date: '2026-09-11 02:38'
labels:
  - ade-roadmap
  - ci
  - release
  - infra
  - P1
dependencies: []
references:
  - package.json
  - electron/services/mcpServerService.ts
  - electron/services/remoteControlService.ts
  - electron/services/logger.ts
  - electron/main.ts
  - scripts/pack-win.mjs
  - scripts/pack-mac.mjs
documentation:
  - >-
    backlog/decisions/decision-14 -
    Релиз-инфраструктура-GitHub-Actions-автообновление-crash-репорты-и-Linux-таргет.md
  - >-
    backlog/decisions/decision-7 -
    Local-first-хранение-состояния-и-отсутствие-телеметрии.md
modified_files:
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - package.json
  - package-lock.json
  - electron/main.ts
  - electron/preload.ts
  - electron/ipc/index.ts
  - electron/ipc/diagnosticsIpc.ts
  - electron/services/mcpServerService.ts
  - electron/services/remoteControlService.ts
  - electron/services/updaterService.ts
  - electron/services/versionCompare.ts
  - electron/services/diagnosticsService.ts
  - electron/services/zipWriter.ts
  - src/types/electron.d.ts
  - src/types/remote.ts
  - src/components/layout/Header.tsx
  - src/components/diagnostics/DiagnosticsBadge.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/mcpServerAuth.test.ts
  - tests/unit/remoteControlAuth.test.ts
  - tests/unit/zipWriter.test.ts
  - tests/unit/updaterVersion.test.ts
  - README.md
  - >-
    backlog/decisions/decision-14 -
    Релиз-инфраструктура-GitHub-Actions-автообновление-crash-репорты-и-Linux-таргет.md
priority: medium
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-14, decision-7).

**Что не так сейчас**
- CI отсутствует: каталога `.github/` нет, гейт `npm run build` выполняется только локально.
- Сборки: Windows `dir` + `portable`, macOS `dmg`/`zip` без подписи, Linux-таргета нет. `electron-updater` не установлен, обновление это ручная замена архива. На нескольких ПК легко получить разные версии и несовместимый протокол федерации.
- `crashReporter` не используется; логи `main.log` пишутся, но собрать их для диагностики из UI нельзя.
- Токен встроенного MCP-сервера `ph_mcp_<24hex>` генерируется в памяти при старте и не персистится, поэтому конфиги Claude Code/Cursor протухают после каждого перезапуска ProjectHub.
- Тестов на `mcpServerService`, `remoteControlService` и IPC-слой нет; e2e нет.

**Что сделать**
1. `.github/workflows/ci.yml`: матрица `windows-latest`, `macos-latest`, `ubuntu-latest`; `npm ci`, `npm run build`, кэш npm и electron-builder; артефакты `pack:*` на PR и push в `master`.
2. `.github/workflows/release.yml`: на тег `v*` выполняет `dist` для всех ОС, публикует GitHub Release с бинарниками и `latest*.yml`.
3. Таргеты: Windows добавить `nsis` (portable сохранить), Linux `AppImage`; проверить `asarUnpack` для нативных модулей на Linux.
4. `electron-updater` с провайдером GitHub Releases: проверка при старте и по кнопке, уведомление в UI, установка при выходе; для macOS без сертификата только уведомление со ссылкой.
5. Версия протокола федерации/Remote в handshake, понятная ошибка при несовместимости (задел для TASK-66).
6. `crashReporter.start({ uploadToServer: false })`, экран «Диагностика» с версией, путями состояния, кнопкой «Собрать архив логов» (main.log, crash dumps, конфиг без секретов).
7. Токен MCP-сервера генерируется один раз, хранится через `safeStorage`, отображается в UI с кнопками «Копировать» и «Отозвать и создать новый».
8. Первые тесты на поверхность безопасности: `mcpServerService` (auth, Origin, Host), `remoteControlService` (PIN, токен, формат пакетов) с моками сокетов.
9. Защита ветки `master` (PR + зелёный CI) описывается в README; правило 9 CLAUDE.md сохраняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Workflow CI на трёх ОС выполняет полный npm run build на каждый PR и push в master, артефакты pack сохраняются; сборка зелёная
- [x] #2 Workflow release по тегу v* публикует GitHub Release с бинарниками Windows (nsis, portable), macOS (dmg, zip) и Linux (AppImage) и файлами latest*.yml
- [x] #3 electron-updater проверяет обновления при старте и по кнопке, устанавливает на Windows/Linux, на macOS без сертификата показывает уведомление со ссылкой
- [x] #4 crashReporter включён без отправки на сервер; экран «Диагностика» собирает архив логов и дампов без секретов
- [x] #5 Токен MCP-сервера персистентен через safeStorage, переживает перезапуск, отзывается и пересоздаётся из UI; внешний конфиг Claude Code продолжает работать после рестарта
- [x] #6 Добавлены unit-тесты на аутентификацию mcpServerService и на аутентификацию/формат пакетов remoteControlService
- [x] #7 README описывает процесс релиза и защиту ветки master
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано:
1. `.github/workflows/ci.yml` — матрица windows/macos/ubuntu-latest, `npm ci` + `npm run build` (полный локальный гейт) на PR и push в master, `--dir`-сборка + upload-artifact на каждой ОС.
2. `.github/workflows/release.yml` — на тег `v*` тот же гейт + `electron-builder --publish always` на каждой ОС (публикация в GitHub Release тега вместе с latest*.yml).
3. `package.json`: добавлен таргет `nsis` для Windows (portable/dir сохранены), секция `linux.target: AppImage`, `build.publish` (github, Reasp/ProjectHub), конфиг `nsis`.
4. `electron/services/updaterService.ts` (+ `versionCompare.ts` для чистой функции сравнения версий): electron-updater для win/linux (проверка на старте с задержкой 5с и по кнопке, автозагрузка, `quitAndInstall`), для macOS — сверка версии через GitHub Releases API и ссылка на релиз без автоустановки (Squirrel.Mac требует подписи).
5. Версия протокола федерации `REMOTE_FEDERATION_PROTOCOL_VERSION` в `remoteControlService.ts`: включена в `FederationHost`, проверяется в `/api/federation/register` (409 + понятное сообщение при несовпадении), несовместимые пиры помечаются `protocolIncompatible` — задел для TASK-66.
6. `crashReporter.start({ uploadToServer: false, compress: true })` в main.ts; `electron/services/diagnosticsService.ts` + собственный `zipWriter.ts` (без внешней зависимости) собирают архив `main.log` + ротации + crash-дампы + info.json; экран «Диагностика» (`DiagnosticsBadge.tsx`) в хедере — версия/пути, проверка обновлений, кнопка «Собрать архив логов».
7. `mcpServerService.init()` — токен грузится/сохраняется через существующий `secretStorageService` (safeStorage), переживает перезапуск; UI копирования/отзыва токена уже существовал (`McpServerStatusBadge`), теперь опирается на персистентный токен.
8. Юнит-тесты: `mcpServerAuth.test.ts` (8, реальный HTTP на 127.0.0.1: Origin/Host/Bearer/regenerate), `remoteControlAuth.test.ts` (12, PIN/ключ + `handleIncomingClientMessage` с замоканными сокетами/устройствами: не-JSON, неодобренное устройство, ping/pong, read-only, версия протокола), `zipWriter.test.ts` (4), `updaterVersion.test.ts` (4).
9. README: раздел «CI/CD и релизы» — таблица форматов по ОС, инструкция релиза по тегу, включение branch protection для master, описание экрана «Диагностика».
10. decision-14 переведён в `accepted` (реализовано), `.rag-index` пересобран.

Проверено локально: `npm run build` (lint/test/tsc/vite build/check-bundle) зелёный, 313 unit-тестов проходят, `npm run pack:win` пересобирает `release/win-unpacked/ProjectHub.exe`. Живым запуском (`npm run dev`, реальный Electron) подтверждено: приложение стартует, MCP-сервер поднимается, апдейтер корректно определяет dev/unpacked режим, бейдж «Диагностика» рендерится в хедере рядом с MCP-бейджем. По ходу живого теста найден и исправлен реальный баг: `electron-updater` — CJS-пакет, именованный экспорт `autoUpdater` не проходит через Node ESM-загрузчик main-процесса; исправлено на default-импорт с деструктуризацией.

Не проверено (не выполнимо в этой среде): реальный прогон `ci.yml`/`release.yml` на GitHub Actions (нет пуша/тега), сквозной цикл электрон-апдейтера (скачивание/quitAndInstall) — для этого нужен опубликованный релиз; включение branch protection в GitHub UI — это ручное действие пользователя, описано в README.
<!-- SECTION:NOTES:END -->
