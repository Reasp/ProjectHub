---
id: decision-62
title: "Экспорт ролей и хуков в Google Antigravity: fail-closed движка и инструменты вместо прав роли"
date: "2026-09-28 12:40"
status: accepted
section: "Агенты/Роли и скиллы"
---
## Context

[[decision-54]] экспортирует роли ProjectHub в субагенты Claude Code и Codex и ведёт вызовы инструментов терминальных
сессий через хуки в политику, очередь HITL и аудит. Antigravity отложили (альтернатива 6 в decision-54): полного списка
имён инструментов не было, пустой `tools` означал «без инструментов», поведение хука при тайм-ауте и ненулевом коде
выхода не было описано. Antigravity у нас оплачен, поэтому решение принимали по живой проверке, а не по документации.

**Как проверяли.** Antigravity CLI `agy` обновлён с 1.0.1 до 1.2.12 (поиск агентов `.agents/agents` в `agy -p`
исправлен только в 1.2.11). Стенд — `C:\Temp\ph-106`. Зонд-хук пишет вход, аргументы, рабочий каталог и окружение, а
ответ берёт из управляющего файла. `agy` запускался с изолированным домом (`USERPROFILE` стенда): токен CLI лежит в
системном хранилище учётных данных, а с настоящим домом `agy -p` висел — сборка промпта ждала глобальный MCP-сервер,
который не подключается, даже после `agy mcp disable`. Настройки пользователя не менялись (временное выключение
сервера откатили из копии). Интерактивный режим проверить не удалось: в изолированном доме он требует принять условия
Google и согласие на сбор данных, этого за пользователя не делали. Модель — Gemini 3.6 Flash (Low).

**Факты (agy 1.2.12, Windows 10):**

- `.agents/hooks.json`: корень — **именованные группы** (`{ "<имя>": { "enabled"?, "PreToolUse": [...], ... } }`),
  группы из разных источников сосуществуют. `PreToolUse`/`PostToolUse` — `[{ matcher, hooks: [{ type: "command",
  command, timeout }] }]`, matcher — регулярное выражение по имени инструмента. `Stop` — **плоский** обработчик
  `[{ type, command, timeout }]`: вложенную форму `agy` читает без команды. `agy -p "/hooks" --output-format json`
  показывает разобранные хуки без затрат квоты. Хуки загружаются только в доверенном каталоге (`trustedWorkspaces`).
- Хук запускается через `cmd /C` в каталоге **`<проект>/.agents`**; относительный путь `node ../x.mjs` работает.
  Окружение родителя передаётся целиком плюс `ANTIGRAVITY_CONVERSATION_ID`; переменной с каталогом проекта нет.
- Вход общий для событий: `conversationId`, `workspacePaths` (прямые слэши), `transcriptPath`, `artifactDirectoryPath`,
  `modelName`. **Имени события во входе нет.** PreToolUse: `toolCall { name, args }`, `stepIdx`. PostToolUse — то же
  плюс `error` (пустая строка при успехе), результата и длительности нет; `stepIdx` совпадает с PreToolUse того же
  вызова. Stop: `executionNum`, `fullyIdle`, `terminationReason`, `error`.
- Ответ PreToolUse:
  - `{ "decision": "deny", "reason": "…" }` — модель видит `tool call denied by pre-tool hook: <reason>`;
  - **пустой stdout с кодом 0 — без решения** (дальше собственная проверка прав движка);
  - **`{}` — отказ** с пустой причиной;
  - **любой ненулевой код выхода (1, 2) — отказ** (`JSON hook … failed: exit status N, stderr: …`);
  - **тайм-аут — отказ**: хук с `timeout: 20` сняли через ~21 с, файл не создан.

  Движок **fail-closed** — в отличие от Claude Code, который по тайм-ауту выполняет инструмент.
- `allow` (даже с `permissionOverrides`) в `agy -p` **не выдаёт** разрешение движка: `run_command` всё равно
  автоотклонён («headless mode cannot prompt»). Запись файла в рабочем каталоге после `allow` выполнилась. Снимает ли
  `allow` запрос движка в интерактивной сессии — не проверено (см. выше); по документации `allow` — «выполнить
  автоматически».
- Субагент (`invoke_subagent`, `args.Subagents[].TypeName`) работает в **своём `conversationId`**, имени агента в его
  вызовах хука нет. Тип субагента хранится только во внутренней protobuf-базе разговора — стабильного способа связать
  вызов с ролью нет.
- `tools` субагента:
  - принимаются `view_file`, `list_dir`, `grep_search`, `find_by_name`, `write_to_file`, `replace_file_content`,
    `multi_replace_file_content`, `run_command`, `search_web`, `read_url_content`, `invoke_subagent`,
    `manage_subagents`, `ask_question` (первые четыре — проверка субагентом, `multi_replace_file_content` принят без
    ошибки, но в CLI не выдаётся; остальные — из списка инструментов основного агента);
  - **неизвестное имя (`Bash`) не даёт субагенту запуститься**: `unknown component: tool "Bash" not found in registry`;
  - `tools: []` — только служебные `send_message` и `manage_task`;
  - **без поля `tools`** — урезанный набор по умолчанию (`view_file`, `read_url_content`, `search_web`, `schedule`,
    `generate_image` и служебные), без записи и команд, то есть не «все инструменты»;
  - `model: flash` дал `gemini-3.8-flash-tiered`; допустимы только `inherit | flash | pro`;
  - строка-комментарий `# projecthub:generated …` во frontmatter не мешает.

Рассмотренные альтернативы:

1. **Роль субагента по корреляции** (запомнить `TypeName` из `invoke_subagent` родителя и сопоставить с первым вызовом
   нового `conversationId` или с первой строкой его транскрипта). Отвергнуто: при параллельных субагентах сопоставление
   гадательное, а транскрипт — внутренний формат движка. Ошибка сопоставления дала бы субагенту чужие права.
2. **Выражать права роли через хук, как у Claude Code** («запрет категории — спросить человека»). Невозможно без имени
   субагента (см. п. 1).
3. **Не писать `tools` у роли без категорий** (как у Claude Code — «наследовать»). Отвергнуто: без поля Antigravity
   выдаёт урезанный набор без записи и команд, роль молча потеряла бы права.
4. **Хуки Antigravity без отдельного предупреждения**, как у Claude Code. Отвергнуто: у Claude Code сбой хука не мешает
   работе, у Antigravity отклоняет каждый вызов инструмента в проекте.
5. **Отдельная группа хуков в `.agents/hooks.json` для каждого события или слияние в чужие группы.** Отвергнуто:
   группа — единица владения, ProjectHub владеет ровно одной (`projecthub`).

## Decision

1. **Цель экспорта `antigravity`** рядом с `claude` и `codex` ([[decision-54]] п. 1): файл
   `.agents/agents/<name>.md` (имя — slug роли с `_` → `-`), маркер `# projecthub:generated role=<slug> hash=…` сразу
   после `---`, поля `name`, `description` (как у Claude Code), `tools`, `model`; тело — системный промпт роли.
   `mainAgent`/`subagent` не пишутся (по умолчанию `true`: роль доступна и как субагент, и как основной агент через
   `--agent`). Идемпотентность, конфликты, orphan и чужие файлы — по `planFileWrite` decision-54 п. 2; агенты без
   маркера (в том числе форма `<name>/agent.md`) не трогаются.
2. **Инструменты.** `ANTIGRAVITY_TOOLS_BY_CATEGORY` содержит только имена, проверенные в реестре 1.2.12:
   read → `view_file`, `list_dir`, `grep_search`, `find_by_name`; write → `write_to_file`, `replace_file_content`,
   `multi_replace_file_content`; command → `run_command`; search → `search_web`, `read_url_content`;
   subagent → `invoke_subagent`, `manage_subagents`; question → `ask_question`. `define_subagent` (создать агента на
   лету) не выдаётся. Роль без категорий получает весь список (альтернатива 3).
3. **Права роли убирают инструменты.** Хук не знает, какой субагент сделал вызов, поэтому `permissions.allowFileRead |
   allowFileWrite | allowCommands | allowSubagents: false` удаляет категорию из `tools` субагента, а не отправляет
   вызов человеку, как у Claude Code. Предпросмотр пишет, какие категории убраны. Вызовы субагентов Antigravity
   проверяются общей политикой AI Studio без роли, в аудите — `agentName: "Antigravity"`.
4. **Модель.** Явная модель роли, если она выражается алиасом (`inherit | flash | pro` или id `gemini-…-pro…` /
   `gemini-…-flash…`); иначе первое звено тира роли для движка `gemini-cli` ([[decision-44]]), если оно выражается;
   иначе `inherit` с заметкой. Вендорских дефолтов нет ([[decision-26]] п. 0). Роль с любым `engine` в Antigravity не
   экспортируется (в ролях нет движка Antigravity) — «пропущено: роль привязана к движку X».
5. **Хуки — группа `projecthub` в `.agents/hooks.json`.** ProjectHub владеет только ею: чужие группы и ключи
   сохраняются, снятие хуков удаляет только её, невалидный JSON — `conflict` без изменения файла. События:
   `PreToolUse` и `PostToolUse` (matcher `*`), `Stop` (плоский обработчик). Команда —
   `node ../.projecthub/hooks/projecthub-hook.mjs antigravity <событие> --budget <с>`: путь от `.agents/`, без кавычек
   (`cmd /C`), имя события аргументом. `timeout` — из настроек хуков (decision-54 п. 9). Хуки устанавливаются только
   вместе с целью `antigravity`.
6. **Протокол** (`terminalHookProtocol.ts`, движок `antigravity`):
   - событие приходит полем `event` тела запроса;
   - сессия — `conversationId`;
   - `toolUseId` — `conversationId:stepIdx` (длительность в аудите считается по нему);
   - провал PostToolUse — непустой `error`;
   - `stopHookActive` — `executionNum > 0`;
   - Stop с `fullyIdle: false` (разговор ждёт своих субагентов) не даёт ни уведомления, ни проверок.

   Инструменты приводятся к именам и входу политики в форме Claude Code: `run_command` → `Bash`, `write_to_file` →
   `Write`, `replace_file_content`/`multi_replace_file_content` → `Edit` со «было/стало», `view_file` → `Read`,
   `list_dir`/`find_by_name` → `Glob`, `grep_search` → `Grep`, `read_url_content` → `WebFetch`, `search_web` →
   `WebSearch`, `invoke_subagent` → `Agent`, `ask_question` → `AskUserQuestion` (без решения). Так политика, дифф и
   карточка HITL общие для всех движков.

   Ответ: без решения — пустой stdout; `deny` → `{decision: "deny", reason}`; одобрение человека →
   `{decision: "allow", reason}`; Stop `block` → `{decision: "continue", reason}`; **код выхода всегда 0**.
7. **Скрипт хуков** (`terminalHookScript.ts`) понимает `antigravity <событие>`. Каталог проекта берётся из
   `workspacePaths[0]`, иначе это родитель рабочего каталога (`.agents/`). Для Antigravity скрипт всегда выходит с
   кодом 0, в том числе при непредвиденной ошибке: она обрабатывается как недоступный ProjectHub. Fail-open —
   пустой вывод, fail-closed и «нет решения в срок» — JSON-отказ. Бюджет ответа — за 15 с до `timeout`, как в
   decision-54 п. 5; по тайм-ауту движок и так отказал бы.
8. **Предупреждения в UI.** У цели Antigravity в «Синхронизации в проект» есть подсказка. В предпросмотре
   `.agents/hooks.json` три заметки:
   - сбой хука (нет Node.js, удалён скрипт) отклоняет все вызовы инструментов в проекте;
   - хуки работают только в доверенном каталоге;
   - одобрение в ProjectHub не выдаёт разрешение движка в `agy -p`.

   По умолчанию Antigravity не включается — только явно или если в проекте уже есть сгенерированные файлы.
9. **HITL-движок `antigravity`** добавлен в `HitlEngine`: аудит и Центр решений различают терминальные сессии
   Antigravity.

## Consequences

- Плюс: роли ProjectHub доступны в Antigravity как субагенты и как основные агенты; действия агента Antigravity в
  терминале проходят ту же политику, очередь HITL (телефон, Telegram) и аудит с длительностью, что Claude Code.
- Плюс: сквозная проверка на настоящем `agy -p` с файлами, сгенерированными `applyRoleSync`, и настоящим
  `TerminalHookService` за HTTP прошла:
  - субагент `reader` прочитал файл;
  - отказ политики (запись вне проекта) дошёл до модели с причиной;
  - одобрение человека → запись выполнена, `outcome` с длительностью;
  - отказ человека с комментарием дошёл до модели;
  - при остановленном ProjectHub работа не заблокирована, в логе хука `ECONNREFUSED`.
- Минус: движок fail-closed — сломанный хук блокирует агента целиком. Отсюда код выхода 0 при любой ошибке скрипта
  и явные предупреждения; зависимость от Node.js на машине остаётся.
- Минус: права роли у субагента Antigravity жёстче, чем у Claude Code: категория убирается, а не спрашивается у
  человека; роль субагента в аудите не видна.
- Долг: в интерактивной сессии не проверено, снимает ли `decision: allow` собственный запрос движка (возможно двойное
  подтверждение); `.agents/agents/<name>/agent.md` и глобальные агенты `~/.gemini/config/agents` не синхронизируются;
  MCP-инструменты (`mcp_<сервер>_<инструмент>` или `call_mcp_tool` по сообщениям сообщества) идут правилом `auto-other`.
- Экспорт в Antigravity и его хуки проверены на agy 1.2.12; формат движка ещё меняется (в 1.2.4 хуки проекта не
  загружались вовсе), при обновлениях `agy` проверку стоит повторять стендом из TASK-106.
- Реализация: TASK-106. Связано: [[decision-54]], [[decision-10]], [[decision-44]], [[decision-26]].
