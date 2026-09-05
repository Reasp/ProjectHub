---
id: doc-7
title: >-
  Технический аудит ProjectHub: стабильность, утечки, производительность,
  безопасность
type: specification
created_date: '2026-09-05 09:06'
tags:
  - audit
  - security
  - performance
  - memory-leaks
  - refactoring
  - roadmap
---
# Технический аудит ProjectHub (сентябрь 2026)

> **Дата**: 2026-09-05
> **Область**: `electron/` (main-процесс, сервисы, preload), `src/` (рендерер, стор, сервисы), сборка и инфраструктура.
> **Метод**: полное чтение main-процесса и всех сервисов, стора и ключевых компонентов рендерера, `tsc --noEmit` (проходит без ошибок), grep-проверки таймеров/подписок/нативных диалогов/`any`, проверка инфраструктуры (RAG-индекс, MCP-конфиги).
> **Не проверялось вручную**: поведение в упакованном `.exe` при запуске из каталога без прав на запись, macOS-сборка, реальный вывод `claude -p /usage`.

Каждый пункт имеет метку приоритета: **P0** (краш / уязвимость / потеря данных), **P1** (утечка, серьёзная деградация, сломанная фича), **P2** (оптимизация, качество, доделки).

---

## 1. Крашы и стабильность main-процесса

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 1.1 | P0 | `electron/services/claudeBridgeService.ts` (`runClaudeCliTask`) | `child.stdin.write()` выполняется сразу после `spawn('claude', ..., {shell:true})`. Если `claude` не установлен или оболочка завершилась мгновенно, на `stdin` приходит событие `error` (EPIPE), у которого нет обработчика. Необработанное `error` на стриме валит **весь main-процесс**. Нужен `child.stdin.on('error')` и проверка доступности CLI до запуска. |
| 1.2 | P0 | `electron/main.ts` (`ai:streamChat`) | `claudeBridgeService.runAgentTask(...)` вызывается без `await` и без `.catch()`. Любое исключение вне внутреннего `try` становится unhandled rejection. |
| 1.3 | P1 | `claudeBridgeService.requestApproval` | Промис ожидания одобрения никогда не отклоняется: при `abortSession`, закрытии сессии или окна `runAgentTask` висит навсегда, статус проекта остаётся `waiting_approval`, замыкание держит все сообщения сессии в памяти. |
| 1.4 | P1 | `claudeBridgeService.executeSubprocess` | Нет таймаута и нет ограничения размера вывода. Если агент запускает `npm run dev`, цикл агента зависает навсегда, а `output` растёт без предела. |
| 1.5 | P1 | `electron/services/localWhisperService.ts` | При выходе воркера с ненулевым кодом уже в статусе `ready` воркер обнуляется, статус остаётся `ready`, `fallbackPipeline` равен `null`. Все последующие `transcribe` бросают «pipeline is initializing» навсегда. Также `pendingJobs` не сбрасываются при событии `exit` (только при `error`). |
| 1.6 | P1 | `electron/services/mcpServerService.ts` (`start`) | При `EADDRINUSE` порт инкрементируется бесконечно, а `resolve` не вызывается до успеха. Отсутствует верхняя граница попыток. |
| 1.7 | P2 | `electron/main.ts` (`console-message`) | Используется устаревшая позиционная сигнатура обработчика. В Electron 44 событие передаёт объект `details`, лог печатает `undefined`. Требует проверки. |
| 1.8 | P2 | `aiAgentService.ensureConfigDir`, `secretStorageService.ensureDir` | `fs.mkdir` из `fs/promises` вызывается внутри `try` без `await`. Ошибка не ловится, а становится unhandled rejection. |

## 2. Утечки памяти и ресурсов

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 2.1 | P1 | `electron/services/processManager.ts` | `activeProcesses` никогда не очищается после завершения процесса. Каждый элемент держит `logBuffer` до 2000 **чанков** (не строк), чанк может быть до 64 КБ, то есть до ~128 МБ на процесс. |
| 2.2 | P1 | `electron/services/gitService.ts` | Вотчер chokidar создаётся на каждый открытый проект (корень проекта, `depth: 3`) и никогда не закрывается: `unwatchProjectGit` нигде не вызывается. Открыл 20 проектов за сессию, получил 20 вотчеров. Список `ignored` неполный (`venv`, `target`, `build`, `coverage`, `.next`, `__pycache__`). |
| 2.3 | P1 | `claudeBridgeService` | `activeSubagents` (подагенты никогда не переводятся в `completed` и не удаляются), `sessionClaudeCliIds` (метод `clearSession` есть, но не вызывается из IPC) и `projectStatuses` растут без ограничений. |
| 2.4 | P1 | `src/store/useProjectStore.ts` | `terminalLogs` растёт без ограничений (`addTerminalLog` не обрезает массив). `TerminalPanel` при каждом изменении делает `clear()` и повторно пишет все строки в xterm, то есть стоимость O(n) на каждое событие, суммарно квадратичная. Вотчер git пишет в этот лог при каждом изменении файла. |
| 2.5 | P1 | `src/store/useProjectStore.ts` (`projectDataCache`) | Кэш проектов не вытесняется. Каждая `BacklogTask` хранит и `content`, и `description` (дубль полного текста файла). Нужен LRU или хотя бы очистка при `deactivateProject` и отказ от `content` в списке. |
| 2.6 | P2 | `localWhisperService.transcribe` | На каждую транскрипцию создаётся `setTimeout(30s)`, который не очищается при успешном ответе. |
| 2.7 | P2 | `electron/services/ptyService.ts` | Завершившиеся PTY-сессии остаются в `sessions` до ручного закрытия вкладки; каждая вкладка держит xterm с буфером 5000 строк. Приемлемо, но стоит автоматически убирать сессии со статусом `exited` через таймаут. |
| 2.8 | P2 | `src/components/**` | 26 `setTimeout` в компонентах без очистки в cleanup (GitInspector, DocsRagView, FileExplorer, App `showRemoteToast`, VoiceControlWidget). Побочный эффект: `setState` после размонтирования, «залипающие» уведомления. |

## 3. Производительность

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 3.1 | P1 | `src/store/useAIStudioStore.ts` | Стор обёрнут в `persist`; на **каждый стриминговый чанк** (по токену) весь объект `sessions` всех проектов сериализуется в `localStorage`. В сессиях хранятся `toolCalls` с `diff.oldContent/newContent` и полным выводом команд. Это гарантированный лаг при стриминге и переполнение квоты `localStorage` (5–10 МБ), после которого persist молча перестаёт сохранять и история теряется. Нужно: дебаунс записи, хранение истории в файле через main (`~/.projecthub/sessions/`), обрезка тяжёлых полей. |
| 3.2 | P1 | `src/components/voice/VoiceControlWidget.tsx` | Главный `useEffect` зависит от `sessions`, `pendingApprovals`, `projects` и т.п. Во время стриминга он пересоздаёт 7 подписок на каждый чанк и вызывает `voiceService.setLanguage` → `saveConfig` → `localStorage.setItem`. Нужно перенести изменяемые данные в `useRef`, подписки создавать один раз. |
| 3.3 | P1 | `gitService.watchProjectGit` + `useProjectStore.loadGitRepoDetails` | Любое изменение файла в проекте (сборка, `npm install`, вывод логов) через 400 мс запускает 6 git-команд (`status`, `branchLocal`, `log 50`, `tags`, `stashList`, `branch -a`). Во время сборки это шторм процессов git. Нужен более длинный дебаунс, фильтрация по путям (только `.git/HEAD|index|refs` и отслеживаемые файлы) и обновление только активной вкладки. |
| 3.4 | P1 | `electron/main.ts` (`projects:list`) + `projectScanner.inspectProject` | На старте для каждого проекта последовательно выполняются `git status`, `git log`, чтение всех файлов задач и парсинг frontmatter. Для 20+ проектов старт занимает секунды. Нужны параллелизм с лимитом, кэш по mtime и ленивое вычисление git-статуса. |
| 3.5 | P1 | `electron/preload.ts` (`transcribeLocalWhisper`) | `Float32Array` конвертируется в обычный массив чисел (`Array.from`) перед IPC: 12 с речи = 192 000 чисел, структурное клонирование в main, затем снова копия в воркер. Structured clone поддерживает `Float32Array`; в воркер можно передавать через `transferList`. |
| 3.6 | P1 | `src/services/voiceService.ts` | Используется устаревший `ScriptProcessorNode` (обработка на главном потоке рендерера, буфер 4096). Замена на `AudioWorklet` уберёт джиттер интерфейса при включённом hands-free. `resampleTo16k` аллоцирует новый массив на каждый чанк. |
| 3.7 | P2 | `localWhisperService.initBackground()` в `app.whenReady` | Модель Whisper (~150 МБ RAM, загрузка ONNX) поднимается на каждом старте приложения, даже если голосовое управление не используется (задача 27 требует старта в `idle`). Загружать лениво при первом включении hands-free. |
| 3.8 | P2 | `electron/services/ragSearch.ts` | Transformers и LanceDB загружаются в main-процесс; эмбеддинг запроса блокирует event loop. Кандидат на `utilityProcess`. |
| 3.9 | P2 | `McpServerStatusBadge` (5 с), `ClaudeUsageButton` (120 с) | Постоянные `setInterval` даже когда вкладка не видна; `claudeUsageService` каждые 45 с спаунит процесс `claude -p /usage`. Заменить на push-события из main (`mcp:statusChanged`) и опрос только при открытой модалке. |
| 3.10 | P2 | `src/components/terminal/TerminalPanel.tsx` | `handleMouseDown` обновляет `terminalHeight` в глобальном сторе на каждый `mousemove`, что перерисовывает всю панель и все xterm-вкладки. Хранить высоту локально во время перетаскивания, сохранять в стор на `mouseup`. |

## 4. Безопасность

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 4.1 | P0 | `electron/services/mcpServerService.ts` | Токен генерируется и показывается в UI, но **нигде не проверяется**: ни `/sse`, ни `/message`, ни `/api/action` не смотрят на `Authorization`. При этом CORS отражает любой `Origin`. Любая веб-страница в браузере пользователя может через `fetch` на `127.0.0.1:42042` вызвать `projecthub_run_process` и выполнить произвольную команду. Кроме того, `/mcp.json` отдаёт токен без аутентификации. Нужно: обязательная проверка Bearer-токена на всех маршрутах, запрет CORS для внешних origin, выдача `/mcp.json` только из UI. |
| 4.2 | P0 | `electron/main.ts` (`createWindow`) | Нет `setWindowOpenHandler` и обработчика `will-navigate`. Любая ссылка `target="_blank"` в `MarkdownViewer` (документ, задача, ответ LLM) открывает произвольный сайт в новом окне Electron, которое наследует preload и получает доступ к `window.api` (запуск процессов, запись файлов). Нужно: `setWindowOpenHandler` → `shell.openExternal` + `deny`, блокировка навигации. |
| 4.3 | P0 | `src/components/common/MermaidDiagram.tsx` + `MarkdownViewer` | `mermaid.initialize({ securityLevel: 'loose' })` и вставка SVG через `dangerouslySetInnerHTML`. Mermaid-блок в ответе агента или в markdown-файле проекта может выполнить JS в рендерере (XSS) и дальше вызвать `window.api.startProcess`. Использовать `securityLevel: 'strict'` и санитайзер (DOMPurify). Также в `index.html` отсутствует Content-Security-Policy, `sandbox: false`. |
| 4.4 | P1 | `electron/main.ts` (`setPermissionRequestHandler`) | Все permission-запросы (`callback(true)`) и `setPermissionCheckHandler` → `true` для любых разрешений и любых webContents. Достаточно разрешить только `media` для собственных окон. |
| 4.5 | P1 | `docs:read/save`, `backlog:*`, `milestones:*` IPC | Принимают абсолютный `filePath` от рендерера без проверки принадлежности проекту. Совместно с 4.2/4.3 это даёт чтение/запись любого файла пользователя. Валидировать путь против списка зарегистрированных проектов. |
| 4.6 | P1 | `aiAgentService.applyDiff`, `claudeBridgeService` (`write_file`) | Модель может передать абсолютный путь, и при включённом auto-approve файл будет записан в любое место диска. Ограничить запись корнем проекта. |
| 4.7 | P2 | `fileService.validateSafePath` | Проверка `resolved.startsWith(root)` без разделителя: корень `C:\Projects\App` пропускает `C:\Projects\App2\...`. Сравнивать с `root + path.sep` или через `path.relative`. |
| 4.8 | P2 | `src/services/voiceService.ts` (`transcribePcmWithCloud`) | Ключ из `projecthub-ai-studio-storage` (ключ Anthropic/DeepSeek) подставляется как Bearer к Groq/OpenAI. Сейчас поле всегда `undefined` из-за `partialize`, но код ошибочен: утечка ключа одного провайдера другому. Удалить fallback. |
| 4.9 | P2 | `secretStorageService.encrypt` | При недоступности `safeStorage` ключ пишется в файл открытым текстом без предупреждения пользователю. |

## 5. Функциональные баги и несовместимость с Backlog.md

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 5.1 | P0 | `electron/main.ts` (`backlog:saveFullTask`, `backlog:createTask`, `backlog:toggleCriterion`) | Формат файлов задач не совместим с нативным Backlog.md (см. `task-27`): сохранение из TaskDetailModal стирает маркеры `<!-- SECTION:DESCRIPTION:BEGIN/END -->`, `<!-- AC:BEGIN/END -->`, нумерацию критериев `#N`, `type`, `priority`, `updated_date`. `createTask` пишет `created` вместо `created_date` и `task-N` вместо `TASK-N`. `toggleCriterion` считает **все** чекбоксы в файле (включая план в описании), поэтому может переключить не тот пункт. `parseTaskDetails` включает `#1 ` в текст критерия. Правильное решение: писать задачи через CLI `backlog task edit ...`/MCP или воспроизвести формат Backlog.md точно. |
| 5.2 | P1 | `electron/services/docsService.ts` (`createProjectDoc`) | Создаёт `NNNN-slug.md` в decisions и `slug.md` в docs без `id: doc-N`/`decision-N` и без формата имени `doc-<id> - <Title>.md`. Это прямое нарушение правила 13 CLAUDE.md, такие файлы не видны веб-интерфейсу Backlog.md. Использовать `backlog doc create`/`decision create` или формировать id и имя по стандарту. |
| 5.3 | P1 | `claudeBridgeService.runClaudeCliTask` | Claude Code запускается с `--dangerously-skip-permissions`, а карточки «одобрения» (`approvalRequest`) генерируются **после** того, как инструмент уже выполнен. Human-in-the-loop для режима CLI декоративен, `sendApprovalResponse` возвращает `false`. Нужен реальный механизм: `--permission-prompt-tool` через встроенный MCP-сервер либо режим `stream-json` со входом `can_use_tool`. |
| 5.4 | P1 | `src/App.tsx` (глобальные хоткеи) | Ctrl+A/B/D/E/G/I/M/P/R/T перехватываются даже когда фокус в `input`/`textarea` (проверка `isInput` применяется только к `?`/F1). В редакторе документа Ctrl+A переключает на вкладку Analytics, Ctrl+D на Docs. |
| 5.5 | P1 | `electron/services/actionConfigService.ts` + `processManager` | Команды по умолчанию содержат `&&` (`npm run build && npm run deploy`), а на Windows они выполняются через `powershell.exe -Command`. В Windows PowerShell 5.1 оператор `&&` не поддерживается, действие Deploy падает с ошибкой парсера. |
| 5.6 | P1 | `src/services/voiceService.ts` | Настройка `engine: 'webspeech'` не работает: `toggleHandsFree`/`startHandsFreeListening` всегда идут по пути Whisper, объект `recognition` инициализируется, но не запускается. |
| 5.7 | P1 | `templateWizard.ts`, `projectRegistry.ts`, `ragSearch.ts`, `localWhisperService.resolveWorkerPath` | Используют `process.cwd()`: путь к шаблону `../ProjectTemplate`, «первый проект» в реестре по умолчанию, кэш моделей `.rag-cache`, поиск воркера. В упакованном приложении cwd произволен (или `Program Files` без прав на запись). Заменить на `app.getPath('userData')`/`app.getAppPath()` и настройку в UI. |
| 5.8 | P2 | `DocsRagView.handleReindex` | Запускает `npm run index-docs` и через 4 с считает индекс готовым. Ждать события `process:statusChanged` для процесса `index-docs`. |
| 5.9 | P2 | `TerminalPanel`, `VoiceControlWidget` | Быстрые кнопки и голосовые команды `run_dev/run_deploy/run_tests` жёстко зашивают `npm run dev`/`npm run deploy`/`npm test` и игнорируют `.projecthub.json` (ActionRunnerBar уже умеет читать конфиг). |
| 5.10 | P2 | `main.ts` `projects:scan` | Корень сканирования по умолчанию на Windows включает корень диска (`C:\`) с глубиной 2, `inspectProject` запускает `git status` в каждой папке-кандидате. Первый запуск может занять минуты. |

## 6. Недоделанное и мёртвый код

| # | Приоритет | Место | Проблема |
|---|---|---|---|
| 6.1 | P1 | `src/components/projects/ProjectWorkspace.tsx` | Вкладка `processes` — заглушка с иконкой. Менеджер процессов (список, env, перезапуск, автооткрытие `autoOpenUrl`) не реализован, хотя `ActionDefinition` уже описывает `env`, `cwd`, `autoOpenUrl`. |
| 6.2 | P2 | `electron/services/mcpServer.ts` (stdio) | Не используется: `startMcpStdio` нигде не вызывается, набор из 11 инструментов расходится с SSE-сервером (10 инструментов, другие имена). Либо удалить, либо сделать общий реестр инструментов для обоих транспортов. |
| 6.3 | P2 | `src/components/terminal/ProcessTerminal.tsx` | Компонент не импортируется нигде (мёртвый код). |
| 6.4 | P2 | `electron/main.ts` | Дубли IPC: `files:readContent`/`file:readFile`, `files:saveContent`/`file:writeFile`, `git:getLog`/`git:getStatus` в `main.ts` рядом с `gitService`. 103 обработчика в одном файле на 1100 строк; разнести по модулям `ipc/*.ts`. |
| 6.5 | P2 | `contextdump.md` в корне | Произвольный markdown в корне репозитория с frontmatter без `id` (нарушение правила 13). Перенести в `backlog/docs` как `doc-N` или удалить. |
| 6.6 | P2 | `.rag-index/` | Индекс документации отсутствует в репозитории, MCP `search_docs` возвращает «Индекс не найден», хотя CLAUDE.md требует коммитить индекс. Собрать `npm run index-docs` и закоммитить. |
| 6.7 | P2 | i18n | Задача 16 закрыта, но 40 компонентов содержат захардкоженный русский (HUD голоса «Слушаю речь…», «Talon Voice активен», диалоги confirm в KanbanBoard/FileExplorer/GitInspector, «Скопировано» в MarkdownViewer, ошибки Mermaid, логи `[Backlog] …`). |
| 6.8 | P2 | 14 вызовов `confirm()`/`prompt()`/`alert()` | Нативные блокирующие диалоги в Electron (переименование сессии, alias голоса, удаление ветки/файла/задачи). Заменить единым модальным `ConfirmDialog`/`PromptDialog`. |

## 7. Качество кода и инфраструктура

| # | Приоритет | Проблема |
|---|---|---|
| 7.1 | P1 | Тестов нет вообще (ни unit, ни e2e). Кандидаты на первые unit-тесты: `parseTaskDetails`, `claudeUsageService.parseUsageText`, `voiceCommandParser`, `isPathExcluded`, `validateSafePath`, `parseMarkdownBlocks`. |
| 7.2 | P2 | Нет ESLint/Prettier, `noUnusedLocals: false`, 118 использований `any`. |
| 7.3 | P2 | `vite.config.ts`: `rollupOptions.external` не включает `node-pty`, `@huggingface/transformers`, `apache-arrow`, `zod`; проверить, что они не бандлятся в `dist-electron/main.js`. |
| 7.4 | P2 | `secretStorageService.setSecret` пишет в консоль имя секрета; `console-message` пробрасывает весь вывод рендерера в stdout main. Ввести уровни логирования и файл логов в `userData`. |

---

## 8. Сводка по приоритетам

- **P0 (немедленно)**: 1.1, 1.2, 4.1, 4.2, 4.3, 5.1.
- **P1 (ближайший спринт)**: 1.3–1.6, 2.1–2.5, 3.1–3.6, 4.4–4.6, 5.2–5.7, 6.1, 7.1.
- **P2 (техдолг)**: остальное.

Соответствие пунктов задачам Backlog.md приведено в разделе 9.

## 9. Соответствие пунктов аудита задачам Backlog.md

| Задача | Приоритет | Пункты аудита | Тема |
|---|---|---|---|
| TASK-28 | P0 | 1.1, 1.2, 1.8 | Краш main при недоступном Claude CLI, необработанные промисы |
| TASK-29 | P0 | 4.1, 1.6 | Аутентификация и CORS встроенного MCP-сервера |
| TASK-30 | P0 | 4.2, 4.3, 4.4 | setWindowOpenHandler, will-navigate, CSP, permission handler, Mermaid strict |
| TASK-31 | P0 | 5.1 | Совместимость записи задач с форматом Backlog.md |
| TASK-32 | P1 | 4.5, 4.6, 4.7 | Ограничение путей в IPC и записи агента корнем проекта |
| TASK-33 | P1 | 1.3, 1.4, 2.3 | Жизненный цикл агента: approvals, таймаут subprocess, очистка |
| TASK-34 | P1 | 2.1, 2.2, 3.3 | Утечки processManager и gitService, дебаунс git:changed |
| TASK-35 | P1 | 3.1 | Персистентность AI Studio без записи на каждый чанк |
| TASK-36 | P1 | 1.5, 2.6, 3.5, 3.6, 3.7, 4.8, 5.6 | Голосовой движок: воркер Whisper, AudioWorklet, WebSpeech |
| TASK-37 | P1 | 3.2 | VoiceControlWidget: переподписки на каждый чанк |
| TASK-38 | P1 | 2.4, 2.5, 3.10 | terminalLogs, projectDataCache, перетаскивание панели |
| TASK-39 | P1 | 5.4 | Хоткеи перехватывают ввод в полях |
| TASK-40 | P1 | 5.5, 5.9 | Action Runner на Windows (`&&`), хардкод команд |
| TASK-41 | P1 | 5.2 | docsService: формат doc-N / decision-N |
| TASK-42 | P1 | 5.3 | Реальный Human-in-the-loop для Claude CLI |
| TASK-43 | P1 | 5.7, 5.10 | process.cwd() в упакованном приложении, скан диска |
| TASK-44 | P1 | 3.4, 3.9, 5.8 | Оптимизация старта и фоновых опросов |
| TASK-45 | P1 | 6.1 | Вкладка Processes |
| TASK-46 | P2 | 6.2, 6.3, 6.4, 6.5 | Мёртвый код, дубли IPC, разбиение main.ts, contextdump.md |
| TASK-47 | P2 | 6.6 | Сборка и коммит .rag-index |
| TASK-48 | P2 | 6.7, 6.8 | i18n и замена нативных диалогов |
| TASK-49 | P2 | 7.1, 7.2, 7.3, 7.4, 1.7 | Тесты, ESLint, логирование, externals |
| TASK-50 | P2 | 2.7, 2.8, 3.8 | Очистка setTimeout, автоочистка PTY, RAG в utilityProcess |

Рекомендуемый порядок: TASK-29 → TASK-30 → TASK-28 → TASK-31 → TASK-32 → TASK-33 → TASK-34 → TASK-35, далее по приоритету.
