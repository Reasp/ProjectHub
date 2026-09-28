---
id: TASK-106
title: >-
  Экспорт ролей и хуков в Google Antigravity (.agents/agents,
  .agents/hooks.json)
status: Review
assignee: []
created_date: '2026-09-27 04:18'
updated_date: '2026-09-28 04:45'
labels:
  - roles
  - hooks
  - antigravity
dependencies: []
modified_files:
  - electron/services/roleExport.ts
  - electron/services/terminalHookProtocol.ts
  - electron/services/terminalHookScript.ts
  - electron/services/terminalHookService.ts
  - electron/services/roleSyncService.ts
  - electron/services/hitlTypes.ts
  - src/types/electron.d.ts
  - src/components/ai/roles/RoleSyncPanel.tsx
  - src/components/ai/roles/roleSyncView.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/roleExport.test.ts
  - tests/unit/terminalHookProtocol.test.ts
  - tests/unit/terminalHookScript.test.ts
  - tests/unit/terminalHookService.test.ts
  - tests/unit/roleSyncService.test.ts
  - tests/unit/roleSyncView.test.ts
  - infra-dev.md
  - CLAUDE.md
  - AGENTS.md
  - GEMINI.md
  - .agents/rules/infra-dev.md
  - >-
    backlog/decisions/decision-62 -
    Экспорт-ролей-и-хуков-в-Google-Antigravity-fail-closed-движка-и-инструменты-вместо-прав-роли.md
  - >-
    backlog/decisions/decision-54 -
    Экспорт-ролей-в-нативные-субагенты-и-слой-хуков-терминальных-сессий-HITL-аудит-fail-open.md
  - .rag-index
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вынесено из TASK-77 (decision-54, альтернатива 6): полный список имён инструментов Antigravity для tools не опубликован, пустой tools означает «без инструментов», поведение хука при тайм-ауте не описано. Начать с живой проверки в Antigravity (оплачен), затем маппинг категорий и адаптер протокола хуков (toolCall, decision allow/deny/ask).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Живая проверка Antigravity CLI 1.2.12 зафиксирована в ADR: формат hooks.json, вход/выход PreToolUse/PostToolUse/Stop, коды выхода и тайм-аут, cwd и окружение хука, имена инструментов для tools, поведение пустого/отсутствующего tools
- [x] #2 Экспорт ролей в .agents/agents/<name>.md: маркер, name, description, tools по категориям (только проверенные имена), model inherit|flash|pro; роль без tools получает полный список; запрет категорий в правах роли убирает инструменты; роль с чужим engine пропускается
- [x] #3 Хуки Antigravity в .agents/hooks.json под собственным ключом projecthub: чужие ключи не трогаются, снятие удаляет только свой ключ, невалидный JSON — conflict
- [x] #4 Скрипт хуков поддерживает antigravity: событие из аргумента, проект из workspacePaths, никогда не выходит с ненулевым кодом, «без решения» — пустой stdout, отказ — decision deny
- [x] #5 Сервис хуков: политика и HITL для инструментов Antigravity (run_command, write_to_file, replace_file_content, view_file и др.), аудит с длительностью по conversationId:stepIdx, Stop с fullyIdle=false не обрабатывается
- [x] #6 UI синхронизации: цель Antigravity с предупреждением о fail-closed движка, пропуски и индикатор расхождений учитывают Antigravity
- [x] #7 Unit-тесты на экспорт, слияние hooks.json, протокол и сервис; lint 0 ошибок, полный набор тестов зелёный
- [x] #8 Сквозная живая проверка: файлы, сгенерированные ProjectHub, работают в agy -p (субагент, deny политики, fail-open при недоступном ProjectHub)
- [x] #9 ADR decision-62, ссылка из decision-54, правило 21 infra-dev дополнено; index-docs и lint:docs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Живая проверка agy 1.2.12 на стенде C:\Temp\ph-106 с изолированным домом (готово).
2. roleExport.ts: цель antigravity, маппинг категорий в инструменты, модель, слияние .agents/hooks.json под ключом projecthub.
3. terminalHookProtocol.ts: движок antigravity — разбор входа (toolCall, conversationId, stepIdx), маппинг инструментов в политику, формат ответа.
4. terminalHookScript.ts: аргумент события, projectDir из workspacePaths, код выхода всегда 0.
5. terminalHookService.ts, hitlTypes: движок antigravity, событие из тела запроса, fullyIdle.
6. roleSyncService.ts, rolesIpc, типы рендерера, RoleSyncPanel, roleSyncView, i18n.
7. Unit-тесты.
8. Сквозная живая проверка сгенерированных файлов с agy -p и сервисом хуков.
9. ADR decision-62, decision-54, правило 21, index-docs, lint:docs, lint, test, pack:win, UI-проверка.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Живая проверка agy 1.2.12 (2026-09-28), стенд C:\Temp\ph-106 с изолированным домом (USERPROFILE=C:\Temp\ph-106\home; токен CLI берётся из системного хранилища). С настоящим домом agy -p висит: глобальный MCP unreal-mcp не подключается, сборка промпта ждёт MCP — даже после agy mcp disable. Настройки пользователя восстановлены из копий (хэши совпали).
Сквозная проверка C:\Temp\ph-106e\e2e.test.ts: файлы из applyRoleSync + настоящий TerminalHookService за HTTP + agy -p — субагент reader (pelican), deny политики (вне проекта, причина дошла до модели), одобрение человеком → decision allow → файл создан (аудит outcome 112 мс), отказ человека с комментарием, fail-open при остановленном сервере (ECONNREFUSED в логе).

UI в собранном exe (стенд C:\Temp\ph-106ui, обёртка + подмена реестра, отдельный user-data-dir): галочка Antigravity с подсказкой, по умолчанию выключена; предпросмотр .agents/hooks.json сохраняет чужую группу lint и показывает три предупреждения; у ревьюера только инструменты чтения/поиска; синхронизация записала 13 файлов, ручной .agents/agents/mine.md и .agents/mcp_config.json не тронуты; после перезапуска панель сама включает Antigravity по файлам проекта. mtime настоящего реестра не изменился, ошибок консоли нет. Полный набор: 181 файл / 2051 тест; ESLint 0 ошибок / 494 предупреждения (baseline).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Экспорт ролей и хуков ProjectHub в Google Antigravity по живой проверке agy 1.2.12 (decision-62).

- Цель экспорта antigravity: .agents/agents/<name>.md с маркером, tools — только имена, проверенные в реестре agy; роль без категорий получает полный список (без поля Antigravity даёт урезанный набор); запрет категорий в правах роли убирает инструменты (хук не знает имени субагента); model — inherit | flash | pro из явной модели или тира gemini-cli.
- Хуки — собственная группа projecthub в .agents/hooks.json (чужие группы не трогаются, Stop — плоский обработчик), команда node ../.projecthub/hooks/projecthub-hook.mjs antigravity <событие>.
- Протокол и сервис: вход toolCall/conversationId/stepIdx, инструменты приводятся к политике в форме Claude Code (Bash/Write/Edit/Read/Glob/Grep/WebFetch/Agent), ответ {decision}, «без решения» — пустой stdout, код выхода всегда 0 (движок fail-closed: ненулевой код, тайм-аут и даже {} — отказ). HitlEngine antigravity, Stop с fullyIdle=false пропускается.
- UI: галочка Antigravity с предупреждениями, автоопределение по файлам проекта.
- Проверки: unit (+27), полный набор 181/2051, ESLint 0 ошибок/494 предупреждения, сквозная живая проверка с agy -p (субагент, deny политики, allow/deny человека, fail-open), UI в собранном exe, pack:win.
- Не проверено: снимает ли decision allow запрос движка в интерактивной сессии agy.
<!-- SECTION:FINAL_SUMMARY:END -->
