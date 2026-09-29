---
id: TASK-112
title: >-
  Push-to-talk на правом Ctrl и правом Command: нативный источник состояния
  клавиши
status: Done
assignee: []
created_date: '2026-09-28 07:10'
updated_date: '2026-09-29 11:08'
labels:
  - voice
  - push-to-talk
dependencies: []
references:
  - >-
    backlog/decisions/decision-30 -
    Push-to-talk-на-автоповторе-globalShortcut-и-wake-word-по-транскрипту.md
  - electron/services/pushToTalkPolicy.ts
  - electron/services/voiceHotkeyService.ts
modified_files:
  - electron/services/pushToTalkPolicy.ts
  - electron/services/nativeKeyHook.ts
  - electron/services/voiceHotkeyService.ts
  - electron/ipc/voiceIpc.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/services/voiceService.ts
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/voice/VoiceSettingsModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/pushToTalkPolicy.test.ts
  - scripts/check-bundle.mjs
  - package.json
  - package-lock.json
  - >-
    backlog/decisions/decision-63 -
    Push-to-talk-на-клавише-модификаторе-нативный-хук-uiohook-napi-и-запасное-сочетание.md
  - >-
    backlog/decisions/decision-30 -
    Push-to-talk-на-автоповторе-globalShortcut-и-wake-word-по-транскрипту.md
priority: medium
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Запрос пользователя (2026-09-28): назначить push-to-talk на правый Ctrl, а на macOS — на правый Command.

Сейчас это невозможно: push-to-talk построен на Electron `globalShortcut` ([[decision-30]]), а его акселераторы не различают левый и правый модификатор и не принимают чистый модификатор вовсе. Отпускание клавиши восстанавливается по автоповтору и только на Windows.

decision-30 (раздел «Долг») заранее описывает путь: абстракция источника состояния клавиши с двумя реализациями — автоповтор `globalShortcut` и нативный хук. Задача реализует вторую.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Правый Ctrl назначается клавишей push-to-talk в настройках голоса и стоит по умолчанию (Windows, Linux)
- [x] #2 Удержание клавиши = запись, отпускание завершает фразу по настоящему keyup, без дедлайна автоповтора
- [x] #3 Сочетание с участием этой клавиши (правый Ctrl+C и т.п.) не отправляет фразу в распознавание — запись отменяется
- [x] #4 Левый Ctrl и левый Command запись не запускают
- [x] #5 Если нативный хук недоступен (нет модуля, нет разрешения macOS), приложение не падает, push-to-talk откатывается на запасное сочетание, а настройки показывают причину
- [x] #6 Клавиатурный хук запущен только пока push-to-talk включён и назначен на клавишу-модификатор; коды клавиш в лог не пишутся
- [x] #7 Прежние сочетания globalShortcut (Control+Shift+Space и др.) продолжают работать
- [x] #8 Новая логика вынесена в чистый модуль и покрыта unit-тестами; npm run build и pack:win проходят
- [x] #9 Принятое решение оформлено ADR, decision-30 получил ссылку на него
- [ ] #10 Правый Command на macOS проверен вживую: назначение, удержание, запрос разрешения «Универсальный доступ», работа хука в упакованном .app
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

- `uiohook-napi` 1.5.5 добавлен в dependencies (N-API, пребилды в пакете, пересборка не нужна); `asarUnpack` и `check-bundle` дополнены.
- `pushToTalkPolicy.ts`: таблица `NATIVE_KEYS` (`RightControl` везде, `RightCommand` только macOS), `nativeKeyFor`, `isValidPushToTalkKey`, `supportsHoldMode(platform, accelerator)`, конечный автомат `registerKeyDown` / `registerKeyUp` / `abandonKeyHold`. Дефолт: клавиша-модификатор платформы, режим hold.
- `nativeKeyHook.ts`: ленивая загрузка модуля, проверка разрешения macOS, коды причин `module` / `permission` / `start`.
- `voiceHotkeyService.ts`: два источника (хук и globalShortcut), откат на `Control+Shift+Space`, сторожевой таймер 60 с, событие остановки с флагом `cancelled`, регистрации по очереди. Негодная клавиша теперь оставляет прежнюю, а не сбрасывает на дефолт.
- Рендерер: `voiceService.cancelPushToTalk()` выбрасывает записанное; в настройках выбор «Правый Ctrl / Правый Command / Своё сочетание…», строка состояния с причиной отказа хука и кнопкой запроса разрешения macOS.
- ADR: decision-63; decision-30 дополнен разделом «Пересмотр 2026-09-28».

## Проверено

- Unit: `tests/unit/pushToTalkPolicy.test.ts` — 32 теста; весь набор — 2065 тестов, 181 файл. ESLint: 0 ошибок, предупреждений 495 до и после.
- `npm run pack:win` проходит (lint, тесты, tsc, vite build, check-bundle).
- Живая проверка на Windows 10 в упакованном exe (отдельная копия сборки, свой userData, фейковый микрофон Chromium, клавиши инъецированы через `keybd_event`):
  - старт: источник `hook`, клавиша `RightControl`, режим `hold`;
  - правый Ctrl 400 мс: старт → стоп, удержание 413 мс;
  - левый Ctrl: событий нет;
  - правый Ctrl + F15: старт → стоп с `cancelled`;
  - после смены на `Control+Shift+F11` правый Ctrl событий не даёт; негодное `RightCommand` оставляет прежнюю клавишу;
  - режим toggle: чистое нажатие включает, сочетание не переключает, следующее чистое нажатие выключает;
  - выключенный push-to-talk: событий нет;
  - в `main.log` кодов клавиш нет.
- Отказ хука (модуль в копии сборки переименован): приложение стартует, причина `hook-module` видна в настройках. Запасное сочетание `Control+Shift+Space` при этом не зарегистрировалось — его держал запущенный ProjectHub владельца; настройки показали «Push-to-talk не работает».

## Не проверено

- macOS и Linux не запускались: машин нет. AC #10 открыт.
- Путь до Whisper с реальной речью по правому Ctrl не прогонялся: конвейер после клавиши не менялся.
- Настоящая клавиатура: клавиши инъецированы скриптом, физическое нажатие проверит владелец.

## Оговорки

- `release/win-unpacked/ProjectHub.exe` остался старым: во время сборки был запущен ProjectHub владельца, файлы заблокированы. Нужно закрыть приложение и повторить `npm run pack:win`.
- Остались каталоги `release_tmp_1790580273420` и `release_tmp_1790580825709` с заблокированным `app.asar` (в `.gitignore`).
- Дважды подряд весь набор vitest падал за 9 секунд с `Vitest failed to find the runner` (181 файл, 0 тестов) сразу после закрытия копии приложения; третий запуск прошёл без изменений в коде. Причина не установлена.
<!-- SECTION:NOTES:END -->
