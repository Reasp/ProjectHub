---
id: TASK-76.3
title: >-
  Память в контексте агента: часть memory в contextBuilder, переключатель,
  индексы и проверки
status: Done
assignee: []
created_date: '2026-09-26 13:28'
updated_date: '2026-09-27 00:04'
labels:
  - memory
  - context
  - rag
dependencies:
  - TASK-76.2
parent_task_id: TASK-76
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-51 п. 6, 7. Часть memory (task > memory > rag > gitnexus > git, своя доля до 1500 символов, работает без задачи, инструкция memory_write при наличии инструмента), ContextAppliedCard, категория memory в ragSearch, DOC_ROOTS docs-rag, validate-docs для backlog/memory, правило 13 infra-dev и sync-rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 contextBuilder подмешивает MEMORY.md и релевантные факты в пределах своей доли; без задачи часть тоже собирается; прежние части и их обрезка не сломаны
- [x] #2 Часть memory выключается в ContextAppliedCard и через contextParts
- [x] #3 index-docs, check-index и validate-docs учитывают backlog/memory; ragSearch приложения находит факты памяти
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано: contextBuilder — часть memory с приоритетом task > memory > rag > gitnexus > git и своим потолком 1500 символов (PART_MAX_CHARS), buildMemoryContextText (до 3 релевантных задаче фактов целиком, остальные строкой индекса от новых к старым, инструкция memory_write только при memoryToolPrefix), сборка без задачи (остаётся только память). Вызывающие: Claude CLI в AI Studio и слоты Swarm передают префикс mcp__projecthub-hitl__memory_, API-агент — memory_ при разрешённом memory_write, Codex/Gemini — без префикса (только чтение); пропуск контекста без задачи убран у всех. ContextPartKey расширен в electron и рендерере, переключатель части в ContextAppliedCard, строки ru/en. ragSearch: категория memory, MEMORY.md пропускается; тип RagSearchResult расширен. docs-rag: backlog/memory в DOC_ROOTS docs-hash (index-docs, check-index) и LightRAG, MEMORY.md исключён. validate-docs: scripts/memory-rules.mjs (формат, строки, id по имени, лимиты, строгие шаблоны секретов, соответствие индекса файлам); совпадение с memoryFormat.ts сторожит memoryRules.test.ts. Правило 13 и правило 1 infra-dev дополнены, sync-rules выполнен. Тесты: memoryContext (9), memoryRules (7), contextBuilder прежние зелёные; tsc чисто, eslint — только прежние предупреждения ragSearch/validate-docs.
<!-- SECTION:NOTES:END -->
