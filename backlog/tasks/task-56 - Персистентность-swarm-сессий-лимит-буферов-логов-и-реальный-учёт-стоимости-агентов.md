---
id: TASK-56
title: >-
  Персистентность swarm-сессий, лимит буферов логов и реальный учёт стоимости
  агентов
status: To Do
assignee: []
created_date: '2026-09-10 07:14'
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
- [ ] #1 Swarm-сессии, агенты, метрики и статусы сохраняются на диск и восстанавливаются после перезапуска приложения; незавершённые сессии помечены interrupted с предложением возобновить или очистить
- [ ] #2 Логи агента ограничены кольцевым буфером; полный транскрипт хранится в файле и открывается из UI по запросу; память main не растёт линейно от длины прогона
- [ ] #3 Для claude-cli стоимость и токены берутся из событий stream-json, для API-провайдеров считаются по usage и таблице цен; арена и сводка сессии показывают cost/tokens/duration по каждому агенту
- [ ] #4 Бюджет budgetUsd на сессию и роль останавливает агента при превышении с явным статусом
- [ ] #5 Сессию можно экспортировать в Markdown-отчёт и JSON
- [ ] #6 Unit-тесты на swarmSessionStore и расчёт стоимости добавлены, npm run build проходит
<!-- AC:END -->
