# Как развернуть эту инфраструктуру на новом проекте

Это пошаговая инструкция для человека. Если разворачивает агент (Claude Code и т.п.) —
у него есть skill `init-dev-project` (`.claude/skills/init-dev-project/SKILL.md`,
также установлен в `~/.claude/skills/`), он делает то же самое сам через `AskUserQuestion`
и свои инструменты. Эта инструкция — на случай, если разворачивать вручную, или чтобы
понимать, что вообще происходит под капотом skill'а.

## 0. Предварительные требования

- **Git** и **Node.js 18+** — обязательны, без них не работает вообще ничего здесь.
- Остальное (Python, Go, Rust, конкретный пакетный менеджер) — по потребности вашего
  проекта, ставится через `npm run bootstrap` на шаге 4.

## 1. Решите два вопроса заранее

1. **Инфраструктура — это корень проекта, или подпапка?**
   Обычный случай — корень (весь проект = этот шаблон + ваш код). Подпапка — если у вас
   уже есть существующий проект и вы хотите добавить эту инфраструктуру рядом, не трогая
   его структуру (например `my-project/dev-infra/`).
2. **Нужен ли LightRAG?** Это опциональная тяжёлая фича — Python + локальная LLM через
   Ollama, несколько ГБ на диск, медленная индексация. По умолчанию выключена. Если не
   уверены — пропустите, включить можно в любой момент позже.

## 2. Скопируйте файлы шаблона

Скопируйте из `F:\ProjectTemplate` в целевую директорию (корень проекта или выбранную
подпапку):

```
infra-dev.md
scripts/config.mjs
scripts/setup.mjs
scripts/sync-agent-rules.mjs
scripts/web.mjs
scripts/rag/
scripts/env/
scripts/bootstrap/
scripts/lightrag/        ← только если решили использовать LightRAG
start-web.bat
start-web.sh
package.json             ← слейте scripts/dependencies, если у вас уже есть свой
.gitignore                ← добавьте записи оттуда же (node_modules/, .rag-cache/,
                             .env-state/, scripts/lightrag/.venv/, __pycache__/)
```

**Не копируйте** `.rag-index/`, `.lightrag-index/`, `.mcp.json`, `AGENTS.md`, `backlog/` —
это либо генерируется заново под ваш проект, либо специфично для шаблона.

## 3. Git и Backlog.md

В **корне проекта** (не обязательно там же, где лежит инфраструктура, если она в подпапке):

```bash
git init                                                        # если ещё не репозиторий
npx --yes backlog.md init "<Имя проекта>" --agent-instructions agents --defaults
```

Появится `backlog/` (задачи, milestones, decisions) и файл `AGENTS.md` — общий файл правил,
который дальше дополнят GitNexus и `infra-dev.md`. Вся документация проекта кладётся внутрь
`backlog/docs/` и `backlog/decisions/` — отдельной верхнеуровневой `docs/` в проекте быть
не должно (см. `backlog/docs/rag-guide.md` — пример такого документа).

## 4. Настройка и установка

Из директории, куда скопировали инфраструктуру (шаг 2):

```bash
node scripts/setup.mjs
```

Без флагов скрипт спросит интерактивно: корень проекта относительно текущей папки (`.`,
если инфраструктура сама и есть корень; `..` или `../..`, если подпапка) и какие фичи
включить (RAG по документации, env-tools, bootstrap, LightRAG). Ответьте — он запишет
`infra.config.json` и соберёт `.mcp.json` **в корне проекта** с правильными путями.

Затем:

```bash
npm install                          # зависимости самой инфраструктуры (RAG/MCP)
node scripts/bootstrap/bootstrap.mjs # ставит git/node (и что добавите в stack.json) под вашу ОС
npm run index-docs                   # собрать векторный индекс backlog/docs/, backlog/decisions/
node scripts/sync-agent-rules.mjs    # разослать infra-dev.md в CLAUDE.md/GEMINI.md/AGENTS.md
```

Если включили LightRAG — это отдельный, явно тяжёлый шаг, не входит в `npm install`:

```bash
npm run lightrag-setup    # ОДНОРАЗОВО: venv, lightrag-hku, проверка/докачка моделей Ollama
npm run lightrag-index    # построить граф — минуты на документ, не секунды
```

## 5. GitNexus (если в проекте уже есть код)

```bash
npx --yes gitnexus analyze
```

Выполнить **до** `sync-agent-rules.mjs` из шага 4, если делаете это отдельно от общего
прогона — `gitnexus analyze` тоже пишет секцию в `AGENTS.md`, и `sync-rules` должен идти
последним, чтобы ничего не потерять (он трогает только свою помеченную секцию).

## 6. Проверка

- Перезапустите агента/IDE, чтобы подхватить `.mcp.json` — должны появиться инструменты
  `search_docs`/`list_docs`/`get_doc` (`docs-rag`), `start_process`/`stop_process`/
  `list_processes`/`tail_log`/`reindex_docs` (`env-tools`), и `search_docs_graph`/
  `reindex_docs_graph` (`docs-graph`), если включали LightRAG.
- `node scripts/web.mjs start` (или `start-web.bat`/`start-web.sh`) — поднимет веб-UI
  Backlog.md и GitNexus, если для них есть данные (`backlog/`, `.gitnexus/`).
- `npm run rag-search -- "тестовый запрос"` — должен найти что-то в только что
  проиндексированной документации.

## Изменить конфигурацию позже

`infra.config.json` не редактируется руками — перезапустите `node scripts/setup.mjs`
(флагами `--project-root`/`--features` для неинтерактивного режима, например в CI или
из-под агента). Он же пересоберёт `.mcp.json`.
