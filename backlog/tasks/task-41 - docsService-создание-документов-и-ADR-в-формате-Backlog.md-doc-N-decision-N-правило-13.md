---
id: TASK-41
title: >-
  docsService: создание документов и ADR в формате Backlog.md (doc-N /
  decision-N, правило 13)
status: Done
assignee: []
created_date: '2026-09-05 09:08'
updated_date: '2026-09-10 02:00'
labels:
  - audit
  - backlog
  - docs
  - P1
dependencies: []
references:
  - electron/services/docsService.ts
  - src/components/docs/CreateDocModal.tsx
  - scripts/validate-docs.mjs
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/docsService.ts
  - src/types/electron.d.ts
  - src/components/docs/CreateDocModal.tsx
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/i18n/types.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 5.2 (doc-7).

`docsService.createProjectDoc` создаёт `backlog/decisions/NNNN-slug.md` и `backlog/docs/slug.md` без `id: doc-N`/`decision-N` во frontmatter и без имени файла вида `doc-<id> - <Title>.md`. Это нарушает правило 13 CLAUDE.md: такие файлы не распознаются веб-интерфейсом Backlog.md и вызывают ошибки отображения. `listProjectDocs` формирует id как `doc-<имя файла>`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createProjectDoc генерирует следующий свободный id (doc-N / decision-N), имя файла `doc-N - Title-Slug.md` / `decision-N - Title-Slug.md` и frontmatter по стандарту (id, title, type, created_date / id, title, date, status)
- [x] #2 listProjectDocs использует id из frontmatter, если он есть
- [x] #3 Созданный через GUI документ проходит npm run lint:docs и отображается в веб-интерфейсе Backlog.md
- [x] #4 Опционально: при наличии backlog.md CLI в проекте создание делегируется команде backlog doc create / decision create
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Переписать docsService: общий рекурсивный обход docs/decisions, id из frontmatter → из имени файла → старая схема.
2. createProjectDoc: следующий свободный номер = max(id во frontmatter, номер в имени файла) + 1 по обоим источникам; имя файла `doc-N - Title-Slug.md` в стиле Backlog.md (регистр и кириллица сохраняются); frontmatter строго по правилу 13 (id, title, type, created_date / id, title, date, status), строки в кавычках (правило 16); запись с flag 'wx' против гонки.
3. Добавить в CreateDocParams поле docType (guide/readme/specification/other), в модалку — селектор типа, i18n-ключи docCategory/docType/docTypeHint (ru/en).
4. Проверить: tsc, создание doc/decision через сервис, npm run lint:docs, `backlog doc list`/`decision list`/`doc view`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано в electron/services/docsService.ts, src/types/electron.d.ts, src/components/docs/CreateDocModal.tsx, src/i18n/{ru,en,types}.ts.

Проверка: созданные через сервис `doc-9 - Тест-созданиедокумента-GUI.md`, `doc-10 - With-custom-content.md` (из content с собственным frontmatter — берётся только тело, type/tags учитываются), `decision-2 - Test-decision-via-GUI.md` (status Proposed → proposed) прошли `npm run lint:docs`, распознаны `npx backlog.md doc list` / `decision list` / `doc view doc-9`. Тестовые файлы удалены.

AC #4 (делегирование CLI) сознательно не сделано: нативная генерация даёт тот же формат и нумерацию, что и CLI, а вызов `npx backlog.md` из main-процесса требует парсинга вывода CLI, может ходить в сеть за пакетом и ломается в упакованном приложении без node_modules проекта.

Поведение: статус ADR нормализуется к нижнему регистру (accepted/proposed/rejected/deprecated), тип документа по умолчанию other (в модалке по умолчанию guide). Дата в DocItem для документов берётся из created_date, для решений из date.
<!-- SECTION:NOTES:END -->
