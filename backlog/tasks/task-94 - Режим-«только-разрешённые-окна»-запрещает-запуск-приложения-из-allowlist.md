---
id: TASK-94
title: Режим «только разрешённые окна» запрещает запуск приложения из allowlist
status: To Do
assignee: []
created_date: '2026-09-17 12:35'
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
- [ ] #1 При onlyAllowlistedWindows: true запуск приложения из allowlist разрешается политикой (или уходит в ask по классу действия), а не отклоняется с «цель не определена»
- [ ] #2 Запуск приложения не из allowlist в строгом режиме отклоняется
- [ ] #3 Оба случая покрыты unit-тестами computerPolicy
<!-- AC:END -->
