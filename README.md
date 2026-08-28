# ProjectHub 🚀

> **Единая десктопная панель управления проектами, Git-репозиториями и AI-агентной инфраструктурой**  
> *Все проекты, задачи Backlog.md, история Git, Pull/Merge Requests, процессы dev-серверов и база знаний RAG в одном нативном окне.*

---

## 📌 О концепте

**ProjectHub** — это десктопное мультиплатформенное приложение (по аналогии со **SourceTree** или **GitHub Desktop**, но сфокусированное на проектном управлении, задачах, контроле версий и агентной инфраструктуре), предназначенное для объединения всех локальных проектов, созданных по стандарту `ProjectTemplate`.

### Главные возможности:

1. 📂 **Каталог и сканер проектов (Project Discovery)**:
   - Автоматическое обнаружение проектов со структурой `ProjectTemplate` на дисках (`F:\`, `D:\Projects` и др.).
   - Отображение карточек проектов: текущая ветка Git, статус ahead/behind, незакоммиченные файлы, статус dev-серверов, RAG-индекса и бэклога задач.

2. 📋 **Интерактивная доска задач (Backlog & Kanban)**:
   - Визуальное управление задачами (`To Do` → `In Progress` → `Review` → `Done`) без необходимости запуска браузера.
   - Drag-and-drop перемещение задач с мгновенным обновлением `.md` файлов в каталоге `backlog/tasks/`.
   - Редактирование описаний, критериев приемки (Acceptance Criteria), майлстоунов и тегов.

3. 🌿 **Встроенный Git-инспектор (Git Graph & Diff Inspector)**:
   - Наглядный граф истории коммитов с ветками и тегами (как в SourceTree).
   - Инспектор изменений рабочей директории (Working Copy Diff) с подсветкой синтаксиса (Unified / Split diff).
   - Создание веток под задачи Backlog в один клик (например, `feat/task-3`).
   - Коммиты с автопривязкой к ID задачи.

4. 🔀 **Центр Pull & Merge Requests (PR Hub & Code Review)**:
   - Интеграция с GitHub и GitLab API.
   - Просмотр списка открытых PR, статусов CI/CD проверок, комментариев и диффов.
   - Создание PR из ветки задачи в один клик с автогенерацией описания из `task-N.md`.
   - Автоматический перевод задачи в `Review` при открытии PR и в `Done` при слиянии (merge).

5. ⚡ **Мастер создания новых проектов (Template Wizard)**:
   - Инициализация нового проекта из `ProjectTemplate` в 1 клик.
   - Выбор каталога, имени, переключение опциональных модулей (`docsRag`, `envTools`, `backlogMcp`, `bootstrap`, `lightrag`).
   - Автоматический запуск скриптов настройки (`setup.mjs`), инициализация git и регистрация проекта в Hub.

6. 🖥️ **Менеджер процессов и терминал (Process Manager & Live Logs)**:
   - Старт, остановка и перезапуск dev-серверов и скриптов прямо из карточки проекта.
   - Встроенная консоль реального времени (`xterm.js`) с ANSI-подсветкой вывода.
   - Защита от зависших портов и фоновых процессов при перезапуске (`tree-kill`).

7. 🔍 **Единая база знаний и семантический RAG-поиск (Unified RAG)**:
   - Быстрый доступ к документации (`backlog/docs/`) и архитектурным решениям (`backlog/decisions/`).
   - Векторный смысловой поиск (`Ctrl + K`) по базе знаний выбранного проекта или по всем проектам сразу через LanceDB.

---

## 🛠️ Технологический стек

- **Десктопная платформа**: [Electron](https://www.electronjs.org/) + [Vite](https://vitejs.dev/)
- **Интерфейс (Renderer)**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Стилизация**: [Tailwind CSS v4](https://tailwindcss.com/) (темная тема, glassmorphism) + [Lucide Icons](https://lucide.dev/)
- **Git & Diff Движок**: `simple-git` + `@git-diff-view/react` / `monaco-diff-editor`
- **PR Интеграции**: `@octokit/rest` + GitLab REST API
- **Канбан & Drag-and-Drop**: `@dnd-kit`
- **Терминал & Логирование**: `@xterm/xterm` + `tree-kill` + `node:child_process`
- **Парсинг задач и Markdown**: `gray-matter` + `zod` + `react-markdown`
- **Семантический поиск**: `@lancedb/lancedb` + `@huggingface/transformers`

---

## 📁 Структура репозитория

```
ProjectHub/
├── .agents/                    # Конфигурация и скиллы для Google Antigravity
│   ├── rules/infra-dev.md      # Единые правила работы с инфраструктурой
│   ├── skills/init-dev-project # Скилл инициализации проектов
│   └── mcp_config.json         # MCP-серверы для Antigravity
├── .claude/                    # Конфигурация для Claude Code
├── backlog/                    # Задачи, документация и решения ProjectHub
│   ├── config.yml              # Настройки Backlog
│   ├── tasks/                  # Задачи по разработке ProjectHub (task-1 .. task-8)
│   ├── decisions/              # Архитектурные решения (ADR-0001)
│   └── docs/                   # Концепция, анализ стека и руководства
├── scripts/                    # Инфраструктурные скрипты (RAG, Env, Setup)
│   ├── env/                    # Менеджер процессов env-tools
│   ├── rag/                    # Векторный индекс документации LanceDB
│   ├── setup.mjs               # Настройка проекта и MCP
│   └── sync-agent-rules.mjs    # Синхронизация правил агентов
├── contextdump.md              # Состояние контекста и архитектуры проекта
├── infra.config.json           # Включенные модули инфраструктуры
└── package.json                # Манифест проекта
```

---

## 📖 Документация проекта

- [Концепция и детальные требования](file:///F:/ProjectHub/backlog/docs/architecture-concept.md)
- [Сравнительный анализ технологического стека](file:///F:/ProjectHub/backlog/docs/tech-stack-analysis.md)
- [ADR-0001: Выбор архитектуры и стека](file:///F:/ProjectHub/backlog/decisions/0001-projecthub-architecture-and-stack.md)
- [Файл контекста проекта contextdump.md](file:///F:/ProjectHub/contextdump.md)
