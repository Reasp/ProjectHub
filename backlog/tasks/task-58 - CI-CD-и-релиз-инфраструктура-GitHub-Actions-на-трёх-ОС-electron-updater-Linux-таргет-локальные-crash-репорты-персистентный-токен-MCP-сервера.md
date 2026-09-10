---
id: TASK-58
title: >-
  CI/CD и релиз-инфраструктура: GitHub Actions на трёх ОС, electron-updater,
  Linux-таргет, локальные crash-репорты, персистентный токен MCP-сервера
status: To Do
assignee: []
created_date: '2026-09-10 07:16'
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
- [ ] #1 Workflow CI на трёх ОС выполняет полный npm run build на каждый PR и push в master, артефакты pack сохраняются; сборка зелёная
- [ ] #2 Workflow release по тегу v* публикует GitHub Release с бинарниками Windows (nsis, portable), macOS (dmg, zip) и Linux (AppImage) и файлами latest*.yml
- [ ] #3 electron-updater проверяет обновления при старте и по кнопке, устанавливает на Windows/Linux, на macOS без сертификата показывает уведомление со ссылкой
- [ ] #4 crashReporter включён без отправки на сервер; экран «Диагностика» собирает архив логов и дампов без секретов
- [ ] #5 Токен MCP-сервера персистентен через safeStorage, переживает перезапуск, отзывается и пересоздаётся из UI; внешний конфиг Claude Code продолжает работать после рестарта
- [ ] #6 Добавлены unit-тесты на аутентификацию mcpServerService и на аутентификацию/формат пакетов remoteControlService
- [ ] #7 README описывает процесс релиза и защиту ветки master
<!-- AC:END -->
