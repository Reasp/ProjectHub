---
name: feedback-docs-inside-backlog
description: Документация проекта живёт внутри backlog/docs и backlog/decisions, без отдельной верхнеуровневой docs/
metadata:
  type: project
---

В `ProjectTemplate` (и, по умолчанию, в любом проекте, разворачиваемом через
`init-dev-project`) документация **не** размещается в отдельной верхнеуровневой `docs/`.
Она целиком живёт внутри `backlog/` — `backlog/docs/` (гайды, дизайн-доки) и
`backlog/decisions/` (архитектурные решения), рядом с задачами Backlog.md.

**Why:** пользователь явно попросил ("docs надо делать внутри папки backlog") после того,
как заметил, что в шаблоне завелась отдельная `docs/` параллельно с `backlog/`. Причина —
Backlog.md уже предоставляет структуру для документации (`backlog/docs/`,
`backlog/decisions/`), и дублировать её отдельной папкой не нужно.

**How to apply:** `DOC_ROOTS` в `scripts/rag/index-docs.mjs` и `scripts/lightrag/common.py` —
только `['backlog/docs', 'backlog/decisions']`, без `'docs'`. `init-dev-project`
(`.claude/skills/init-dev-project/SKILL.md`) копирует служебные доки инфраструктуры
(например `rag-guide.md`) в `backlog/docs/` **корня проекта** (после `backlog init`), а не
в отдельную `docs/`. Если в существующем проекте, куда накатывается инфраструктура, уже
есть своя `docs/` — не переносить её принудительно, но не заводить новую `docs/` от лица
этой инфраструктуры.
