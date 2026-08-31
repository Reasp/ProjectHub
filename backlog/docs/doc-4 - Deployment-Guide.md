---
id: doc-4
title: "Инструкция по развертыванию инфраструктуры проекта"
type: guide
created_date: "2026-08-28 12:00"
---

# Как развернуть инфраструктуру на новом проекте

Это пошаговая инструкция для человека. Если разворачивает AI-агент (Google Antigravity, Claude Code и т.п.) — у него есть skill `init-dev-project`, он делает то же самое автоматически через `AskUserQuestion` и свои инструменты.

---

## 0. Предварительные требования

- **Git** и **Node.js 18+** — обязательны, без них не работает инфраструктура.
- Остальное (Python, Go, Rust, конкретный пакетный менеджер) — по потребности проекта, ставится через `npm run bootstrap`.

---

## 1. Конфигурация расположения

1. **Инфраструктура — это корень проекта, или подпапка?**
   - Обычный случай — корень (весь проект = шаблон + код).
   - Подпапка — если есть существующий проект и инфраструктура добавляется рядом (например, `my-project/dev-infra/`).
2. **Нужен ли LightRAG?**
   - Это опциональная тяжелая фича (Python + локальная LLM через Ollama). По умолчанию выключена.

---

## 2. Копирование файлов шаблона

Скопируйте из `ProjectTemplate` в целевую директорию:

```
infra-dev.md
scripts/config.mjs
scripts/setup.mjs
scripts/sync-agent-rules.mjs
scripts/web.mjs
scripts/rag/
scripts/env/
scripts/bootstrap/
start-web.bat
start-web.sh
package.json
.gitignore
```

---

## 3. Инициализация Git и Backlog.md

В корне проекта выполните:

```bash
git init
npx --yes backlog.md init "<Имя проекта>" --agent-instructions agents --defaults
```

Вся документация проекта сохраняется строго внутри `backlog/docs/` (в формате `doc-<id> - <Title>.md`) и `backlog/decisions/` (в формате `decision-<id> - <Title>.md`).

---

## 4. Настройка и установка

```bash
node scripts/setup.mjs
npm install
node scripts/bootstrap/bootstrap.mjs
npm run index-docs
node scripts/sync-agent-rules.mjs
```

---

## 5. Проверка работы

- Запустите веб-интерфейс: `node scripts/web.mjs start`
- Выполните поиск по документации: `npm run rag-search -- "архитектура"`
