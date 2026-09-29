---
id: TASK-115
title: >-
  Карточка результата push-to-talk: распознанный текст остаётся на экране до
  закрытия
status: Done
assignee: []
created_date: '2026-09-29 08:27'
updated_date: '2026-09-29 11:08'
labels:
  - voice
  - push-to-talk
  - ui
dependencies:
  - TASK-112
references:
  - src/services/voiceService.ts
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/voice/SystemVoiceOverlay.tsx
  - electron/ipc/voiceIpc.ts
  - electron/services/nativeKeyHook.ts
modified_files:
  - src/utils/voiceResultCard.ts
  - electron/services/voiceResultCardWatch.ts
  - electron/services/nativeKeyHook.ts
  - electron/ipc/voiceIpc.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/services/voiceService.ts
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/voice/SystemVoiceOverlay.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/voiceResultCard.test.ts
  - >-
    backlog/decisions/decision-65 -
    Карточка-результата-push-to-talk-закрытие-глобальным-кликом-через-uiohook-и-временный-Esc.md
  - .rag-index/
priority: high
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После отпускания клавиши push-to-talk пользователь не видит, что распознал Whisper.

Причина: системный оверлей видим, пока `isListening || isPaused` (`electron/ipc/voiceIpc.ts`, `voice:overlay-sync`). `endPushToTalk` сразу после распознавания переводит `voiceService` в `idle` → `isListening = false` → main прячет окно; текст держится на экране миллисекунды. Полоса в окне приложения (`VoiceControlWidget`, Top HUD) при push-to-talk не показывается вовсе — только в hands-free. Кроме того, оверлей показывает либо распознанный текст, либо итог команды, но не оба.

Нужно: после отпускания клавиши оверлей превращается в закреплённую карточку результата — распознанный текст целиком и итог команды («Напечатано», «Открываю доску задач», «Не понял команду»), кнопка закрытия. Карточка висит без таймера, пока пользователь её не уберёт: крестиком, кликом мимо, Esc или следующим нажатием push-to-talk.

Клик мимо: оверлей не забирает фокус (`showInactive`, иначе диктовка печатала бы не туда), поэтому `blur` не работает — используется глобальный хук мыши `uiohook-napi`, уже поднятый для push-to-talk (decision-63), только пока карточка на экране.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После отпускания push-to-talk с непустым распознаванием системный оверлей остаётся видимым и показывает распознанный текст целиком (с переносом, без обрезки по ширине)
- [x] #2 В карточке одновременно видны распознанный текст и итог команды; пока классификатор думает, итог показывает промежуточное состояние
- [x] #3 Карточка закрывается кнопкой ✕, кликом мыши за её пределами, клавишей Esc и следующим нажатием push-to-talk (новая запись заменяет карточку); таймера автозакрытия нет
- [x] #4 Глобальные подписки на клики мыши и Esc действуют только пока карточка на экране и снимаются при её закрытии
- [x] #5 Пустое распознавание и отмена записи сочетанием клавиш карточку не закрепляют
- [x] #6 Решение о закрытии по глобальному клику зафиксировано ADR; чистая логика (попадание клика в границы, решение о закреплении) вынесена в модуль и покрыта unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

- **Чистый модуль `src/utils/voiceResultCard.ts`** (без Electron/React, используют main и рендерер): `shouldPinResult` (только финальная непустая фраза push-to-talk без отмены), переходы карточки `pinResult` / `applyCardFeedback` / `completeCard` / `dismissCard` (закрытие по `id` не снимает новую карточку), `toResultCard` (нормализация IPC), `isCardVisible` (закрытая в main карточка не всплывает из запоздавшей синхронизации), геометрия `physicalToDip` / `isPointInBounds` / `isClickOutsideCard`, оценка высоты `estimateCardHeight`. Тесты: `tests/unit/voiceResultCard.test.ts` (16).
- **voiceService**: у результата появился `meta.pushToTalk`. Фраза, отправленная `endPushToTalk`, помечается явно. Для Web Speech API результат считается push-to-talk, если клавиша ещё зажата или отпущена не более 5 с назад (метка одноразовая). `cancelPushToTalk` метку сбрасывает.
- **VoiceControlWidget**: карточка хранится в ref (`resultCardRef`), `syncToOverlay` вынесен в `useCallback` и шлёт поле `resultCard`. `setLastFeedback` теперь обёртка: итог команды дописывается в карточку, а сброс по таймеру полосы карточку не очищает. Уведомления об устройстве идут только в полосу. Новое нажатие push-to-talk снимает карточку. Закрытие из main приходит событием `voice:result-card-dismissed` с `id`. id карточек начинаются с `Date.now()`, поэтому после перезагрузки окна они не совпадут с уже закрытыми.
- **main (`voiceIpc.ts`)**: окно видимо при `isListening || isPaused || resultCard`. Новый режим геометрии `card`: 900 DIP или 60 % ширины, высота по оценке, не выше 60 % рабочей области, дальше прокрутка. Ключ кэша геометрии — размер, поэтому перетащенная карточка не прыгает. Действие `dismiss-result` и закрытие кликом мимо или Esc обрабатываются в main: окно прячется сразу, если запись не идёт, и запоминается `dismissedCardId`.
- **`voiceResultCardWatch.ts`**: пока карточка видна, `globalShortcut.register('Escape')` и подписка `nativeKeyHook.startMouse`; при закрытии `unregister` и `stopMouse`. Координаты: на Windows `screen.screenToDipPoint`, на macOS как есть, на Linux деление на `scaleFactor`. Закрытие откладывается через `setImmediate`. Если хук мыши недоступен, это не фатально: пишется предупреждение, остальные способы работают.
- **nativeKeyHook**: два независимых потребителя, клавиши push-to-talk и мышь карточки. Хук останавливается, только когда не нужен ни одному. Наружу уходят только координаты `mousedown`.
- **SystemVoiceOverlay**: компонент `ResultCard`. Текст целиком с переносом (`white-space: pre-wrap`, без `truncate`), под ним итог команды. Пока идёт разбор — спиннер и «Распознаю команду…». Кнопка ✕ в зоне `no-drag`.
- i18n: `voice.resultCard.{title,hint,classifying,close}` (ru/en). ADR: decision-65, `npm run index-docs` выполнен.

## Проверки

- `npm run lint`: 0 ошибок. В затронутых файлах те же 2 старых предупреждения `exhaustive-deps`, новых нет.
- `npm test`: 193 файла, 2237 тестов проходят.
- `npm run lint:docs`: чисто. `npm run pack:win`: exe собран.
- Живая проверка в собранном exe на стенде `C:\Temp\ph-115`: отдельный userData, фейковый микрофон Chromium, WAV голосом Piper (Ирина). Push-to-talk имитировался событием `voice:push-to-talk` из main. Клик мимо и Esc — синтетическим вводом ОС (`SetCursorPos`/`mouse_event`/`keybd_event`) по собственному тестовому окну. Итог: 9/9 для короткой фразы-команды и 20/20 для длинной:
  - карточка видна после отпускания, текст целиком в две строки, итог команды под ним («Открываю доску задач и бэклог», «Не понял команду…»); промежуточное «Разбираю команду…» видно;
  - карточка не забирает фокус (тестовое окно остаётся `isFocused`) и через 8 с всё ещё на экране;
  - закрытие ✕, кликом мимо, Esc и новым нажатием работает; клик внутри карточки её не закрывает;
  - после каждого закрытия `globalShortcut.isRegistered('Escape') === false`;
  - первый Esc до тестового окна не дошёл, второй, после закрытия, дошёл (`["Escape"]`);
  - отменённая запись (`cancelled: true`) карточку не закрепляет.

## Не проверено вживую

- Реальное удержание правого Ctrl: фейковым вводом не воспроизвести. Путь от хука до рендерера не менялся.
- Масштаб DPI ≠ 100 %: на этой машине оба монитора 96 DPI, пересчёт покрыт unit-тестами.
- Печать диктовкой в активное окно: computer-use на стенде выключен. Проверено только, что карточка не забирает фокус.
- macOS.

## Замечание

Для нераспознанной команды итог «Не понял команду: «…»» повторяет фразу, которая уже показана в карточке. Это существующая строка `feedback.notUnderstood`, в полосе она нужна. Для карточки можно завести короткий вариант отдельной задачей.
<!-- SECTION:NOTES:END -->
