---
id: TASK-79.4
title: 'UI тиров моделей: вкладка настроек, выбор тира в слоте Swarm и редакторе ролей'
status: Done
assignee: []
created_date: '2026-09-19 06:18'
updated_date: '2026-09-19 07:57'
labels:
  - ai
  - ui
  - i18n
milestone: m-0
dependencies:
  - TASK-79.1
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
modified_files:
  - src/lib/modelTierEditor.ts
  - src/components/ai/ModelTiersSection.tsx
  - src/components/ai/ModelTierSelect.tsx
  - src/components/ai/AISettingsModal.tsx
  - src/components/ai/swarm/NewSwarmModal.tsx
  - src/components/ai/roles/RolesSettingsModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/modelTierEditor.test.ts
parent_task_id: TASK-79
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-44 п. 9–10. Вкладка «Тиры» в настройках AI Studio: звенья тиров (движок, цель, модель с подсказками каталога профиля и алиасов Claude CLI), порядок, флаги, «Заполнить из настроенного», подсветка модели вне каталога. Выбор тира в `NewSwarmModal` и `RolesSettingsModal`. i18n ru/en.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Вкладка «Тиры»: правка звеньев, порядок, флаги, заполнение из настроенного, сохранение отдельной кнопкой
- [x] #2 Модель тира вне кэша каталога её профиля подсвечивается; каталог обновляется кнопкой
- [x] #3 Выбор тира в слоте Swarm и редакторе ролей; строки ru/en
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-44 п. 9–10.
- Вкладка «Тиры» в настройках AI Studio (`ModelTiersSection`, модалка уже с `z-[9999]` через портал): тиры сверху вниз frontier → cheap, звено = движок, провайдер (`ProviderProfileSelect`, профиль по имени), модель с подсказками (каталог профиля / алиасы Claude CLI), порядок ↑↓, удаление, метка `авто`, подсветка «нет в каталоге профиля» / «профиль не найден», проблемы черновика (пустая модель, повтор); флаги «спускаться в младший тир», переключений за ход 0–2, ожидание Retry-After; «Обновить каталоги» (сеть по кнопке), «Заполнить из настроенного», сохранение своей кнопкой.
- `ModelTierSelect` в слоте `NewSwarmModal` (выбор роли переносит её тир) и в редакторе ролей.
- Чистые функции — `src/lib/modelTierEditor.ts`, тесты `modelTierEditor.test.ts`.
- Скриншоты собранного exe (копия userData без кэшей и чувствительных файлов, временный HOME с профилями Ollama/Dead/LAN): вкладка «Tiers» EN с подсвеченной `no-such-model:1b`, RU после «Заполнить из настроенного» («Добавлено звеньев: 2»), селектор тира в слоте «Новая дуэль» (Без тира / Фронтир / Сбалансированный / Дешёвый), архитектор в редакторе ролей — `frontier`.
<!-- SECTION:NOTES:END -->
