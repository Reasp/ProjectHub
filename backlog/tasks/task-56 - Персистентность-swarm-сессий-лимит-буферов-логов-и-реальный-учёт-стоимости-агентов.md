---
id: TASK-56
title: >-
  Персистентность swarm-сессий, лимит буферов логов и реальный учёт стоимости
  агентов
status: Done
assignee: []
created_date: '2026-09-10 07:14'
updated_date: '2026-09-11 02:38'
labels:
  - ade-roadmap
  - swarm
  - persistence
  - metrics
  - P1
dependencies: []
references:
  - electron/services/agentFleetService.ts
  - electron/services/aiSessionStore.ts
  - electron/services/claudeUsageService.ts
  - electron/services/processManager.ts
  - src/store/useSwarmStore.ts
documentation:
  - >-
    backlog/decisions/decision-7 -
    Local-first-хранение-состояния-и-отсутствие-телеметрии.md
  - >-
    backlog/decisions/decision-8 -
    Результаты-агентов-материализуются-в-git-авто-коммит-в-worktree-и-безопасное-слияние.md
  - >-
    backlog/decisions/decision-16 -
    Персистентность-swarm-сессий-кольцевые-буферы-логов-и-учёт-стоимости-агентов.md
modified_files:
  - electron/services/swarmTypes.ts
  - electron/services/agentCost.ts
  - electron/services/swarmLogBuffer.ts
  - electron/services/swarmSessionStore.ts
  - electron/services/swarmExport.ts
  - electron/services/agentFleetService.ts
  - electron/services/aiAgentService.ts
  - electron/services/claudeBridgeService.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - electron/main.ts
  - src/types/electron.d.ts
  - src/store/useSwarmStore.ts
  - src/utils/swarmFormat.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
  - tests/unit/agentCost.test.ts
  - tests/unit/swarmLogBuffer.test.ts
  - tests/unit/swarmSessionStore.test.ts
  - tests/unit/swarmExport.test.ts
  - tests/unit/agentFleetPersistence.test.ts
  - >-
    backlog/decisions/decision-16 -
    Персистентность-swarm-сессий-кольцевые-буферы-логов-и-учёт-стоимости-агентов.md
priority: high
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-7, decision-8).

**Что не так сейчас**
- Swarm-сессии хранятся только в `Map` в памяти `agentFleetService`. Каталог `~/.projecthub/swarms` создаётся, но в него ничего не пишется и из него ничего не читается. После перезапуска `swarm:list` пуст, а worktree и ветки остаются осиротевшими.
- `agent.logs[]` и `liveOutput` растут без лимита (в отличие от `processManager` с `LOG_BUFFER_MAX_BYTES`), длинные прогоны раздувают память main и рендерера.
- Метрики: `tokensEstimated = chars / 4`, стоимости нет. Реальный usage и `costUSD` есть в `claudeUsageService` (парсинг `stats-cache.json` и `claude -p /usage`), но со swarm и AI Studio не связаны. Для API-провайдеров учёт стоимости отсутствует полностью.
- AI Studio-сессии уже персистятся (`aiSessionStore`), swarm должен использовать тот же подход и лимиты.
- Путь `~/.projecthub` захардкожен, вместо `appPaths` (см. TASK-59).

**Что сделать**
1. `swarmSessionStore` по образцу `aiSessionStore`: файл на сессию в `<userData>/swarms/<sessionId>.json` с полем `version`, дебаунс-запись, усечение тяжёлых полей (логи, диффы) по лимитам `STORAGE_LIMITS`; транскрипт каждого агента отдельным файлом `<sessionId>/<agentId>.log` с ротацией.
2. Восстановление при старте: незавершённые сессии помечаются `interrupted`, их worktree сверяются с `git worktree list`; пользователю предлагается возобновить (перезапустить агента в том же worktree с промптом «продолжи») или закрыть с очисткой.
3. Кольцевой буфер логов агента с лимитом байт и «tail» для UI; полный лог читается из файла по запросу.
4. Стоимость: для `claude-cli` брать `usage`/`cost` из событий `stream-json` (`result` содержит `total_cost_usd`, `usage`) и записывать на агента; для API-провайдеров считать по `usage` ответа и таблице цен провайдера (конфигурируемой, с датой актуальности); для Codex/Gemini CLI парсить их итоговые строки, если доступны. Показать в арене и в сводке сессии стоимость, токены input/output/cache, длительность.
5. Бюджет на сессию и на роль (`budgetUsd`, см. decision-9): при превышении агент останавливается с понятным статусом.
6. Экспорт сессии (JSON/Markdown-отчёт) для вложения в задачу Backlog.md или PR.
7. Unit-тесты на store (запись/чтение/усечение/миграция версии) и на расчёт стоимости.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Swarm-сессии, агенты, метрики и статусы сохраняются на диск и восстанавливаются после перезапуска приложения; незавершённые сессии помечены interrupted с предложением возобновить или очистить
- [x] #2 Логи агента ограничены кольцевым буфером; полный транскрипт хранится в файле и открывается из UI по запросу; память main не растёт линейно от длины прогона
- [x] #3 Для claude-cli стоимость и токены берутся из событий stream-json, для API-провайдеров считаются по usage и таблице цен; арена и сводка сессии показывают cost/tokens/duration по каждому агенту
- [x] #4 Бюджет budgetUsd на сессию и роль останавливает агента при превышении с явным статусом
- [x] #5 Сессию можно экспортировать в Markdown-отчёт и JSON
- [x] #6 Unit-тесты на swarmSessionStore и расчёт стоимости добавлены, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Вынести типы Swarm в `swarmTypes.ts`; новые чистые модули: `agentCost.ts` (usage/цены/бюджет), `swarmLogBuffer.ts` (кольцевые буферы), `swarmSessionStore.ts` (файл на сессию + транскрипты с ротацией, троттлинг записи, миграция версии), `swarmExport.ts` (Markdown/JSON).
2. `agentFleetService`: персистентность через store, восстановление при старте (`interrupted`, сверка worktree), `resumeSwarm`/`discardSwarm`/`readTranscript`/`exportSession`/`shutdown`; Claude CLI через stream-json + stdin с usage по ходам и `result`; API-агент читает usage из стрима; бюджеты слота и сессии.
3. `aiAgentService`: usage из Anthropic (`message_start`/`message_delta`) и OpenAI-совместимых (`stream_options.include_usage`, OpenRouter `cost`); `claudeBridgeService`: usage из `result` в сообщения AI Studio.
4. IPC/preload/типы: `swarm:resume`, `swarm:discard`, `swarm:readTranscript`, `swarm:export`, `swarm:exportToFile`; main: `init()` после whenReady, `shutdown()` при выходе.
5. UI: баннер прерванной сессии (возобновить/закрыть), сводка cost/tokens/duration, бейджи `interrupted`/`budget_exceeded`/worktree missing, «Полный лог», экспорт .md/.json, бюджеты в модалке.
6. Unit-тесты: agentCost, swarmLogBuffer, swarmSessionStore, swarmExport, agentFleetPersistence. ADR decision-16.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Реализовано (decision-16):**
- `swarmSessionStore.ts`: `<userData>/swarms/<id>.json` (атомарная запись, `version`, миграция v0), транскрипты `<id>/<agentId>.log` с ротацией 5 МБ, троттлинг записи 1 с, усечение по `SWARM_STORAGE_LIMITS`, apiKey провайдера не пишется.
- `agentFleetService.ts`: `init()`/`restoreFromDisk()` при старте (незавершённые → `interrupted`, сверка worktree с `git worktree list` → `worktreeMissing`), `resumeSwarm` (перезапуск в том же worktree с `RESUME_PROMPT_SUFFIX`, handoff с незавершённого этапа), `discardSwarm` (материализация, удаление worktree/веток/файлов), `shutdown()` при выходе (main.ts), `readTranscript`, `exportSession`. Claude CLI переведён на `-p --output-format stream-json --verbose` с промптом через stdin; usage по ходам (`assistant`) и итог (`result`: токены, `total_cost_usd`, модель). Бюджеты: `AgentSlotConfig.budgetUsd` и `budgetUsd` сессии → статус `budget_exceeded` / сессия `failed` с причиной.
- `swarmLogBuffer.ts`: `logs` ≤ 400 строк / 256 КБ, `liveOutput` хвост 200k символов, счётчики вытеснения для UI.
- `agentCost.ts`: таблица цен (дата актуальности, переопределение через `<userData>/agent-pricing.json`), нормализация id моделей, парсеры usage Anthropic/OpenAI/stream-json/CLI-строк, `costSource` provider|price-table|unknown.
- `aiAgentService.ts`: usage из стрима Anthropic и OpenAI-совместимых (`stream_options.include_usage`, OpenRouter `cost`); `claudeBridgeService.ts`: usage из `result` в сообщения AI Studio (`AIMessage.usage`).
- UI: баннер прерванной сессии (Возобновить / Закрыть и очистить), удаление сессии, сводка cost/tokens/duration с бюджетом, бейджи статусов и `worktree не найден`, «Полный лог» (модалка с транскриптом), экспорт .md/.json через диалог сохранения, поля бюджета сессии и слота + модель в NewSwarmModal.
- Тесты: 5 новых файлов (52 теста), всего 228 зелёных. `npm run pack:win` собран.

**Ограничения:** для однократного API-ответа бюджет срабатывает после ответа; usage сторонних CLI best-effort; таблица цен встроена (обновление релизом или `agent-pricing.json`). Пути `~/.projecthub/sessions` vs `<userData>/swarms` унифицируются в TASK-59.
<!-- SECTION:NOTES:END -->
