---
id: TASK-76.1
title: >-
  Память: чистые модули формата факта, детектора секретов и поиска похожих с
  тестами
status: Review
assignee: []
created_date: '2026-09-26 13:27'
updated_date: '2026-09-26 13:33'
labels:
  - memory
  - ai
dependencies: []
parent_task_id: TASK-76
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-51 п. 2, 5. memoryFormat.ts (разбор и сериализация факта, имя файла mem-N - slug, лимиты, генерация MEMORY.md), secretPatterns.ts (detectSecrets, общие шаблоны; hitlAudit переходит на них без изменения поведения), поиск по словам и порог дубликата. Без Electron и fs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 memoryFormat разбирает и сериализует факт, проверяет frontmatter (строки, type из списка, id по имени файла) и лимиты; MEMORY.md строится детерминированно
- [x] #2 detectSecrets находит ключи провайдеров, приватные ключи, JWT, пароли в URL, Bearer и ИМЯ_СЕКРЕТА=значение без ложных срабатываний на обычный текст; hitlAudit.redactSecrets ведёт себя как прежде
- [x] #3 Поиск по словам ранжирует факты и находит дубликат выше порога; всё покрыто unit-тестами
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано: electron/services/secretPatterns.ts (REDACTION_PATTERNS — прежние шаблоны маскировки hitlAudit, detectSecrets — строгий детектор 11 видов, looksLikeSecretValue), memoryFormat.ts (id, имя файла mem-N - slug до 60 символов, validateMemoryDraft, serializeMemoryFact — все значения JSON-строками, parseMemoryFile через gray-matter без кэша, buildMemoryIndex со ссылками на фактические файлы), memorySearch.ts (tokenize с основой 5 символов, jaccard, findDuplicate с порогом 0.6 и excludeId, searchMemoryFacts с весами 3/2/1). hitlAudit берёт шаблоны из secretPatterns, поведение прежнее (hitlAudit.test.ts зелёный). Тесты: memoryFormat, memorySearch, secretPatterns — 62 вместе с hitlAudit; tsc и eslint по файлам чисто. Попутно найдено: основа в 6 символов не сводила «сборка/сборки», шаблон ИМЯ=значение не ловил голое password: — исправлено, закреплено тестами.
<!-- SECTION:NOTES:END -->
