---
id: TASK-82
title: >-
  Управление компьютером (курсор, клавиатура, окна, a11y-дерево) через
  MCP-прокси ProjectHub с HITL, allowlist приложений и kill-switch
status: Done
assignee: []
created_date: '2026-09-15 03:41'
updated_date: '2026-09-16 00:26'
labels:
  - computer-use
  - mcp
  - hitl
  - desktop
  - model-agnostic
milestone: m-0
dependencies: []
references:
  - 'https://github.com/zavora-ai/computer-use-mcp'
  - 'https://github.com/CursorTouch/Windows-MCP'
  - 'https://github.com/sbroenne/mcp-windows'
  - >-
    https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
modified_files:
  - electron/services/computerUseService.ts
  - electron/services/computerPolicy.ts
  - electron/services/computerToolCatalog.ts
  - electron/services/computerCoords.ts
  - electron/services/humanTakeover.ts
  - electron/services/jsonSchemaToZod.ts
  - electron/services/apiToolLoop.ts
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/services/mcpServerService.ts
  - electron/services/agentFleetService.ts
  - electron/services/roleEngineAdapter.ts
  - electron/services/hitlService.ts
  - electron/services/hitlTypes.ts
  - electron/services/contextBuilder.ts
  - electron/ipc/computerUseIpc.ts
  - electron/ipc/index.ts
  - electron/main.ts
  - electron/preload.ts
  - src/components/computer/ComputerUseSettingsModal.tsx
  - src/components/computer/ComputerOverlay.tsx
  - src/components/computer/ComputerControlBanner.tsx
  - src/components/mcp/McpServerStatusBadge.tsx
  - src/components/hitl/HitlCenterModal.tsx
  - src/components/ai/InteractiveApprovalCard.tsx
  - src/App.tsx
  - src/main.tsx
  - src/types/electron.d.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - scripts/computer-use/computer-use-bridge.mjs
  - scripts/setup.mjs
  - scripts/config.mjs
  - infra.config.json
  - infra-dev.md
  - >-
    backlog/decisions/decision-27 -
    Управление-компьютером-через-MCP-прокси-ProjectHub-с-HITL-по-классам-действий.md
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Полное управление компьютером агентом — мышь, клавиатура, окна, буфер обмена, дерево доступности (UI Automation) — как engine- и model-agnostic возможность, доступная любому движку (Claude Code, Codex app-server, Gemini CLI, API-агент) и любой модели, включая локальные без vision (см. [[decision-27]], doc-10 §3).

## Выбор технологии (исследование 2026-09-15)
- **`@zavora-ai/computer-use-mcp`** (MIT, Rust NAPI, npm, Windows x64/arm64, macOS, Linux; v7.4): ~70 инструментов — скриншот и zoom региона, мышь/клавиатура, буфер, окна и фокус, **дерево доступности**, скриптинг (PowerShell/AppleScript), профили `core`/`ax`/`full`; stdio MCP, `npx -y @zavora-ai/computer-use-mcp`. Выбран как рантайм: Node-native, без Python/.NET, кроссплатформенный, есть a11y-дерево для моделей без vision.
- `CursorTouch/Windows-MCP` (MIT, Python 3.13, 7k★, UIA-дерево «работает с любой LLM», DOM-режим для браузеров) — опциональная альтернатива для Windows, если a11y-дерево zavora окажется слабее; тянет Python (как LightRAG — только по флагу).
- `sbroenne/mcp-windows` (MIT, .NET 10, семантический UIA, «−84–96 % токенов») — отклонён: .NET-рантайм, только Windows.
- Anthropic `computer_toolset_20260801` — только Claude API, не доступен в Claude Code/Agent SDK локально; встроенный computer use Claude Code (Vercept, research preview для Pro/Max) — вендорский бонус, не основа.
- Собственная реализация на nut.js/robotjs — отклонена: изобретать рантайм при наличии MIT-готового.

## Архитектура
1. **MCP-прокси в ProjectHub.** `mcpServerService` (уже встроенный HTTP/SSE MCP-сервер, TASK-19/29) спавнит `computer-use-mcp` как дочерний stdio-процесс и ре-экспортирует его инструменты под префиксом `computer_*`. Агенты любого движка подключаются только к ProjectHub — поэтому HITL, аудит и лимиты работают одинаково для всех, независимо от собственной системы разрешений движка.
2. **HITL по классам действий** (decision-10, `hitlPolicy`): `observe` (скриншот, a11y-дерево, позиция курсора, список окон) — авто; `act` (клик, ввод, скролл, фокус окна, буфер) — по политике роли: авто в allowlist приложений/окон, иначе запрос; `dangerous` (PowerShell/скриптинг, файловые диалоги, действия вне allowlist, `hold_key`) — всегда запрос. Каждое действие — в аудит-лог со скриншотом «до/после» (ссылка на трассу TASK-72).
3. **Allowlist приложений/окон** (по имени процесса/заголовку) в настройках проекта и глобально; действия за пределами — запрос или отказ. Режим «только это окно»: прокси отклоняет действия, если активное окно не из списка.
4. **Kill-switch**: глобальная горячая клавиша (Electron `globalShortcut`, по умолчанию `Ctrl+Alt+Esc`) и физическое движение мыши пользователем (>N px за 200 мс, «человек взял управление») мгновенно останавливают сессию и блокируют прокси до ручного снятия; заметный оверлей «Агент управляет компьютером» с кнопкой Стоп (по decision-17, `z-[10000]`).
5. **Доступность вместо пикселей по умолчанию**: в системный промпт (`contextBuilder`) — инструкция сначала читать a11y-дерево и кликать по элементам, скриншот — для проверки результата; так работают модели без vision и экономятся токены. Скриншоты масштабируются (1280×720 / 1366×768 baseline, JPEG), координаты пересчитываются прокси.
6. **Фича шаблона `computerUse`** в `infra.config.json`/`setup.mjs` (по умолчанию выключена) — добавляет прокси-инструменты в `.mcp.json`/`.agents/mcp_config.json`; правило в `infra-dev.md`. В Automations управление компьютером запрещено (TASK-74), в Done-loop — только по явному разрешению задачи.
7. Диагностика: проверка прав (macOS Accessibility, Windows — активная сессия), тест-кнопка «сделать скриншот» в настройках.

## Вне scope
Голосовое управление компьютером (TASK-83), браузерная верификация Playwright (TASK-78), песочница/VM для агента.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Прокси в mcpServerService спавнит @zavora-ai/computer-use-mcp и ре-экспортирует инструменты computer_* (скриншот, zoom, мышь, клавиатура, скролл, окна, буфер, a11y-дерево); работает из Claude Code, API-агента и (при наличии) Codex/Gemini
- [x] #2 Каждый инструмент классифицирован observe/act/dangerous; классификация и политика (allowlist, роль) — чистый модуль с unit-тестами; act/dangerous идут через HITL-очередь и аудит-лог со скриншотами до/после
- [x] #3 Allowlist приложений/окон в настройках; действия вне списка запрашивают подтверждение или отклоняются; режим «только это окно»
- [x] #4 Kill-switch: глобальная горячая клавиша и перехват мыши человеком останавливают сессию и блокируют прокси до ручного снятия; оверлей «Агент управляет компьютером» с кнопкой Стоп виден поверх всех окон
- [ ] #5 Системный промпт предписывает accessibility-first; сценарий «открыть Блокнот, напечатать текст, сохранить файл» проходит на локальной модели без vision и на облачной с vision
- [x] #6 Скриншоты масштабируются прокси (JPEG, baseline 1366×768), координаты пересчитываются обратно; пересчёт покрыт тестами
- [x] #7 Фича шаблона computerUse (по умолчанию выключена) в setup.mjs и обоих MCP-конфигах; правило в infra-dev.md; запрет в Automations
- [x] #8 Диагностика прав и тест-кнопка скриншота в настройках; при недоступном рантайме приложение не падает; i18n ru/en
- [x] #9 decision-27 переведён в accepted; lint/test/check-bundle зелёные, pack:win собран и сценарий с Блокнотом проверен в собранном exe
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Проверка рантайма на практике (2026-09-15, Windows 10 x64, Node 22.16)
- `npx -y @zavora-ai/computer-use-mcp@7.4.0` запускается (~4,5 с до initialize), MCP 2025-06-18, **70 инструментов** с annotations (`readOnlyHint`/`destructiveHint`); профиль по умолчанию `full` (`COMPUTER_USE_PROFILE`: core|ax|scripting|windows-admin|full). Имена: screenshot, zoom, left_click/right_click/double_click/…, mouse_move, left_click_drag, mouse_drag, scroll, type, key, hold_key, read/write_clipboard, open_application, list_windows, get_frontmost_app, activate_window, resize_window, get_ui_tree, find_element, click_element, set_value, press_button, fill_form, select_menu_item, snapshot, run_script, filesystem, process_kill, registry, browser_*, scrape, web_search, spaces и др.
- Проверены только observe-инструменты: doctor (9 pass), get_display_size/list_displays (2 монитора), list_windows (windowId = HWND, bundleId = имя процесса, title, bounds, isFocused), get_frontmost_app, cursor_position, screenshot (`width`, `quality`; ответ содержит формулу `screen_x = image_x * k`, для окна — со смещением и пометкой approximate), get_ui_tree/find_element/snapshot.
- a11y-дерево: нативные окна — полное (Sourcetree: 214 узлов, 143 с label, AXButton/AXTextField/AXComboBox с действиями); Chromium/Electron (VS Code, Chrome, Obsidian) — только каркас, Chromium не включает accessibility без скринридера. Ограничение фиксируется в ADR; браузер — TASK-78.
- Координаты инструментов ввода — логические пиксели экрана; обратный пересчёт со скриншота рантайм не делает → пересчёт в прокси (AC #6).
- У рантайма своя политика (`approval_token`, allowed_apps) и аудит `~/.computer-use-mcp/audit.jsonl` — источником истины не являются; `approval_token` скрывается из схем прокси.
- Найдено в ProjectHub: API-агент (`aiAgentService.streamChat` + `claudeBridgeService.handleApiToolCall`) — один запрос на ход, результаты инструментов модели не возвращаются; OpenAI-совместимый путь (Ollama) без tools. TASK-72 (трасса) и TASK-74 (Automations) — To Do. MCP SDK 1.30 (есть Client/StdioClientTransport), zod 3. Ollama: `qwen2.5:7b-instruct` (без vision, tool calling).
- GitNexus ProjectHub не проиндексирован — impact перед правками проверяется grep'ом.

## План
1. **Чистые модули + unit-тесты** (`electron/services/computerUse/`, `tests/unit/`):
   - `computerToolCatalog.ts` — таблица «имя рантайма → класс observe|act|dangerous, экспорт, аргументы-координаты/цель»; неизвестные новые инструменты не экспортируются (fail-closed), набор сверяется при старте.
   - `computerPolicy.ts` — `evaluateComputerAction` → allow|ask|deny + rule для аудита: observe — авто; act — авто только в allowlist (процесс/заголовок), иначе ask или deny по режиму; режим «только это окно»; dangerous — всегда ask; kill-switch — deny; origin assigned/automation — deny; Done-loop — только с разрешением задачи.
   - `computerCoords.ts` — baseline 1366×768 (вписать с сохранением пропорций, JPEG), разбор формулы из ответа screenshot, пересчёт coordinate/start_coordinate/region/path «скриншот → экран» (`coordinate_space: screenshot|screen`).
   - `humanTakeover.ts` — детектор «человек взял мышь» (> N px за 200 мс вне grace-окна после действия агента).
   - `jsonSchemaToZod.ts` — подмножество JSON Schema рантайма → zod-shape для `McpServer.registerTool`, чтобы схемы в tools/list не деградировали.
2. **`computerUseService.ts`** (main): дочерний stdio-процесс через MCP SDK Client (версия зафиксирована), ленивый старт, перезапуск, деградация без краша; `callTool`: политика → `hitlService.request` (тип `computer_action`) → вызов → скриншоты до/после в `<userData>/audit/computer/<yyyy-mm>/` → `recordOutcome`; kill-switch (`globalShortcut` Ctrl+Alt+Esc + опрос `screen.getCursorScreenPoint`) с блокировкой до ручного снятия; настройки `<userData>/computer-use.json`.
3. **Прокси в `mcpServerService`**: `computer_*` на каждом McpServer при включённой функции; HITL-сессия — `phSession` (AI Studio/Swarm/Done-loop) или `external-<sse>`. В `handleCliPermissionRequest` инструменты `mcp__projecthub-hitl__computer_*` не спрашиваются повторно (политику применяет прокси, правило `computer-proxy`).
4. **HITL-типы**: `HitlRequestType` + `computer_action`, `HitlOrigin` + `external`, ссылки на скриншоты в аудите; зеркала в `src/types/electron.d.ts`; карточка в `InteractiveApprovalCard`/`HitlCenterModal`.
5. **Оверлей**: отдельное always-on-top окно по образцу `voiceOverlayWin` (`#/computer-overlay`) «Агент управляет компьютером» + Стоп; баннер в окне через `createPortal`, `z-[10000]` (decision-17).
6. **contextBuilder**: блок accessibility-first, добавляется, только когда сессии доступны `computer_*`.
7. **Done-loop**: разрешение задачи — label `computer-use`; без него `computer_*` в цикле отклоняются.
8. **UI** в модалке MCP: включение, allowlist, режим, горячая клавиша, статус/снятие блокировки, диагностика (doctor), тест-скриншот; i18n ru/en.
9. **Шаблон**: фича `computerUse` в `setup.mjs` (по умолчанию выкл.) → запись в `.mcp.json` и `.agents/mcp_config.json` через stdio-мост `scripts/computer-use/computer-use-bridge.mjs` → SSE ProjectHub (токен из `PROJECTHUB_MCP_TOKEN`, в конфиг не пишется); правило в `infra-dev.md` + `sync-rules`.
10. **API-агент**: ОТКРЫТЫЙ ВОПРОС к пользователю — tool-loop для API/OpenAI-совместимых провайдеров (пересечение с TASK-70).
11. **Проверки**: observe — сделано; act (Блокнот, kill-switch) — только после явного подтверждения пользователя; AC #5: локальная — `qwen2.5:7b-instruct` (Ollama, без vision), облачная с vision — Claude Code CLI через прокси.
12. decision-27 → accepted с уточнениями (или новый ADR), index-docs, lint:docs, lint, test, check-bundle, pack:win; задача → Review.

## Решение по п. 10 (пользователь, 2026-09-15)
Tool-loop делается в TASK-82: многошаговый цикл API-агента (результаты инструментов возвращаются модели до финального ответа, лимит шагов) и tool calling для OpenAI-совместимых провайдеров (Ollama/OpenRouter/DeepSeek/custom: `tools` + `delta.tool_calls`) — в объёме, нужном для `computer_*` и существующих инструментов. TASK-70 потом расширяет (каталог моделей, capability-флаги). AC #1 «API-агент» и AC #5 проверяются в приложении.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Прогресс 2026-09-15
- Чистые модули + unit-тесты: `computerToolCatalog.ts` (классификация 70 инструментов рантайма 7.4, fail-closed сверка), `computerPolicy.ts` (verdict allow/ask/deny, allowlist, «только разрешённые окна», файловые диалоги → dangerous, запреты automation/assigned, Done-loop по label `computer-use`, определение цели по list_windows, настройки), `computerCoords.ts` (baseline 1366×768, разбор формулы рантайма, пересчёт `coordinate_space: "screenshot"`), `humanTakeover.ts`, `jsonSchemaToZod.ts`, `apiToolLoop.ts`. 741 тест зелёный.
- Решение по координатам (уточнение decision-27 п. 5): по умолчанию `coordinate_space: "screen"` как у рантайма и bounds a11y-дерева; пересчёт только при явном `"screenshot"`, формула рантайма в ответе заменяется текстом прокси — иначе vision-модель, умножившая сама, получала бы двойной пересчёт.
- `computerUseService.ts`: рантайм через MCP SDK Client + stdio (`npx -y @zavora-ai/computer-use-mcp@7.4.0`, tree-kill), политика → HITL (`computer_action`) → скриншоты до/после в `<userData>/audit/computer/<yyyy-mm>/` → `recordOutcome`; действия act/dangerous сериализованы; kill-switch (`Control+Alt+Escape`, перехват мыши только во время действия и 3 с после, кнопка Стоп) убивает рантайм, отменяет карточки, прерывает сессии AI Studio, блокирует до ручного снятия.
- Прокси в `mcpServerService` (регистрация `computer_*` на каждое SSE-подключение, list_changed при смене набора); `claudeBridgeService`: контекст CLI-сессий, без повторного permission_prompt для `mcp__projecthub-hitl__computer_*`, инструкция accessibility-first в `--append-system-prompt`; tool-loop API-агента (`aiAgentService.streamChat` с `executeTool`, OpenAI tools + `delta.tool_calls`), `read_file`/`list_dir`/`search_rag` теперь реально возвращают результат. Done-loop: флаги в meta (`agentFleetService`).
- UI: модалка настроек (бейдж MCP → «Управление компьютером…»), окно-оверлей поверх всех окон (`#/computer-overlay`), баннер `z-[10000]`; i18n ru/en. Фича шаблона `computerUse` (setup.mjs, stdio-мост `scripts/computer-use/computer-use-bridge.mjs`, токен из `PROJECTHUB_MCP_TOKEN`), правило 20 в infra-dev.md.
- Impact перед правками общих сервисов (hitlService, claudeBridgeService, aiAgentService, mcpServerService) проверялся grep'ом — GitNexus ProjectHub не проиндексирован.
- Проверено в изолированном экземпляре (свои userData и USERPROFILE, порт 42043) внешним MCP-клиентом, только observe: 61 инструмент экспортирован, approval_token скрыт, get_frontmost_app 19 мс, list_windows, screenshot (JPEG, текст прокси), find_element в Sourcetree, zoom с coordinate_space=screenshot; left_click вне allowlist → deny без карточки (аудит `computer-outside-allowlist`); run_script → карточка HITL origin=external → отклонено через projecthub_approve_action (аудит decidedBy=mcp). Реальных действий мышью/клавиатурой не выполнялось.

## Проверки сценария «Блокнот» (2026-09-15, с разрешения пользователя; HITL одобрялся через MCP фильтром «только notepad.exe»)
- **Claude Code (внешний CLI, claude-opus-5, vision) через stdio-мост фичи computerUse — ПРОЙДЕН**: open_application (прокси запустил notepad.exe, вернул window_id) → get_ui_tree → set_value «Text Editor» → ctrl+s → press_button OK (ошибка «Location is not available» — артефакт изолированного USERPROFILE) → set_value «File name:» → press_button «Save»; действия в «Save As» повышены до dangerous и прошли через карточки, остальное — авто по allowlist. Файл сохранён с верным текстом, 18 ходов, $1.12.
- **API-агент ProjectHub + Ollama qwen2.5:7b-instruct (без vision) — НЕ ПРОЙДЕН**: tool-loop работает (модель вызвала все шаги, результаты возвращены модели), но модель выдаёт все вызовы одним ответом и не проверяет состояние: путь напечатан до появления диалога Save As, файл не сохранён; финальный ответ на китайском. Приоритет пользователя: сначала Claude Code, другие провайдеры вторичны.
- Найдено и исправлено по ходу: (1) рантайм 7.4 на Windows не запускает приложения (`open_application` = только activateApp, отвечает «Opened … (activated: false)») — прокси запускает сам по голому имени `*.exe` (`isLaunchableAppName`) и ждёт окно до 8 с; (2) глобальный auto-approve AI Studio отключал allowlist — теперь сужает только `permissions.autoApprove` роли; (3) unit-тесты писали в реальный ~/.projecthub/secrets.enc.json — вынесено в TASK-84 (изоляция home в vitest).

- **Claude CLI внутри AI Studio (изолированный экземпляр, `mcp__projecthub-hitl__computer_*` с phSession) — ПРОЙДЕН**: open_application → set_value → ctrl+s → OK → set_value «File name:» → Save; аудит origin=studio engine=claude-cli, действия в notepad — auto `computer-allowlist`, в Save As — карточки (одобрены через MCP); попытка проверить файл PowerShell — карточка единого HITL, отклонена, агент не обходил. Файл сохранён с верным текстом, 17 шагов.
- Найдено и исправлено: Claude CLI запускается с `shell: true`, cmd.exe обрезает командную строку на переводе строки — многострочный `--append-system-prompt` терял последующие флаги (в AI Studio — --mcp-config/--permission-prompt-tool/--output-format, пустой ответ; в Swarm/Done-loop — обрезанный промпт роли и инструкция цикла, потеря --model/--allowedTools/--max-budget-usd, дефект с TASK-60/64). Теперь текст передаётся файлом `--append-system-prompt-file` (claudeBridgeService, agentFleetService + `extractAppendSystemPrompt` в roleEngineAdapter). Swarm/Done-loop на реальном CLI после исправления не прогонялся (квота Claude Code у пользователя 85%).
- Kill-switch с реальным вводом (горячая клавиша, перехват мыши) не проверялся — пользователь это не разрешил; детектор покрыт unit-тестами, оверлей и баннер видны на скриншотах аудита.

- Модалка «Управление компьютером» проверена в изолированном приложении (Playwright, только клики внутри окна): рантайм ready, 61 инструмент/9 скрыто; «Проверить права и рантайм» — 9 passed/0 warned/0 failed; «Тестовый скриншот» — изображение отрисовано; kill-switch кнопкой «Стоп» → «Kill switch triggered (stopped manually)» в модалке и баннере → «Снять блокировку» снимает.

## Проверки 2026-09-16 (продолжение)
- **AC #4 — пройден реальным вводом** (изолированный экземпляр, порт 42044; 42042/42043 заняты экземплярами пользователя, поэтому порт в скриптах определяется перебором, а чужие отсекаются 401). Синтетическое нажатие `Ctrl+Alt+Esc` вторым, прямым процессом рантайма → `KILL-SWITCH (hotkey)`; резкие движения курсора тем же способом во время печати → `KILL-SWITCH (human-takeover)`, сессия `external-…`. После срабатывания и observe, и act отвечают «Сработал kill-switch… до ручного снятия», приложение живо. Electron `globalShortcut` срабатывает и на синтетический ввод, не только на физический. Оговорка: печать (короткое действие) успела завершиться, блокировка наступила в окне «3 с после действия» — decision-27 п. 7.
- **AC #8 — пройден** (экземпляр без node/npx в PATH, Playwright): модалка показывает «Не найден npx (нужен Node.js ≥ 20 в PATH): MCP error -32000: Connection closed | 'npx' is not recognized as an internal or external command» — доработка со stderr рантайма даёт первопричину вместо невнятного «Connection closed». «Проверить права и рантайм» и «Тестовый скриншот» возвращают ту же ошибку и не роняют приложение. i18n: обёртка `runtimeUnavailable` есть в ru и en, текст ошибки main-процесса — русский (конвенция всей кодовой базы, ср. `agentFleetService`); в английском UI видно смешение — известное ограничение, не дефект TASK-82.
- **AC #9 — пройден**: `pack:win` выполнен при закрытом приложении — впервые без EBUSY, иконка вшита в PE-ресурсы, `ProjectHub.exe` и `app.asar` обновлены. Сценарий «Блокнот» пройден в `release/win-unpacked/ProjectHub.exe` на Claude CLI: 12 действий, дерево доступности, файл сохранён (`notepad-exe.txt`, текст верный, заголовок окна «notepad-exe.txt - Notepad»). Аудит в реальном userData: действия в Блокноте — авто `computer-allowlist` (`decidedBy: auto`), действия в «Save As» — карточки `computer_action` («Опасное действие на компьютере: computer_set_value / computer_press_button → notepad.exe «Save As»»).
- **AC #5 — не пройден** на `qwen2.5:7b-instruct` (две попытки, вторая — с промптом, где перечислены пять разрешённых инструментов и запрещены остальные): модель вызывает несуществующие цели (`com.example.myapp`, `com.microsoft.WindowsNotepad`) и батч-инструмент `computer_multi_edit` вместо названных, упирается в лимит шагов 25. Причина — следование инструкциям у 7B-модели, а не поведение прокси: каждый такой вызов корректно уходил в HITL и отклонялся (побочное подтверждение AC #2/#3 на плохо себя ведущей модели). Дальнейшие попытки на этой модели прекращены.
- **AC #1 — закрыть нельзя**: Codex/Gemini на машине не установлены; API-агент сценарий не проходит (см. AC #5).
- Найдено: **детектор перехвата мыши несовместим с одобрением карточек кликами автоматизации** — первый прогон в exe оборвался на «Kill switch triggered (human grabbed the mouse)», потому что клики Playwright двигают системный курсор и детектор верно счёл их перехватом. Повтор — с временно выключенным `takeoverDetection` (сам детектор проверен отдельно, реальным вводом). Зафиксировано в decision-27 п. 12.
- **Открытый вопрос для следующей сессии**: карточки «Save As» в exe одобрены с `decidedBy: local` («Пользователь в окне ProjectHub»), хотя UI-одобритель прогона не зафиксировал ни одного клика. `sendApprovalResponse` вызывается только из IPC/UI, авто-ответ моста касается `permission_prompt`, а не `computer_action`. Либо клик не залогирован драйвером, либо решение сформировано с дефолтным `source = { kind: 'local' }`. Проверить: автоматическое решение не должно помечаться в аудите как пользовательское.
- Реальное окружение пользователя возвращено в исходное состояние: `computer-use.json` и `computer-use-tools.json` удалены (их там не было), `ai-config.json` не менялся (sha256 2b46f9bf…), `secrets.enc.json` не трогался, приложение запущено обратно. Записи аудита прогона в `<userData>/audit/` оставлены как штатный журнал.
- Проверки: lint — 0 ошибок / 503 предупреждения (baseline), 752 теста в 75 файлах, tsc, check-bundle, pack:win, lint:docs (117 файлов), index-docs (39 файлов, 361 чанк).

## Закрытие задачи (2026-09-16, решение пользователя)
Задача закрыта с двумя неотмеченными критериями — это осознанное решение, а не пропуск: отладка управления компьютером на движках и моделях, отличных от Claude Code, делается отдельно (приоритет: сначала Claude Code).
- **AC #1** (Codex/Gemini на машине не установлены) и **AC #5** (локальная `qwen2.5:7b-instruct` сценарий не проходит) вынесены в **TASK-85** со всеми деталями двух попыток и направлениями для следующей сессии. Сторона ProjectHub по этим критериям работает: прокси, tool-loop и политика корректно отрабатывали даже на модели, которая галлюцинировала инструменты и цели.
- Открытый вопрос про `decidedBy: local` без подтверждённого клика вынесен в **TASK-86** (bug, аудит HITL).
- Записи аудита прогонов в `<userData>/audit/` сохранены по решению пользователя — результаты аудита не чистим.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Итог TASK-82 (2026-09-15)

Управление компьютером через MCP-прокси ProjectHub реализовано по decision-27 (переведён в accepted, раздел «Реализация и уточнения»). Рантайм `@zavora-ai/computer-use-mcp@7.4.0` проверен на практике.

### Сделано
- **Прокси** (`computerUseService` + `mcpServerService`): 61 инструмент `computer_*` в каждом SSE-подключении. Внутри вызова: политика → HITL `computer_action` → скриншоты «до/после» → аудит. Действия идут строго последовательно, рантайм при сбое деградирует без краша.
- **Чистые модули с тестами:** `computerToolCatalog` (классы действий, fail-closed), `computerPolicy` (allowlist, «только разрешённые окна», файловые диалоги → dangerous, запреты для automation/assigned, Done-loop по label `computer-use`, определение цели), `computerCoords` (baseline 1366×768, `coordinate_space`), `humanTakeover`, `jsonSchemaToZod`, `apiToolLoop`.
- **Kill-switch:** горячая клавиша `Control+Alt+Escape`, кнопки «Стоп» в окне-оверлее поверх всех окон и в баннере `z-[10000]`, перехват мыши. Срабатывание блокирует прокси до ручного снятия.
- **Claude Code:** инструкция accessibility-first в CLI; нет двойного permission_prompt для `computer_*`. Stdio-мост фичи шаблона `computerUse` (setup.mjs, оба MCP-конфига, правило 20 в infra-dev.md).
- **API-агент:** многошаговый tool-loop и tool calling для OpenAI-совместимых провайдеров; `read_file`/`list_dir`/`search_rag` теперь возвращают результат.
- **UI:** модалка настроек (allowlist, режимы, kill-switch, диагностика `doctor`, тестовый скриншот), i18n ru/en.

### Найдено и исправлено по ходу
- Рантайм на Windows не запускает приложения: прокси запускает `*.exe` сам и ждёт окно.
- Глобальный auto-approve отключал allowlist.
- Claude CLI (`shell: true`) обрезал многострочный `--append-system-prompt`: теперь `--append-system-prompt-file` в AI Studio и Swarm/Done-loop.
- Unit-тесты перезаписывали реальный `~/.projecthub/secrets.enc.json`: TASK-84, decision-29.

### Проверки
- lint (0 ошибок), 749/749 тестов, tsc, check-bundle, lint:docs, index-docs.
- Сценарий «Блокнот» в изолированном экземпляре (`node_modules/electron`; свои userData и USERPROFILE; HITL одобрялся через MCP фильтром «только notepad.exe»):
  - **пройден** — Claude Code в терминале через мост;
  - **пройден** — Claude CLI в AI Studio;
  - **не пройден** — API-агент на Ollama qwen2.5:7b-instruct (все вызовы одним ответом, не дожидается диалога «Save As»).
- Модалка настроек: диагностика 9/9, тестовый скриншот, «Стоп» и снятие блокировки.

### Не проверено / открыто
- #1: Codex/Gemini отсутствуют на машине; API-агент не прошёл сценарий.
- #4: горячая клавиша и перехват мыши реальным вводом не проверялись (не разрешено).
- #5: локальная модель без vision сценарий не прошла.
- #8: поведение при недоступном рантайме (нет npx) вживую не проверялось.
- #9: `pack:win` собран, но `release/win-unpacked` обновился частично (запущен ProjectHub.exe); сценарий проверен через `node_modules/electron`, не в exe. Swarm/Done-loop на реальном CLI после исправления промпта не прогонялся (квота Claude Code 85%).
- Chromium/Electron-окна отдают только каркас дерева доступности (браузер — TASK-78).

## Дополнение 2026-09-16
Закрыты **AC #4** (kill-switch проверен реальным вводом: синтетическая горячая клавиша `Ctrl+Alt+Esc` и перехват мыши отдельным процессом рантайма — оба блокируют прокси до ручного снятия), **AC #8** (при недоступном рантайме приложение работает, видна причина «Не найден npx (нужен Node.js ≥ 20 в PATH)» вместе со stderr рантайма) и **AC #9** (чистый `pack:win` без EBUSY при закрытом приложении + сценарий «Блокнот» пройден в собранном `release/win-unpacked/ProjectHub.exe` на Claude CLI: 12 действий, файл сохранён, действия в «Save As» прошли через карточки HITL).

Остаются открытыми **AC #1** (Codex/Gemini на машине не установлены) и **AC #5** (локальная `qwen2.5:7b-instruct` сценарий не проходит: галлюцинирует цели и батч-инструмент `multi_edit`, упирается в лимит шагов; прокси при этом корректно отклоняет такие вызовы). Отдельный открытый вопрос — `decidedBy: local` у карточек, одобренных без зафиксированного клика.

Реальное окружение пользователя возвращено в исходное состояние; правки в decision-27 (п. 12 и раздел проверок) проиндексированы.

## Закрытие (2026-09-16)
Задача переведена в Done по решению пользователя. Семь критериев из девяти закрыты (#2, #3, #4, #6, #7, #8, #9). Оставшиеся #1 и #5 касаются исключительно чужих движков и моделей (Codex/Gemini отсутствуют на машине; локальная 7B-модель не следует инструкциям) и вынесены в **TASK-85**; найденный вопрос достоверности аудита — в **TASK-86**.
<!-- SECTION:FINAL_SUMMARY:END -->
