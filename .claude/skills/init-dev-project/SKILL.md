---
name: init-dev-project
description: "Use when the user wants to bootstrap a new software project with the personal dev infrastructure (Backlog.md, GitNexus, committable vector RAG for docs, optional LightRAG doc-graph, env-tools MCP, shared agent rules) — scaffolds folder structure, surveys the tech stack, installs the environment cross-platform, and wires everything together. Works both when the infra becomes the project root and when it's added as a subfolder inside an existing project. Examples: \"init this project\", \"set up dev infra here\", \"bootstrap a new project with my usual tooling\""
---

# init-dev-project

Разворачивает личную инфраструктуру разработки из шаблона `F:\ProjectTemplate` (источник
истины — `F:\ProjectTemplate\README.md`): Backlog.md, GitNexus, коммитимый векторный RAG
для документации, опциональный LightRAG-граф, MCP-инструменты работы с окружением,
кросс-платформенный bootstrap и общий файл правил для агентов.

> Этот скилл — последний шаг в цепочке (`RAG` → `MCP env-tools` → `bootstrap` → `init-dev-project`).
> Он не изобретает ничего нового, а копирует и связывает уже готовые куски из шаблона.
> Если `F:\ProjectTemplate` недоступен (другая машина) — спроси пользователя, где лежит
> актуальная копия шаблона, прежде чем продолжать.

## Шаг 0 — где мы и что уже есть

1. Определи целевую директорию — обычно текущая рабочая директория.
2. Проверь `F:\ProjectTemplate` — если пути нет, спроси пользователя, где искать шаблон.
3. Проверь, что уже есть в целевой директории: существующие `package.json`, `.git`, `backlog/`
   (включая `backlog/docs/`) — ничего не затирай молча, только дополняй/сливай.

## Шаг 1 — опрос

Задай пользователю через `AskUserQuestion` (коротко, не превращай в анкету):

1. **Инфраструктура — это корень проекта, или подключается как подпапка** в уже существующий
   проект? Если подпапка — как она называется (например `dev-infra/`) и где относительно неё
   находится корень проекта. Это определяет `projectRoot` в `infra.config.json` (см. шаг 3).
2. **Основной язык/рантайм проекта** — Node.js/TypeScript, Python, Go, Rust, ещё не решено /
   только инфраструктура (без кода). Влияет только на `scripts/bootstrap/stack.json` — сама
   RAG/MCP-инфраструктура всегда на Node.js независимо от стека проекта.
3. **Имя проекта** для Backlog.md — по умолчанию имя папки корня проекта.
4. **Нужен ли LightRAG** (граф сущностей/связей документации)? **По умолчанию — нет.**
   Явно предупреди: это Python + локальная LLM через Ollama (несколько ГБ на диск, медленная
   индексация — минуты на документ, а не секунды). Включай, только если пользователь
   осознанно согласился, не предлагай как само собой разумеющееся дополнение.
5. Если в директории уже есть код — **проиндексировать его GitNexus сейчас же?** (да/нет).
   Для пустого проекта пропусти вопрос.

## Шаг 2 — git и Backlog.md

```bash
git init   # если .git ещё нет в корне проекта
npx --yes backlog.md init "<имя проекта>" --agent-instructions agents --defaults
```

Выполняется **в корне проекта** (не обязательно в текущей директории, если инфра — подпапка).
`--agent-instructions agents` пишет блок Backlog.md в **`AGENTS.md`** (не `AGENT.md` —
именно так называют общий файл правил и Backlog.md, и GitNexus). Если `.git` не создавали
(пользователь явно попросил без git) — добавь `--no-git`.

## Шаг 3 — скопировать инфраструктуру и настроить

Скопируй как есть в целевую директорию инфраструктуры (корень проекта, либо выбранная
подпапка — не путать с корнем проекта из шага 2):

| Из `F:\ProjectTemplate\...` | Куда |
|---|---|
| `infra-dev.md` | `./infra-dev.md` |
| `scripts/config.mjs`, `scripts/setup.mjs`, `scripts/sync-agent-rules.mjs`, `scripts/web.mjs` | `./scripts/` |
| `scripts/rag/*.mjs` | `./scripts/rag/` |
| `scripts/env/*.mjs` | `./scripts/env/` |
| `scripts/bootstrap/bootstrap.mjs`, `scripts/bootstrap/stack.json` | `./scripts/bootstrap/` |
| `scripts/lightrag/*` (только если LightRAG включён на шаге 1) | `./scripts/lightrag/` |
| `backlog/docs/rag-guide.md` | `<корень проекта>/backlog/docs/rag-guide.md` |
| `start-web.bat`, `start-web.sh` | `./` (рядом с package.json инфраструктуры) |

`backlog/docs/rag-guide.md` копируется в `backlog/` **корня проекта** (после `backlog init`
на шаге 2), а не в папку самой инфраструктуры — вся документация проекта живёт внутри
`backlog/docs/`/`backlog/decisions/`, отдельной верхнеуровневой `docs/` в проекте быть
не должно.

`package.json` — если в целевой директории уже есть, добавь в него `scripts`/`dependencies`
из `F:\ProjectTemplate\package.json` (не заменяя существующие одноимённые скрипты без
предупреждения); если нет — скопируй как есть. `.gitignore` — добавь записи оттуда же
(node_modules/, .rag-cache/, .env-state/, scripts/lightrag/.venv/, __pycache__/); **не
добавляй** `.rag-index/` и `.lightrag-index/` в `.gitignore` — они должны коммититься.

Затем настрой (это одна команда вместо ручной правки `infra.config.json`/`.mcp.json`):

```bash
node scripts/setup.mjs --project-root <путь-от-инфры-до-корня-проекта> \
  --features docsRag,envTools,bootstrap[,lightrag] --no-interactive
npm install
```

`--project-root` — `.`, если инфраструктура сама является корнем (обычный случай), или
относительный путь вверх (`..`, `../..`), если она подключена как подпапка. `--features`
перечисли явно по ответам шага 1 (`lightrag` — только если пользователь согласился).
`setup.mjs` сам запишет `infra.config.json` и синхронизирует `.mcp.json` (Claude Code) и
`.agents/mcp_config.json` (Google Antigravity) **в корне проекта** (не в подпапке с инфрой)
с правильными относительными путями до скриптов.

## Шаг 4 — окружение

```bash
node scripts/bootstrap/bootstrap.mjs
```

Если пользователь выбрал язык, для которого в `stack.json` шаблона нет записи (по умолчанию
там только `git` и `node` — они нужны самой инфраструктуре), добавь перед запуском в
`./scripts/bootstrap/stack.json` → `tools`:

| Язык | Запись для `stack.json` |
|---|---|
| Python | `{ "name": "python", "check": "python --version", "winget": "Python.Python.3.12", "brew": "python@3.12", "apt": "python3 python3-pip", "dnf": "python3", "pacman": "python" }` |
| Go | `{ "name": "go", "check": "go version", "winget": "GoLang.Go", "brew": "go", "apt": "golang-go", "dnf": "golang", "pacman": "go" }` |
| Rust | `{ "name": "rust", "check": "rustc --version", "winget": "Rustlang.Rustup", "brew": "rust", "apt": "rustc cargo", "dnf": "rust cargo", "pacman": "rust" }` |
| Node.js/TypeScript | ничего не добавлять — `node` уже в базовом списке |

`bootstrap.mjs` кросс-платформенный: сам определяет OS и доступный менеджер пакетов
(`winget`/`brew`/`apt`/`dnf`/`pacman`) — второй раз спрашивать пользователя про ОС не нужно.

## Шаг 5 — GitNexus (если есть код)

Если на шаге 1 пользователь попросил проиндексировать сразу (или в директории уже есть код),
выполни **в корне проекта**:

```bash
npx --yes gitnexus analyze
```

Выполнять **до** шага 7 (sync-rules) — `gitnexus analyze` тоже пишет секцию в `AGENTS.md`, и
порядок "сначала внешние инструменты, потом наш sync-rules последним" гарантирует, что наша
секция довесится, не потеряется и не потеряет чужую.

## Шаг 6 — RAG-индекс (и опционально LightRAG)

```bash
npm run index-docs        # индекс по backlog/docs/, backlog/decisions/
```

Если LightRAG включён — это отдельный, явно тяжёлый шаг, не запускай его молча вместе с
остальным без предупреждения о времени/месте на диске:

```bash
npm run lightrag-setup    # ОДНОРАЗОВО: venv, lightrag-hku, модели Ollama (несколько ГБ)
npm run lightrag-index    # построить граф — минуты, не секунды, на каждый документ
```

`lightrag-setup` сам проверяет Ollama и нужные модели — если Ollama не установлена/не
запущена, скрипт остановится с понятной инструкцией, а не зависнет.

## Шаг 7 — разослать правила

```bash
node scripts/sync-agent-rules.mjs   # infra-dev.md → CLAUDE.md/GEMINI.md/AGENTS.md и .agents/rules/infra-dev.md корня проекта
```

## Шаг 8 — отчёт пользователю

Кратко перечисли: что создано, что нужно перезапустить агента/IDE, чтобы подхватить
`.mcp.json`/`.agents/mcp_config.json` (`docs-rag`, `env-tools`, `backlog`, при выборе —
`docs-graph`), как поднять веб-интерфейсы
Backlog.md/GitNexus (`node scripts/web.mjs start` или `start-web.bat`/`start-web.sh` в корне
инфраструктуры), и что осталось на усмотрение пользователя (например, LightRAG, если он его
не включил на шаге 1 — можно добавить позже через `node scripts/setup.mjs`).
