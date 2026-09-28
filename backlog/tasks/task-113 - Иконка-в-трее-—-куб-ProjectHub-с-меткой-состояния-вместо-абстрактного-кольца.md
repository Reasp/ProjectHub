---
id: TASK-113
title: Иконка в трее — куб ProjectHub с меткой состояния вместо абстрактного кольца
status: Review
assignee: []
created_date: '2026-09-28 07:54'
updated_date: '2026-09-28 08:02'
labels:
  - ui
  - tray
dependencies: []
modified_files:
  - electron/services/trayIconBadge.ts
  - electron/services/trayIcons.ts
  - electron/main.ts
  - scripts/gen-tray-icons.mjs
  - scripts/pack-win.mjs
  - scripts/patch-exe-icon.mjs
  - tests/unit/trayIconBadge.test.ts
  - >-
    backlog/decisions/decision-13 -
    Уведомления-через-единую-шину-событий-трей-системные-уведомления-звук-и-Telegram.md
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Замечание владельца (2026-09-28): в трее картинка «всё ещё от electron», а не от ProjectHub.

Что найдено в коде:

- иконка трея — не логотип приложения, а нарисованное генератором кольцо (`scripts/gen-tray-icons.mjs` → `electron/services/trayIcons.ts`): серое, синее, жёлтое или красное по состоянию. Брендового куба из `build/icon.png` в трее нет;
- иконка окна в упакованном приложении берётся по пути `../public/icon.png` или `../build/icon.png` от `dist-electron` — ни того, ни другого в `app.asar` нет (туда попадают только `dist/` и `dist-electron/`), поэтому окно и панель задач получают иконку из ресурсов exe;
- иконку в ресурсы exe вшивает `scripts/patch-exe-icon.mjs` после упаковки. Если во время `pack:win` приложение запущено, exe заблокирован, патч не проходит, и остаётся стандартная иконка Electron.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В трее показан куб ProjectHub; состояния working, attention и recording отмечены цветной меткой, idle — без метки
- [x] #2 Иконка трея имеет представления для масштабов экрана 100%, 200% и 300%
- [x] #3 Иконка окна в упакованном приложении берётся из существующего файла внутри app.asar
- [x] #4 pack:win заметно сообщает, если иконку в exe вшить не удалось
- [x] #5 Рисование метки вынесено в чистый модуль и покрыто unit-тестами
- [x] #6 Иконка трея и иконка exe проверены на собранном приложении
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

- Иконка трея: куб ProjectHub из `build/sizes/` (16, 32, 48 пикселей) вместо нарисованного круга. Метку состояния рисует `trayIconBadge.ts` по пикселям BGRA: `working` — синяя, `attention` — жёлтая, `recording` — красная, `idle` — без метки. `trayIcons.ts` по-прежнему пишет генератор `scripts/gen-tray-icons.mjs`.
- Иконка окна: путь ищется среди `../dist/icon.png`, `../public/icon.png`, `../build/icon.png`. Раньше в упакованном приложении не существовал ни один из двух путей.
- `patch-exe-icon.mjs` завершается с кодом 1, если иконку не удалось вшить в `release/win-unpacked/ProjectHub.exe`. Отказ на упакованных exe (portable, установщик) остаётся предупреждением.
- `pack-win.mjs` завершается с кодом 1 и перечнем причин, если `release/win-unpacked` обновлён не полностью или иконка не вшита. Раньше в этих случаях печаталось «успешно собрано», а exe оставался старым.
- decision-13 п. 5 дополнен уточнением от 2026-09-28.

## Проверено

- Unit: `tests/unit/trayIconBadge.test.ts` — 7 тестов; весь набор — 2072 теста, 182 файла. ESLint: 0 ошибок, предупреждений 495, как и было.
- `npm run pack:win` при закрытом приложении: сборка прошла в `release/win-unpacked`, иконка вшита.
- Собранный exe (свой userData), снимок правого нижнего угла экрана: в трее куб ProjectHub; при удержании правого Ctrl на кубе красная метка записи.
- Иконка, которую Windows отдаёт для `ProjectHub.exe` (`ExtractAssociatedIcon`), — куб.
- `patch-exe-icon.mjs` при занятом exe: код выхода 1 и сообщение; при свободном — 0.
- `dist/icon.png` присутствует в `app.asar` (список файлов пакета).

## Не проверено

- Метки `working` и `attention` на живом трее: проверен предпросмотр всех четырёх состояний в трёх размерах и живая метка `recording`.
- Иконка в заголовке окна и на панели задач глазами не сверялась: проверены наличие файла в пакете и иконка exe.
- Отказ `pack:win` целиком при запущенном приложении: проверен только `patch-exe-icon.mjs` отдельно.
- macOS и Linux.

## Что именно видел владелец

Не установлено. В коде иконка трея была серым кругом, а логотип Electron мог показываться только из ресурсов exe — на панели задач, в заголовке окна и в уведомлениях, если патч иконки не прошёл. Исправлены оба места.
<!-- SECTION:NOTES:END -->
