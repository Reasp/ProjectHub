---
id: TASK-107
title: >-
  Синхронизация F:\ProjectTemplate с ProjectHub: фичи computerUse и playwright в
  setup.mjs, правила 20–22
status: Done
assignee: []
created_date: '2026-09-27 06:06'
updated_date: '2026-09-28 04:53'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
F:\ProjectTemplate — отдельный репозиторий, источник файлов для скилла init-dev-project. Он отстаёт от ProjectHub (выяснено в TASK-78, decision-55 уточнение 5; сверено 2026-09-27, последний коммит шаблона 561ef06).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 setup.mjs шаблона: фичи computerUse и playwright (метки, MCP_KEYS, buildDesiredMcpServers, .playwright-mcp/ в .gitignore проекта, подсказки про токен и роли ProjectHub) без потери собственных доработок шаблона (git-хуки, сохранение ручных ключей, проверка gitnexus CLI); config.mjs знает обе фичи
- [x] #2 scripts/computer-use/computer-use-bridge.mjs скопирован в шаблон
- [x] #3 validate-docs шаблона проверяет память проекта backlog/memory (memory-rules.mjs), docs-hash учитывает backlog/memory без MEMORY.md
- [x] #4 infra-dev.md шаблона: строки таблицы и правила про управление компьютером, роли/хуки ProjectHub, Playwright и память проекта; разосланы sync-rules в CLAUDE.md/GEMINI.md/AGENTS.md/.agents/rules
- [x] #5 Скилл init-dev-project в .claude и .agents шаблона спрашивает про playwright, не включает computerUse без явной просьбы, описывает файлы ролей/хуков ProjectHub; копии различаются только намеренно (шапка Antigravity, способ вопросов)
- [x] #6 В шаблоне зелёные npm test (включая новые тесты setup и memory-rules) и npm run lint:docs; живой прогон setup.mjs с playwright/computerUse на временной копии шаблона
- [ ] #7 Коммит в репозитории шаблона — только по явной просьбе пользователя
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Направление — ProjectHub → F:\ProjectTemplate, выборочно: шаблон развивался сам (git-хуки, статусы Human, сохранение ручных ключей в setup.mjs, более новый process-manager.mjs), затирать его доработки нельзя.
1. scripts/setup.mjs: computerUse/playwright в ALL_FEATURES и FEATURE_LABELS, MCP_KEYS, buildDesiredMcpServers (мост computer-use, @playwright/mcp с закреплённой версией --headless --isolated), ensureGitignoreEntry для .playwright-mcp/, подсказки после настройки (токен PROJECTHUB_MCP_TOKEN, роли ProjectHub), экспорт функций и запуск main() только при прямом вызове — для тестов.
2. scripts/config.mjs: computerUse:false, playwright:false в DEFAULT; infra.config.json шаблона — оба флага false.
3. scripts/computer-use/computer-use-bridge.mjs — копия из хаба.
4. scripts/memory-rules.mjs — копия; validate-docs.mjs — вызов validateMemoryDir (+ frontmatter ролей .projecthub/roles); scripts/rag/docs-hash.mjs — backlog/memory без MEMORY.md.
5. infra-dev.md: строки таблицы, правило 1 (хэш с backlog/memory), правило 14 (память проекта), новые правила 24–26 (аналоги 20–22 хаба); npm run sync-rules.
6. SKILL.md init-dev-project (.claude и .agents): вопрос про playwright, computerUse только по явной просьбе, раздел про файлы ролей/хуков ProjectHub.
7. Тесты node --test: scripts/setup.test.mjs (buildDesiredMcpServers, ensureGitignoreEntry), scripts/memory-rules.test.mjs.
8. Проверка: npm test, npm run lint:docs, живой setup.mjs --features ...,playwright,computerUse на временной копии шаблона.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Правки — только в рабочем дереве F:\ProjectTemplate, без коммита (AC #7). Направление хаб → шаблон, выборочно: собственные доработки шаблона сохранены (git-хуки через core.hooksPath, перенос ручных ключей infra.config.json, FEATURE_LABELS, проверка gitnexus CLI, статусы Human, свой более новый process-manager.mjs).

Что перенесено:
- scripts/setup.mjs: computerUse/playwright в ALL_FEATURES и FEATURE_LABELS, MCP_KEYS (projecthub-computer, playwright), buildDesiredMcpServers (мост и @playwright/mcp@0.0.82 --headless --isolated), ensureGitignoreEntry (.playwright-mcp/), подсказки про PROJECTHUB_MCP_TOKEN и роли ProjectHub; функции экспортируются, main() — только при прямом запуске.
- scripts/config.mjs и infra.config.json: computerUse:false, playwright:false.
- scripts/computer-use/computer-use-bridge.mjs — копия из хаба.
- scripts/memory-rules.mjs — копия (ссылка на правило про даты исправлена на 14 шаблона, шапка: правки вносить сначала в ProjectHub); validate-docs.mjs — validateMemoryDir и frontmatter ролей .projecthub/roles; scripts/rag/docs-hash.mjs — backlog/memory без MEMORY.md.
- infra-dev.md: строки таблицы (управление компьютером, браузер), правило 1 (хэш с backlog/memory), память проекта в правиле 14, новые правила 24–26 — аналоги 20–22 хаба с перенумерованными ссылками (LightRAG — правило 8) и без хаб-специфичного selfcheck:ui; npm run sync-rules разослал в CLAUDE.md, GEMINI.md, AGENTS.md, .agents/rules/infra-dev.md.
- SKILL.md init-dev-project (.claude и .agents): вопрос 5 про playwright, computerUse только по явной просьбе, копирование memory-rules/тестов/моста, --features с [,playwright], раздел про файлы ролей/хуков ProjectHub. Копии различаются только намеренно (шапка Antigravity, «напрямую» вместо AskUserQuestion).
- Тесты node --test: scripts/setup.test.mjs (5), scripts/memory-rules.test.mjs (5).

Проверки: npm test шаблона — 26/26 (включая тесты git-хуков); npm run lint:docs — зелёный, индекс актуален. Живой прогон на временной копии C:\Temp\ph-107 (с junction node_modules, снят перед удалением): setup.mjs --features ...,playwright,computerUse записал оба MCP-конфига, добавил .playwright-mcp/ в .gitignore, подключил git-хуки; мост computer-use на SDK шаблона отвечает на initialize, при недоступном ProjectHub пишет понятную ошибку и отдаёт пустой список инструментов, без токена — подсказку; validate-docs ловит незакавыченную дату, секрет и отсутствие MEMORY.md, корректный факт проходит; check-index видит новый факт и пропускает MEMORY.md.

Обратное расхождение (не в скоупе): scripts/env/process-manager.mjs шаблона новее хаба — прямой detached-запуск PowerShell вместо cmd /c start /b (TASK-1 шаблона).

2026-09-28: закрыта по решению пользователя с неотмеченными критериями приёмки (6/7).
<!-- SECTION:NOTES:END -->
