---
id: doc-9
title: Контекст проекта и состояние системы (Context Dump)
type: specification
created_date: '2026-09-10 04:30'
tags:
  - context
  - architecture
  - project-hub
  - status
  - git
---
# ProjectHub — Контекст проекта и состояние системы

> **Дата создания / обновления**: "2026-09-10"  
> **Статус**: Все базовые и продвинутые модули (включая Swarm Arena, Remote Control, Git Worktrees) реализованы и протестированы. Проект успешно собирается (`npm run pack:win`).  
> **Назначение**: Единая десктопная панель управления проектами (по аналогии со SourceTree / GitHub Desktop), стандартизированными по шаблону `ProjectTemplate` (`Backlog.md`, `Git`, `Vector RAG`, `MCP`, `Env-tools`).

---

## 1. Обзор проекта (Executive Summary)

**ProjectHub** — это автономное мультиплатформенное десктопное приложение (Desktop Dashboard / Control Center), решающее проблему разрозненного управления множеством локальных проектов с AI-агентной инфраструктурой.

Каждый проект пользователя содержит обвязку на базе `ProjectTemplate`:
- `backlog/` — файловая система управления задачами, майлстоунами, решениями (ADR) и документацией (`Backlog.md`).
- `scripts/rag/` — коммитимый векторный поиск по документации (LanceDB + HuggingFace Transformers).
- `scripts/env/` — менеджер фоновых локальных процессов и dev-серверов.
- `.agents/` и `.claude/` — правила, скиллы и конфигурация MCP-серверов для AI-агентов (Antigravity, Claude Code).

**ProjectHub** объединяет все эти проекты в единый графический интерфейс без необходимости держать открытыми десятки вкладок браузера или консолей.

---

## 2. Реализованные функциональные блоки

1. **Каркас Electron + Vite + React 19 + TypeScript + Tailwind CSS v4** (`task-1`).
2. **Модуль сканирования и каталога проектов (Project Discovery & Registry)** (`task-2`): сканирование каталогов, добавление корней, определение структуры `ProjectTemplate`.
3. **Интерактивная доска задач и просмотрщик Backlog** (`task-3`): Канбан (To Do, In Progress, Review, Done), табличный список, модальное окно задачи с чеклистом Acceptance Criteria.
4. **Мастер создания нового проекта из шаблона (Project Template Wizard)** (`task-4`): генерация новых проектов из ProjectTemplate, выбор фич, запуск `setup.mjs`.
5. **Менеджер фоновых процессов и живой терминал логов** (`task-5`): запуск/остановка dev-серверов, потоковый вывод stdout/stderr в интерактивную панель терминала.
6. **Модуль глобального и локального RAG-поиска (Vector RAG Search)** (`task-6`): поиск по векторной базе знаний LanceDB, быстрый поиск `Ctrl+K`.
7. **Модуль визуализации Git-репозитория** (`task-7`): граф коммитов, ветки, стэш, diff viewer, stage/unstage, создание коммитов с привязкой к Backlog.
8. **Модуль интеграции и управления Pull & Merge Requests** (`task-8`): поддержка GitHub CLI / GitLab, создание и просмотр PR, диффы и синхронизация статусов задач.
9. **Модуль управления ADR и документацией** (`task-9`): просмотр и создание Architecture Decision Records (`backlog/decisions/*.md`) и документации (`backlog/docs/*.md`) со встроенным Markdown-редактором.
10. **Модуль управления майлстоунами и дорожной картой проекта (Milestones & Roadmap)** (`task-10`): прогресс-бары этапов, привязка задач к майлстоунам, фильтрация на доске.
11. **Глобальные горячие клавиши и модальное окно справки** (`task-11`): `Ctrl+K`, `Ctrl+B`, `Ctrl+M`, `Ctrl+G`, `Ctrl+P`, `Ctrl+D`, `Ctrl+\`, `Ctrl+R`, модалка `?` / `F1`.
12. **Сводная аналитика и активность проекта (Project Analytics Dashboard)** (`task-12`): полноэкранная вкладка в рабочей области проекта с графиками готовности задач, Acceptance Criteria, контрибьюторами Git, распределением тегов, майлстоунами и статистикой LanceDB (`Ctrl+A`).
13. **AI-ассистент генерации описаний задач, коммитов и PR** (`task-13`): интеграция с локальной Ollama и встроенными шаблонами в `TaskDetailModal`, `GitInspector` and `CreatePRModal`.
14. **Встроенный интерактивный мульти-терминал с поддержкой Claude Code и авто-отслеживанием Git** (`task-14`): полнофункциональный встроенный PTY-терминал (`node-pty` / `xterm.js`) с параллельными сессиями Claude Code и Shell в директории каждого проекта (`cwd`), горячей кнопкой в шапке, мульти-вкладками и авто-синхронизацией списка незакоммиченных файлов на вкладке Git в реальном времени.
15. **Графическая панель AI-ассистента (Claude AI Studio & Multi-Provider Agent)** (`task-15`): встроенный полноэкранный GUI-ассистент с прямой поддержкой Anthropic Claude 3.7 Sonnet, OpenRouter, DeepSeek V3/R1, локальной Ollama и Custom OpenAI-совместимых эндпоинтов. Поддерживает интерактивные карточки Tool Use с генерацией построчных визуальных Diff изменений файлов, кнопки Принять/Отклонить правки, контекстные теги (`@Task`, `@GitStatus`, `@Docs`) и быструю навигацию по `Ctrl+I`.
16. **Система мультиязычности и локализации (i18n)** (`task-16`): поддержка интерфейса на английском языке по умолчанию (`en`) и на русском (`ru`) с мгновенным переключением в шапке и сохранением настроек в `localStorage`.
17. **Брендовая айдентика и сборка**: Сгенерирована официальная иконка (Neon Cyber Nexus) без рамок и надписей с повышенным контрастом в многослойном `.ico` и `.png` (256/128/64/48/32/16px), настроена иконка исполняемого файла `.exe`, заголовок окна и логотип в приложении.
18. **Стандарты документации Backlog.md и вставки изображений**: Введена строгая валидация формата документов (`doc-<id> - <Title>.md`) и решений (`decision-<id> - <Title>.md`), а также единые стандарты вставки изображений (`infra-dev.md`, Правила 13 и 15).
19. **Обязательная быстрая сборка распакованного десктопного приложения**: Введено Правило 14 (`infra-dev.md`), предписывающее собирать распакованный бинарник `release/win-unpacked/ProjectHub.exe` (`npm run pack:win`) без медленной портабл-упаковки.
20. **Комплексное ревью, аудит безопасности и внедрение модулей v2.0** (`doc-6`): Реализованы и протестированы все 5 ключевых модулей нового поколения:
    - **Git Diffs & Branches**: Менеджер веток, построчный Split/Unified Diff Viewer с подсветкой.
    - **Action Runner (Run / Deploy / Test)**: Конфигурируемые кнопки быстрого запуска с сохранением настроек в `.projecthub.json`.
    - **Интерактивный File Explorer с Git-индикацией**: Дерево файлов с бейджами изменений и быстрым редактором.
    - **ProjectHub Native MCP Server**: Встроенный HTTP/SSE сервер MCP (`electron/services/mcpServerService.ts`).
    - **Голосовое управление (Voice Control STT/TTS)**: Распознавание речи, голосовые команды и плавающий виджет.
21. **Модуль удаленного управления (Remote Control: Server Relay & WebRTC P2P)** (`task-51`): E2EE шифрование, WebRTC P2P + WebSocket Relay, мобильное SPA-клиент и виджет с QR-кодом.
22. **Оркестрация параллельной работы разнородных AI-агентов (Multi-Agent Swarm, Fan-Out, Arena и Handoff)** (`task-54`):
    - `AgentFleetService` (`electron/services/agentFleetService.ts`) — координатор параллельного (Fan-Out) и конвейерного (Handoff) выполнения задач CLI и API-агентами.
    - Автоматическая изоляция каждого агента в выделенном Git Worktree (`.worktrees/swarm-<id>-<slotId>`, ветка `swarm/<id>/<agentSlug>`).
    - Состязательный экран Side-by-Side Swarm Arena (`SwarmArenaView.tsx`): параллельный просмотр статусов, метрик, потоковых логов и цветных диффов.
    - Функция Pick Winner в 1 клик со слиянием ветки и очисткой временных каталогов.
23. **Контекст для агента и обратная связь задача↔PR/worktree** (`task-64`, decision-18):
    - `contextBuilder` (`electron/services/contextBuilder.ts`) — единая сборка контекста задачи (заголовок, описание, AC), релевантных чанков `docs-rag` и связанного кода GitNexus в системный промпт агента для всех движков (Claude CLI, Codex, Gemini, API) через один канал `--append-system-prompt`/`extraSystemPrompt`.
    - GitNexus подключён как MCP-сервер проекта (`.mcp.json`, `.agents/mcp_config.json`, `scripts/setup.mjs`, фича `gitnexus`, включена по умолчанию).
    - AI Studio показывает подставленный контекст (карточка) и позволяет отключать его части на сессию.
    - После создания worktree/PR в frontmatter задачи автоматически появляются `branch`, `worktree`, `pr` — `TaskDetailModal` показывает их ссылками.

---

## 3. Выбранный технологический стек

- **Платформа десктопа**: **Electron + Vite + React 19 + TypeScript**
- **Git & Diff Движок**: **simple-git** + кастомный синтаксический Split/Unified diff-парсер + **Git Worktrees**.
- **Стилизация и UI-система**: **Tailwind CSS v4 + Lucide React Icons** (премиальный темный интерфейс).
- **Управление состоянием**: **Zustand** (хранилище проектов, задач, майлстоунов, PR, процессов, логов и мульти-агентных роев `useSwarmStore`).
- **RAG & AI**: **LanceDB** + локальный коннектор **Ollama** + Claude AI Studio + **Agent Fleet Swarm Orchestrator**.
- **Voice & Multimodal (v2.0)**: **Web Speech API** (STT) + **SpeechSynthesis** (TTS) с парсером команд.
- **Ecosystem & Interoperability (v2.0)**: **ProjectHub Native MCP Server** (`@modelcontextprotocol/sdk`).
- **Remote Control & P2P**: **WebRTC DataChannel**, **WebSocket Relay** (`ws`), **E2EE (AES-256-GCM / Web Crypto)**.
