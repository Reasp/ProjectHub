---
id: TASK-94
title: Режим «только разрешённые окна» запрещает запуск приложения из allowlist
status: Review
assignee: []
created_date: '2026-09-17 12:35'
updated_date: '2026-09-18 05:01'
labels:
  - computer-use
  - voice
milestone: m-0
dependencies: []
references:
  - electron/services/computerPolicy.ts
  - >-
    backlog/decisions/decision-27 -
    Управление-компьютером-через-MCP-прокси-ProjectHub-с-HITL-по-классам-действий.md
modified_files:
  - electron/services/computerPolicy.ts
  - electron/services/computerToolCatalog.ts
  - electron/services/computerUseService.ts
  - tests/unit/computerPolicy.test.ts
  - >-
    backlog/decisions/decision-36 -
    Режим-только-разрешённые-окна-запуск-приложения-по-имени-и-предпроверка-только-жёстких-запретов.md
  - >-
    backlog/decisions/decision-27 -
    Управление-компьютером-через-MCP-прокси-ProjectHub-с-HITL-по-классам-действий.md
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Найдено при живой проверке TASK-83 AC#4 (2026-09-17): голосовая команда «открой Блокнот и напечатай …» дошла до `computer_open_application notepad.exe`, но политика отклонила её при `onlyAllowlistedWindows: true`, хотя `notepad.exe` есть в allowlist. Причина в отказе: «цель не определена».

Причина — в `evaluateComputerPolicy` (`electron/services/computerPolicy.ts`). В ветке `onlyAllowlistedWindows && !spec.targetless` проверяется окно-цель (`target`), а у `open_application` до запуска окна нет. `isTargetAllowlisted(undefined, …)` возвращает false. Имя приложения из аргументов инструмента при этом не сверяется с allowlist.

Сейчас в строгом режиме нельзя запустить даже разрешённое приложение. Прогон TASK-83 проходился с `onlyAllowlistedWindows: false`.

## Что сделать
- Для `open_application` сверять с allowlist имя исполняемого файла из аргументов (правило нормализации уже есть рядом: голое имя без пути), а не окно-цель.
- Приложение не из allowlist в строгом режиме по-прежнему получает deny.
- Тесты в `computerPolicy.test.ts` на оба случая.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При onlyAllowlistedWindows: true запуск приложения из allowlist разрешается политикой (или уходит в ask по классу действия), а не отклоняется с «цель не определена»
- [x] #2 Запуск приложения не из allowlist в строгом режиме отклоняется
- [x] #3 Оба случая покрыты unit-тестами computerPolicy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Причина оказалась шире описания

В аудите `audit/hitl-2026-09.jsonl` у отказов `computer-only-window` заголовок без «→ цель». Значит, отказ пришёл **до** определения окна — из предварительной проверки в `computerUseService.callTool`. Она вызывала полную `evaluateComputerAction` с `target: null, focused: null`, чтобы отсечь жёсткие запреты. В строгом режиме полная политика проверяет окно, и `isTargetAllowlisted(null)` даёт отказ. Поэтому в строгом режиме отклонялось **любое** `act`-действие: и `open_application`, и `computer_type` в диктовке (там в аудите тот же отказ). Unit-тесты этого не ловили, потому что всегда передавали цель.

Вторая причина — та, что описана в задаче. Даже при определённой цели `{ app: 'notepad.exe' }` правило требовало, чтобы активное окно (ProjectHub или терминал) тоже было из allowlist.

## Что сделано ([[decision-36]])
1. `evaluateComputerHardLimits` — жёсткие запреты отдельно: функция выключена, инструмент не классифицирован, kill-switch, Automations и назначенные задачи, Done-loop без label. Предпроверка прокси вызывает только её. `evaluateComputerAction` зовёт её первой, порядок правил прежний.
2. Признак `launchesApp` в `computerToolCatalog` у `open_application` и `activate_app`. В строгом режиме для них с allowlist сверяется цель: приложение из `bundle_id` или его уже открытое окно. Активное окно для них не проверяется.
3. Приложение не из allowlist по-прежнему получает deny, в том числе при `outsideAllowlist: ask`. Путь к exe вместо голого имени не совпадает с записью allowlist. Ввод и клики требуют разрешённых и цели, и активного окна. Роль без auto-approve спрашивает.

ADR [[decision-36]], в decision-27 добавлена ссылка.

## Проверки
- Unit (`computerPolicy.test.ts`):
  - запуск разрешённого приложения при активном ProjectHub — allow (`open_application`, `activate_app`); роль без auto-approve — ask;
  - уже запущенный Блокнот — allow;
  - `mspaint.exe` — deny при `outsideAllowlist` и `deny`, и `ask`; `C:\Temp\notepad.exe` — deny;
  - ввод при неразрешённом активном окне — по-прежнему deny;
  - `evaluateComputerHardLimits` без цели — `null` для `open_application`/`type` и deny для каждого жёсткого запрета.
- 6 файлов computer-тестов, 55 тестов; tsc чисто; eslint 0 ошибок; `pack:win` 21:14.

## Живая проверка
Ожидает разрешения владельца («готов»). План: computerUse включается только на время прогона, `onlyAllowlistedWindows: true`, allowlist `notepad.exe`, `outsideAllowlist: deny`. Сценарий `s12.wav`: «Запусти блокнот и напиши в нём слово тест», затем диктовка. Отдельно — задача «открой Paint», ожидается отказ. После прогона Блокнот закрывается без сохранения, computerUse выключается, голосовой конфиг и язык EN восстанавливаются с проверкой перезапуском.

## Живая проверка (2026-09-18, сборка pack:win 2026-09-17 21:14)

Конфиг на время прогона: `enabled: true`, `onlyAllowlistedWindows: true`, allowlist `notepad.exe`, `outsideAllowlist: deny`. Exe с фейковым микрофоном `s12.wav`, язык интерфейса `ru`, TTS Piper `ru_RU-dmitri-medium`.

**Положительный случай (AC#1).** Whisper: «Запусти блокнот и напиши в нем слово тест.» → «Готово.» на 38,5 с. Затем «включи диктовку» → «Привет из голосовой диктовки!» → «Напечатано: …» на 91,4 с. Новые записи в `audit/hitl-2026-09.jsonl`:
- `computer_open_application` `{bundle_id: notepad.exe}` → `allow`/`auto`, rule `computer-allowlist`, outcome `executed`;
- `computer_type` «тест» (claude-cli) → `allow`, `computer-allowlist`, `executed`;
- два `computer_type` диктовки (engine `api`) → `allow`, `computer-allowlist`, `executed`.

Отказов `computer-only-window` в прогоне нет (0). Текст Блокнота через WM_GETTEXT: `тестПривет из голосовой диктовки!Коронец диктовки.`

**Отрицательный случай (AC#2).** `window.api.runVoiceComputerTask({ task: 'Открой Paint' })` → `computer_open_application` `{bundle_id: mspaint.exe}` → `deny`, rule `computer-only-window`, «Режим «только разрешённые окна»: mspaint.exe не входит в allowlist.» Paint не запускался. Ответ агента: «Не могу — Paint не входит в разрешённый список приложений…»

**Побочное, к TASK-94 не относится.** Whisper-base распознал «Конец диктовки» как «Коронец диктовки.» (как и в прогоне s12c 2026-09-17). Команда выхода из диктовки не сработала, и фраза напечаталась текстом. Это дефект распознавания или сопоставления стоп-фразы, а не политики.

**Уборка.** Блокнот закрыт без сохранения, `computerUse` выключен (`enabled=False`), процессы `computer-use-mcp` остановлены. После `restore.mjs`, паузы 20 с и перезапуска exe без фейкового микрофона `verify-restore.mjs` вернул `{"lang":"en","same":true}`.
<!-- SECTION:NOTES:END -->
