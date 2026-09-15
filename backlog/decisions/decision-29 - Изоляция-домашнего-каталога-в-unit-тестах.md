---
id: decision-29
title: "Изоляция домашнего каталога в unit-тестах"
date: "2026-09-15 21:55"
status: accepted
---
## Context

Сервисы main-процесса вычисляют пути от `os.homedir()` при импорте модуля:
`secretStorageService` (`~/.projecthub/secrets.enc.json`), `aiAgentService` (`ai-config.json`,
`claude_config`), `aiSessionStore` (`sessions/`), `windowStateService`. Unit-тесты мокали только
модуль `electron`, но использовали настоящие сервисы.

В TASK-82 обнаружено, что `remoteControlAuth.test.ts` при каждом `npm test` / `npm run build` /
`npm run pack:win` перезаписывал файл секретов пользователя тестовыми данными
(`remoteControl.deviceTokens`, `remoteControl.identityPrivateKey` без шифрования), а параллельные
воркеры vitest оставляли в нём невалидный JSON. Прежние секреты пользователя потеряны.

Рассмотренные варианты: точечный `vi.mock` секретов в отдельных тестах (не защищает от будущих
тестов с тем же дефектом); переменная окружения для пути секретов в продуктовом коде (меняет
контракт приложения ради тестов и покрывает только один сервис).

## Decision

1. `vitest.config.ts` создаёт один временный каталог `projecthub-test-home-*` на прогон и задаёт
   `USERPROFILE`/`HOME` через `test.env` — с самого старта воркеров; `globalSetup`
   (`tests/setup/testHomeGlobalSetup.ts`) удаляет его в teardown. Реальный домашний каталог
   передаётся в `PROJECTHUB_TEST_REAL_HOME` только для проверки. Вариант с `setupFiles`, меняющим
   переменные при загрузке воркера, отвергнут: vitest 5 при этом не находит runner, и все файлы
   падают при загрузке.
2. Тест-страж `tests/unit/testHomeIsolation.test.ts` проверяет, что `os.homedir()` в тестах —
   временный каталог и что `secretStorageService` пишет в него.
3. Правило для агентов: тест, которому нужен настоящий домашний каталог, недопустим; ручные
   прогоны приложения для проверок — с отдельными `--user-data-dir` и `USERPROFILE`.

## Consequences

- Плюс: ни один unit-тест больше не может записать в `~/.projecthub` пользователя — независимо от
  того, какие сервисы он импортирует.
- Минус: пути, которые Electron берёт через `app.getPath('home')`, переменной `USERPROFILE` не
  подменяются; в тестах `electron` мокается, поэтому это не проблема, но в ручных прогонах
  приложения `projectRegistry` читает реестр из реального домашнего каталога.
- Пользователю после исправления нужно перегенерировать токен MCP, перепривязать устройства Remote
  Control и заново ввести секреты из `secrets.enc.json`.
- Реализация: TASK-84.
