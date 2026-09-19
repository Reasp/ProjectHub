---
id: TASK-79.5
title: Отчёт о тире и переключениях модели в карточке агента и экспорте сессии
status: Review
assignee: []
created_date: '2026-09-19 06:18'
updated_date: '2026-09-19 06:53'
labels:
  - ai
  - swarm
  - ui
milestone: m-0
dependencies:
  - TASK-79.3
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
modified_files:
  - electron/services/modelTiers.ts
  - electron/services/swarmExport.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/lib/modelTierEditor.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/modelFallback.test.ts
parent_task_id: TASK-79
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-44 п. 8. Снимок `AgentSlotState.modelRouting` (тир, источник, фактическая модель, переключения с причинами, итог). Карточка агента Swarm и экспорт Markdown/JSON.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Карточка агента показывает тир, фактическую модель и переключения с причинами (ru/en)
- [x] #2 Экспорт Markdown содержит тир и переключения, JSON — modelRouting целиком; тесты swarmExport
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-44 п. 8.
- Снимок `AgentSlotState.modelRouting`: тир, источник (явная / из таблицы / не настроен), движок, текущее звено, длина цепочки, лимит, переключения (откуда, куда, вид, причина, статус, код, ожидание, время, краткое сообщение), причина остановки.
- Карточка агента: бейдж «Тир balanced» (+ модель для CLI-движков), полоса «Переключения модели» со списком и причиной остановки (ru/en). Подпись явной модели слота — имя профиля, а не id (замечено на скриншоте, исправлено, покрыто тестом).
- Экспорт Markdown: «Тир модели: … фактическая модель …», «Переключения модели: 1. … → …: `вид`», «Цепочка остановлена: …»; JSON — `modelRouting` целиком; CLI-движок показывает фактическую модель в колонке «Провайдер · модель».
- Скриншоты exe: сессия, записанная настоящим прогоном `AgentFleetService` в копию userData (два слота: 2 переключения → «Париж»; явная модель + тир → лимит), EN и RU.
<!-- SECTION:NOTES:END -->
