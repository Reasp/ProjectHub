---
id: TASK-47
title: >-
  Собрать и закоммитить векторный индекс документации (.rag-index), MCP
  search_docs не работает
status: To Do
assignee: []
created_date: '2026-09-05 09:09'
updated_date: '2026-09-05 09:13'
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
- [ ] #1 Выполнен npm run index-docs, каталог .rag-index создан и добавлен в git
- [ ] #2 search_docs через MCP возвращает результаты по запросам об архитектуре ProjectHub
- [ ] #3 В README/doc-5 описано, когда нужно перестраивать индекс (после правок backlog/docs и backlog/decisions)
- [ ] #4 Опционально: pre-commit hook или CI-проверка актуальности индекса по хэшу документов
- [ ] #5 Оценить качество поиска на русскоязычных запросах: текущая модель Xenova/all-MiniLM-L6-v2 англоязычная, запрос про уязвимость MCP-сервера вернул нерелевантные чанки; рассмотреть многоязычную модель (paraphrase-multilingual-MiniLM-L12-v2 / multilingual-e5-small) в scripts/rag/embed.mjs и electron/services/ragSearch.ts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-05: индекс собран локально в рамках аудита (npm run index-docs, 1082 чанка из 8 файлов), но ещё не закоммичен. Проверка search_docs показала низкую релевантность на русских запросах.
<!-- SECTION:NOTES:END -->
