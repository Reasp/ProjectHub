---
id: TASK-84
title: >-
  Unit-тесты пишут в реальный ~/.projecthub (secrets.enc.json) — изоляция
  домашнего каталога в vitest
status: Review
assignee: []
created_date: '2026-09-15 13:08'
updated_date: '2026-09-15 14:06'
labels:
  - tests
  - security
  - secrets
dependencies: []
references:
  - tests/unit/remoteControlAuth.test.ts
  - tests/unit/mcpServerAuth.test.ts
  - electron/services/secretStorageService.ts
  - vitest.config.ts
modified_files:
  - vitest.config.ts
  - tests/setup/testHomeGlobalSetup.ts
  - tests/unit/testHomeIsolation.test.ts
  - backlog/decisions/decision-29 - Изоляция-домашнего-каталога-в-unit-тестах.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обнаружено в TASK-82 (2026-09-15). Тесты `remoteControlAuth.test.ts` и `mcpServerAuth.test.ts` мокают только модуль `electron`, но используют настоящий `secretStorageService`, который пишет в `os.homedir()/.projecthub/secrets.enc.json`. Каждый `npm test` / `npm run build` / `npm run pack:win` перезаписывал файл секретов пользователя тестовыми данными (`remoteControl.deviceTokens`, `remoteControl.identityPrivateKey` без шифрования); параллельные воркеры vitest оставляли в файле невалидный JSON. Прежние секреты пользователя (токен MCP, ключи Remote Control и т.п.) потеряны и восстановлению не подлежат. Тем же путём тесты могли создавать `~/.projecthub/claude_config`, `ai-config.json`, `sessions/`.

## Исправление (decision-29)
- `vitest.config.ts`: один временный каталог `projecthub-test-home-*` на прогон, `USERPROFILE`/`HOME` через `test.env` с самого старта воркеров; `tests/setup/testHomeGlobalSetup.ts` удаляет его в teardown. Вариант `setupFiles` со сменой переменных при загрузке воркера отвергнут — vitest 5 не находит runner, все файлы падают.
- Тест-страж `tests/unit/testHomeIsolation.test.ts`: домашний каталог в тестах — временный, `secretStorageService` пишет в него.

## Пользователю
После исправления: перегенерировать токен MCP (внешние `.mcp.json` с токеном обновить), перепривязать устройства Remote Control, заново ввести секреты, хранившиеся в `secrets.enc.json` (Telegram и др.).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Во время vitest os.homedir() указывает во временный каталог; реальный ~/.projecthub не создаётся и не изменяется
- [x] #2 Тест-страж проверяет изоляцию и падает, если setup не подключён
- [x] #3 Полный npm test проходит; mtime реального secrets.enc.json после прогона не меняется
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Проверено 2026-09-15: полный `npx vitest run` — 74 файла, 749 тестов зелёные; mtime реального `~/.projecthub/secrets.enc.json` до и после прогона одинаковый (1789476606), новых файлов в реальном `~/.projecthub` нет, временный каталог удаляется teardown. Отрицательная проверка: с конфигом без `test.env` страж падает («expected 'Professional' to match /^projecthub-test-home-/»), тест с записью секретов при этом не запускался. Первая попытка через `setupFiles` сломала загрузку всех тестов в vitest 5 — отвергнута (decision-29).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Изоляция домашнего каталога в unit-тестах (decision-29): `vitest.config.ts` создаёт один временный `projecthub-test-home-*` и задаёт `USERPROFILE`/`HOME` через `test.env`, `tests/setup/testHomeGlobalSetup.ts` удаляет его в teardown; тест-страж `tests/unit/testHomeIsolation.test.ts`. Полный прогон 749/749, реальный `~/.projecthub/secrets.enc.json` не меняется, страж падает без изоляции. Пользователю: секреты, затёртые прежними прогонами тестов, восстановить нельзя — нужно перегенерировать токен MCP, перепривязать Remote Control, заново ввести остальные секреты.
<!-- SECTION:FINAL_SUMMARY:END -->
