---
id: TASK-41
title: >-
  docsService: создание документов и ADR в формате Backlog.md (doc-N /
  decision-N, правило 13)
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
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
- [ ] #1 createProjectDoc генерирует следующий свободный id (doc-N / decision-N), имя файла `doc-N - Title-Slug.md` / `decision-N - Title-Slug.md` и frontmatter по стандарту (id, title, type, created_date / id, title, date, status)
- [ ] #2 listProjectDocs использует id из frontmatter, если он есть
- [ ] #3 Созданный через GUI документ проходит npm run lint:docs и отображается в веб-интерфейсе Backlog.md
- [ ] #4 Опционально: при наличии backlog.md CLI в проекте создание делегируется команде backlog doc create / decision create
<!-- AC:END -->
