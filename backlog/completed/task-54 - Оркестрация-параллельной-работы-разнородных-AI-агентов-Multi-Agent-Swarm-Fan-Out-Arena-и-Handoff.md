---
id: TASK-54
title: >-
  Оркестрация параллельной работы разнородных AI-агентов (Multi-Agent Swarm,
  Fan-Out, Arena и Handoff)
status: Done
assignee:
  - Antigravity
created_date: '2026-09-10 01:23'
updated_date: '2026-09-10 03:21'
labels:
  - ai
  - multi-agent
  - swarm
  - orchestration
  - fan-out
  - ade
dependencies:
  - TASK-53
modified_files:
  - electron/services/agentFleetService.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useSwarmStore.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/components/ai/AIStudioView.tsx
  - src/components/kanban/TaskDetailModal.tsx
  - tests/unit/agentFleetService.test.ts
priority: high
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Внедрение подсистемы оркестрации параллельной работы разнородных AI-агентов (Multi-Agent Fleet / Swarm Orchestrator):

- **Fan-Out диспетчеризация**: возможность направить задачу сразу нескольким разным агентным движкам (Claude Code, OpenAI Codex CLI, Aider, OpenCode, локальный Ollama DeepSeek) для соревновательной или взаимодополняющей генерации кода.
- **Интеграция с Git Worktrees (TASK-53)**: запуск каждого параллельного агента в своем изолированном рабочем дереве, исключающий race conditions и конфликты в кодовой базе.
- **Arena & Side-by-Side Review**: графический интерфейс для одновременного мониторинга хода мысли (reasoning/thinking), вызовов инструментов и получаемых диффов от всех запущенных агентов.
- **Выбор решения в 1 клик**: мерж кода выбранного агента и мгновенная очистка временных ресурсов проигравших веток.
- **Мульти-агентный конвейер (Handoff)**: организация цепочки специализированных ролей (архитектор формирует спецификацию -> кодер пишет реализацию -> ревьюер проверяет тесты).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Реализован менеджер мульти-агентных сессий (AgentFleetManager / SwarmManager) для одновременного запуска нескольких CLI и API агентов
- [x] #2 Поддерживается режим Fan-Out (одновременная отправка одной задачи/промпта в 2+ выбранных агента, например Claude Code, Codex, DeepSeek, Ollama)
- [x] #3 Каждый параллельный агент автоматически связывается с собственным Git Worktree (интеграция с TASK-53) для исключения коллизий файлов
- [x] #4 Реализован экран сравнения Side-by-Side Arena: параллельный просмотр логов, прогресса выполнения, сгенерированных диффов и метрик скорости/токенов
- [x] #5 Добавлена функция выбора победителя (Pick Winner) в один клик: слияние ветки выбранного агента и безопасная остановка/prune остальных сессий
- [x] #6 Поддерживается режим последовательной передачи (Agent-to-Agent Handoff): результат одного агента передается на вход следующему (напр. План -> Код -> Тесты)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Разработка бэкенд-сервиса AgentFleetService (electron/services/agentFleetService.ts):
- Модели данных SwarmSession, AgentSlotConfig, AgentSlotState, SwarmMode (fan_out, handoff).
- Режим Fan-Out: параллельный запуск 2+ разнородных агентов (Claude CLI, OpenAI Codex CLI/API, DeepSeek, Ollama) с автоматическим созданием изолированных Git Worktrees через worktreeService.
- Стриминг логов, вывода и диффов в реальном времени, подсчет метрик (время, скорость, токены/символы).
- Режим Agent-to-Agent Handoff: последовательный конвейер этапов (Архитектор/План -> Реализация/Код -> Ревью/Тесты) с передачей контекста.
- Функция Pick Winner в 1 клик: слияние ветки победителя через worktreeService.mergeWorktree, корректная остановка остальных процессов и очистка временных worktrees.
2. Регистрация IPC-хэндлеров и событий в main.ts, preload.ts и electron.d.ts:
- Хэндлеры swarm:startFanOut, swarm:startHandoff, swarm:stop, swarm:pickWinner, swarm:list, swarm:get.
- Push-события swarm:event для мгновенного обновления интерфейса без поллинга.
3. Разработка фронтенд-стора и компонентов Swarm Arena:
- useSwarmStore.ts (Zustand) для управления сессиями роя, запуском, выбором победителя и историей.
- SwarmArenaView.tsx: адаптивная сетка Side-by-Side Arena со сравнением агентов в реальном времени, вкладками логов, Markdown-вывода и диффов.
- NewSwarmModal.tsx: мастер конфигурации соревнований и конвейеров с пресетами и привязкой к задачам Backlog.
- Интеграция в AIStudioView (переключатель режимов) и TaskDetailModal (быстрый запуск в Swarm Arena).
4. Тестирование и валидация:
- Написание unit-тестов в tests/unit/agentFleetService.test.ts (Fan-Out, Worktrees, Pick Winner, Handoff).
- Проверка через vitest (npm test), линтинг (npm run lint, npm run lint:docs) и распакованная сборка (npm run pack:win).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
1. Разработан AgentFleetService в electron/services/agentFleetService.ts с поддержкой Fan-Out, Arena, Worktree-изоляции, Pick Winner и Handoff.

2. Зарегистрированы типизированные IPC-каналы swarm:* в electron/main.ts, preload.ts и electron.d.ts.

3. Создан Zustand-стор useSwarmStore.ts.

4. Реализованы UI-компоненты SwarmArenaView.tsx и NewSwarmModal.tsx.

5. Интегрировано переключение режимов в AIStudioView.tsx и кнопка быстрого запуска в TaskDetailModal.tsx.

6. Написаны unit-тесты в tests/unit/agentFleetService.test.ts. Все 186 unit-тестов пройдены, ESLint 0 ошибок, lint:docs проверен, npm run pack:win собран успешно.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализована и протестирована комплексная подсистема оркестрации параллельной работы разнородных AI-агентов (Multi-Agent Swarm, Fan-Out, Arena и Handoff). Каждый агент получает изолированное Git Worktree для исключения файловых конфликтов, доступен Side-by-Side просмотр хода мыслей, логов, метрик и диффов, а также выбор победителя в 1 клик со слиянием в базовую ветку и очисткой временных ресурсов.
<!-- SECTION:FINAL_SUMMARY:END -->
