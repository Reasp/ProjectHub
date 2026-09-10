---
id: TASK-47
title: >-
  Собрать и закоммитить векторный индекс документации (.rag-index), MCP
  search_docs не работает
status: Done
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - rag
  - infra
  - P2
dependencies: []
references:
  - scripts/rag/index-docs.mjs
  - CLAUDE.md
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - scripts/rag/chunk.mjs
  - scripts/rag/embed.mjs
  - scripts/rag/index-docs.mjs
  - scripts/rag/rag-server.mjs
  - scripts/rag/search-cli.mjs
  - scripts/rag/docs-hash.mjs
  - scripts/rag/check-index.mjs
  - electron/services/ragSearch.ts
  - package.json
  - infra-dev.md
  - CLAUDE.md
  - GEMINI.md
  - AGENTS.md
  - .agents/rules/infra-dev.md
  - backlog/docs/doc-5 - RAG-Guide.md
  - tests/unit/rag-chunk.test.ts
  - .rag-index/
priority: medium
type: chore
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 6.6 (doc-7).

Каталог `.rag-index/` отсутствует в репозитории и на диске. MCP-инструмент `docs-rag.search_docs` отвечает «Индекс не найден. Сначала выполните: npm run index-docs», хотя CLAUDE.md требует, чтобы индекс коммитился в git и использовался агентами перед ответами про архитектуру. При этом в Sidebar статус RAG для самого ProjectHub показывает «не готов».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Выполнен npm run index-docs, каталог .rag-index создан и добавлен в git
- [x] #2 search_docs через MCP возвращает результаты по запросам об архитектуре ProjectHub
- [x] #3 В README/doc-5 описано, когда нужно перестраивать индекс (после правок backlog/docs и backlog/decisions)
- [x] #4 Опционально: pre-commit hook или CI-проверка актуальности индекса по хэшу документов
- [x] #5 Оценить качество поиска на русскоязычных запросах: текущая модель Xenova/all-MiniLM-L6-v2 англоязычная, запрос про уязвимость MCP-сервера вернул нерелевантные чанки; рассмотреть многоязычную модель (paraphrase-multilingual-MiniLM-L12-v2 / multilingual-e5-small) в scripts/rag/embed.mjs и electron/services/ragSearch.ts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-05: индекс собран локально в рамках аудита (npm run index-docs, 1082 чанка из 8 файлов), но ещё не закоммичен. Проверка search_docs показала низкую релевантность на русских запросах.

2026-09-07: качество поиска на русском было низким по двум причинам, обе устранены.

1. Чанкер (scripts/rag/chunk.mjs, CHUNKER_VERSION=2): frontmatter и заголовки без текста больше не становятся отдельными чанками; у чанка путь заголовков («крошки»), мелкие соседние блоки склеиваются; кодируется title + путь + текст; data-URI картинки и base64-блобы вырезаются (doc-1 давал 973 мусорных чанка из 1094). Итог: 123 чанка вместо 1094, индекс 300 КБ.

2. Модель: Xenova/all-MiniLM-L6-v2 → Xenova/multilingual-e5-small (q8, ~120 МБ, префиксы query:/passage:). Реестр моделей в embed.mjs и зеркало в electron/services/ragSearch.ts. Имя модели и префиксы пишутся в .rag-index/meta.json; rag-server, search-cli и ragSearch.ts кодируют запрос моделью из meta.json — индекс и поиск не расходятся, чужие индексы старой моделью тоже ищутся.

Проверка (search-cli): «уязвимость MCP-сервера» → doc-6 Этап 2 Security / doc-7 «4. Безопасность»; «Human-in-the-loop для Claude CLI» → doc-8; «почему Electron а не Tauri» → doc-3 «Сравнение платформ» / decision-1; «как перестроить индекс» → doc-5 «Команды». До правок те же запросы возвращали пустые заголовки и разделы про иконки.

3. Актуальность индекса: meta.json содержит docsHash (sha256 путей+содержимого, CRLF нормализован) и chunkerVersion; scripts/rag/check-index.mjs сравнивает (npm run check-index). Включён в lint:docs (падает) и в build (--warn). Пропускается при features.docsRag=false.

4. Документация: doc-5 переписан (модель, чанкинг, формат meta.json, когда перестраивать индекс), правило 1 в infra-dev.md + быстрые команды, sync-rules выполнен.

5. Тесты: tests/unit/rag-chunk.test.ts (10 тестов), всего 129 проходят. tsc чистый.

Важно: MCP-сервер docs-rag, запущенный до правок, держит в памяти старый embed.mjs — после коммита нужно перезапустить сессию агента (или /mcp reconnect), иначе запросы кодируются старой моделью против нового индекса.
<!-- SECTION:NOTES:END -->
