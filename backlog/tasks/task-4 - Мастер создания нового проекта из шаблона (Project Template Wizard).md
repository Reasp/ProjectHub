---
id: "task-4"
title: "Мастер создания нового проекта из шаблона (Project Template Wizard)"
status: "To Do"
labels: ["wizard", "template", "scaffolding", "setup"]
created: "2026-08-28"
---

# task-4: Мастер создания нового проекта из шаблона (Project Template Wizard)

## Description
Разработать пошаговый мастер создания нового проекта на основе эталонного шаблона `F:\ProjectTemplate`.

## Acceptance Criteria
- [ ] Модальное окно или экран мастера создания проекта с полями:
  - Имя проекта (например, `MyCoolApp`).
  - Целевой каталог размещения (с выбором через диалог).
  - Набор переключателей фич (`docsRag`, `envTools`, `backlogMcp`, `bootstrap`, `lightrag`).
- [ ] Копирование структуры шаблона `ProjectTemplate` с пропуском мусорных файлов (`node_modules`, `.git`, кэшей индексов).
- [ ] Автоматическая параметризация `package.json`, `infra.config.json`, `backlog/config.yml` с новым именем проекта.
- [ ] Автоматический вызов инициализации (`node scripts/setup.mjs`).
- [ ] Автоматическое добавление созданного проекта в список активных проектов Hub и переход в его рабочее пространство.
