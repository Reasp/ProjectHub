---
title: "Сравнительный анализ и выбор технологического стека ProjectHub"
tags: ["tech-stack", "electron", "tauri", "comparison", "decision"]
---

# Сравнительный анализ и выбор технологического стека ProjectHub

## 1. Контекст и Технические Требования

Для реализации **ProjectHub** требуется выбрать стек, удовлетворяющий следующим критериям:
1. **Автономность и мультиплатформенность**: Работа на Windows, macOS и Linux без необходимости запуска внешнего веб-браузера.
2. **Прямой доступ к файловой системе и процессам**: Чтение/запись markdown-файлов задач (`backlog/`), запуск дочерних процессов (`node scripts/setup.mjs`, dev-серверов), сбор логов stdout/stderr.
3. **Бесшовная интеграция с экосистемой Node.js и `ProjectTemplate`**: В шаблоне уже написаны скрипты на Node.js (`scripts/setup.mjs`, `scripts/rag/`, `@modelcontextprotocol/sdk`, `@lancedb/lancedb`, `gray-matter`, `zod`). Важно иметь возможность либо напрямую переиспользовать этот код, либо вызывать его без лишних накладных расходов.
4. **Высокая скорость разработки и богатый UI**: Поддержка современного React/TypeScript, современных компонентов UI, Drag-and-Drop, Markdown-редакторов и подсветки терминала.

---

## 2. Сравнение архитектурных платформ

| Критерий | Вариант 1: **Electron + Vite + React** | Вариант 2: **Tauri 2.0 (Rust + React)** | Вариант 3: **Wails (Go + React)** | Вариант 4: **Web-сервер + Браузер** |
|---|---|---|---|---|
| **Интеграция с Node.js** | **Нативная 100%**: Прямой вызов всех npm-пакетов, `@lancedb/lancedb`, `@modelcontextprotocol/sdk` в Main-процессе | **Ограниченная**: Требует Node.js/Bun Sidecar или переписывания логики на Rust | **Ограниченная**: Требует запуска Node CLI или переписывания на Go | **Нативная**, но требует запущенного браузера |
| **Автономность (No external browser)** | Да, единое окно приложения | Да, единое окно приложения | Да, единое окно приложения | Нет, открывается вкладка в Chrome/Edge |
| **Управление процессами и терминалом** | Отличное (`node:child_process`, `node-pty`) | Хорошее (через Rust `std::process`) | Хорошее (через Go `os/exec`) | Среднее (через WebSocket) |
| **Потребление ресурсов (RAM/Диск)** | ~80-120 МБ RAM, дистрибутив ~80 МБ | ~30-50 МБ RAM, дистрибутив ~15 МБ | ~40-60 МБ RAM, дистрибутив ~20 МБ | Зависит от браузера |
| **Сложность разработки и сборки** | **Низкая**: Один язык (TypeScript) для всего стека, стандартный `npm run build` | **Высокая**: Требует компилятора Rust (Cargo, MSVC Build Tools) на машине | **Средняя**: Требует Go компилятора | **Низкая** |
| **Кроссплатформенность** | Windows (x64/arm64), macOS, Linux | Windows, macOS, Linux, Mobile | Windows, macOS, Linux | Любая платформа с браузером |

---

## 3. Выбор оптимального стека: **Electron + Vite + React 19 + TypeScript**

### Почему именно этот стек?

1. **Единая экосистема TypeScript / Node.js**:
   Вся кодовая база `ProjectTemplate` (скрипты настройки, парсеры бэклога, MCP-серверы, LanceDB RAG) написана на чистом современном Node.js (ESM). Использование Electron позволяет импортировать эти модули напрямую в бэкенде приложения (`electron/main/`) без необходимости создавать сторонние бинарные прослойки или дублировать логику на Rust/Go.

2. **Стабильное управление дочерними процессами и логированием**:
   Встроенный модуль `node:child_process` и библиотека `node-pty` / `tree-kill` идеально подходят для управления dev-серверами проектов, фоновыми задачами, перехватом стримов вывода и контролем PID на всех ОС (включая Windows Process Tree).

3. **Богатая экосистема UI-компонентов**:
   - **React 19 + TypeScript**: Максимальная надежность типизации интерфейса.
   - **Tailwind CSS v4**: Быстрая верстка современного темного адаптивного UI.
   - **Lucide Icons**: Полный набор векторных иконок для статусов, файлов, репозиториев и процессов.
   - **@dnd-kit** или **@hello-pangea/dnd**: Плавный drag-and-drop для Канбан-доски.
   - **xterm.js**: Полноценный терминал прямо внутри приложения для просмотра логов dev-серверов.
   - **@uiw/react-md-editor**: Удобный визуальный редактор задач и документации.
   - **Zustand + TanStack Query**: Эффективное локальное состояние и отслеживание изменений файлов через `chokidar`.

---

## 4. Архитектурный стек компонентов

```
+-------------------------------------------------------------------------------+
| FRONTEND / RENDERER (React 19, TypeScript, Vite)                              |
| - Tailwind CSS v4 (Dark Theme & Glassmorphism)                                |
| - State Management: Zustand (UI state) + TanStack Query (FileSystem caching)   |
| - Drag & Drop: @dnd-kit (Kanban board)                                        |
| - Terminal / Log Output: @xterm/xterm                                         |
| - Markdown: react-markdown + remark-gfm + rehype-highlight                    |
+-------------------------------------------------------------------------------+
                                    ▲  │
                         IPC Events │  │ IPC Calls (contextBridge)
                                    │  ▼
+-------------------------------------------------------------------------------+
| BACKEND / MAIN PROCESS (Node.js 20+, Electron, TypeScript)                    |
| - Project Scanner & Registry (fs/promises, globby)                            |
| - Backlog Engine (gray-matter, zod, YAML serializer)                          |
| - Process Manager Daemon (node:child_process, pid-tree, tree-kill)            |
| - Template Scaffolder (fse, degit, template copier)                           |
| - RAG Query Engine (@lancedb/lancedb, @huggingface/transformers)              |
| - File Watcher (chokidar for instant UI updates when .md files change)        |
+-------------------------------------------------------------------------------+
```
