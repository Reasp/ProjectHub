---
name: project-purpose
description: Цель и текущий план репозитория ProjectTemplate — базовая инфраструктура для human+agent разработки
metadata:
  type: project
---

`ProjectTemplate` — репозиторий с базовой локальной инфраструктурой, которую пользователь
хочет накатывать на любой новый софтверный проект: инструменты, помогающие человеку и
ИИ-агенту совместно работать (трекинг задач, контекст кода, база знаний, доступ к окружению),
а не шаблон кода конкретного приложения.

Текущий стек, который пользователь использует во всех проектах:
- Backlog.md — трекинг задач и ведение документации
- GitNexus — MCP-сервер, граф кода для контекста агента (impact-анализ, зависимости)
- Git — контроль версий
- Агенты: Claude Code, Antigravity, Roo Code, Hermes

Открытые вопросы, зафиксированные в [README.md](../../README.md) как roadmap:
1. ✅ **Векторный RAG для документации** — реализован: `scripts/rag/index-docs.mjs` +
   `scripts/rag/rag-server.mjs` (MCP-сервер `docs-rag`, инструменты `search_docs`/`list_docs`/
   `get_doc`) + `scripts/rag/search-cli.mjs`. `@lancedb/lancedb` + `@huggingface/transformers`
   (не `@xenova/transformers` — тот deprecated и тащит критическую CVE через
   старый `onnxruntime-web`/`protobufjs`; `@huggingface/transformers` чище, остаётся только high
   severity через `sharp`, который не задействован при чисто текстовых эмбеддингах). Индекс —
   `.rag-index/*.lance`, коммитится в git. Кэш весов модели — `.rag-cache/`,
   в `.gitignore`. См. [[feedback-network-node-huggingface]] про особенность скачивания модели.
2. ✅ **MCP-сервер `env-tools`** — `scripts/env/env-server.mjs` (`start_process`/`stop_process`/
   `list_processes`/`tail_log`/`reindex_docs`). На Windows обычная связка `shell:true +
   detached:true` в Node ломает перенаправление stdout/stderr в файл (проверено эмпирически) —
   решено через PowerShell-обёртку, запускаемую `cmd /c start /b`, которая сама пишет свой
   `$PID` в файл и делает редирект через `Out-File -Encoding utf8`. Подробности —
   [[feedback-windows-detached-process]].
3. ✅ **Кросс-платформенный bootstrap** — `scripts/bootstrap/bootstrap.mjs` +
   `scripts/bootstrap/stack.json` (декларативный манифест `{name, check, winget, brew, apt,
   dnf, pacman}`). Определяет ОС и доступный пакетный менеджер, ставит недостающее или
   печатает ручную инструкцию.
4. ✅ **Skill `init-dev-project`** — реализован в `.claude/memory/../skills/init-dev-project/
   SKILL.md` (канонически в `.claude/skills/init-dev-project/`, и по
   согласованию с пользователем скопирован в `~/.claude/skills/init-dev-project/`, чтобы
   быть доступным в любом новом проекте на этой машине). Связывает git init → backlog init →
   копирование инфры → npm install → bootstrap → (опц.) gitnexus analyze → index-docs →
   sync-agent-rules, в этом порядке (sync-agent-rules — последним, т.к. он не трогает чужие
   секции файла). Полный дословный прогон всей цепочки был протестирован в scratch-директории
   перед тем как писать SKILL.md — сработало end-to-end.
5. ✅ **Общий файл правил** — `infra-dev.md` в корне + `scripts/sync-agent-rules.mjs`
   рассылает его секцией (маркеры `<!-- infra-dev:start/end -->`) в `CLAUDE.md`, `GEMINI.md`,
   **`AGENTS.md`** (не `AGENT.md`, как изначально предполагалось — переименовано, т.к. и
   Backlog.md (`--agent-instructions agents`), и GitNexus (`gitnexus analyze`) пишут именно
   в `AGENTS.md`; проверено, что несколько маркерных секций разных инструментов спокойно
   сосуществуют в одном файле).
6. ✅ **Конфигурация standalone/подпапка + опциональные фичи** — по требованию пользователя
   ("шаблон должен работать на любой машине, и его могут подключить как подпапку внутри
   существующего проекта; некоторые функции нужно уметь отключать"). `infra.config.json`
   (`{projectRoot, features}`) + `scripts/config.mjs` (Node) / `scripts/lightrag/pyconfig.py`
   (Python) — общий источник `PROJECT_ROOT`/`INFRA_ROOT`/`FEATURES`, ни один скрипт не
   вычисляет пути от `__dirname` напрямую. `scripts/setup.mjs` — точка входа (интерактивно
   через readline или флагами `--project-root`/`--features`), пишет конфиг и пересобирает
   `.mcp.json` в `PROJECT_ROOT` с правильными относительными путями до скриптов. По умолчанию
   включено всё, кроме `lightrag` (тяжёлая опциональная фича — см. п.7).
7. ✅ **LightRAG** — граф сущностей/связей поверх той же документации, что и Vector RAG, но
   через LLM-экстракцию. Пользователь подтвердил: настоящий LightRAG (не лёгкий аналог на
   Node), с Python + локальной LLM через Ollama. Хранение — штатные лёгкие бэкенды
   `lightrag-hku` (NetworkX GraphML + NanoVectorDB JSON), без тяжёлой БД. Модель для
   экстракции — `qwen2.5:7b-instruct` (выбор пользователя из предложенных вариантов),
   эмбеддинги — `bge-m3` (уже была в Ollama на машине). Изолированный venv в
   `scripts/lightrag/.venv/` — специально НЕ переиспользует системный `python` из PATH
   (см. [[feedback-python-venv-discovery]]). MCP-обёртка `scripts/lightrag/lightrag-server.mjs`
   (сервер `docs-graph`, инструменты `search_docs_graph`/`reindex_docs_graph`) на Node,
   шлёт запросы в venv-Python через `execFile`, не завязана на MCP Python SDK. По пути
   всплыли две конфигурационные ловушки Ollama — см. [[feedback-ollama-client-pitfalls]].
   Опционально: `features.lightrag`, по умолчанию **выключено** — тяжёлая фича (Python,
   Ollama, несколько ГБ на диск), не форсируется на пользователя ни в `setup.mjs`, ни в
   skill'е `init-dev-project`.
8. ✅ **Веб-интерфейсы** — `scripts/web.mjs` (`start`/`stop`/`status`) поднимает `backlog
   browser` и `gitnexus serve` через уже готовый `env-tools`-механизм (трекинг pid/логов),
   пропускает то, что ещё не проинициализировано. `start-web.bat` (CRLF!) и `start-web.sh` —
   тонкие обёртки для запуска без node-команды в голове.

**Referenced architecture:** Архитектура отталкивается от проверенных прототипов
этой инфраструктуры (committable vector RAG через LanceDB, `.mcp.json`
паттерн MCP-конфигов, `CLAUDE.md`/`GEMINI.md`/`AGENTS.md` как параллельные файлы правил,
структура `backlog/` с tasks/milestones/decisions/docs).

**Why:** пользователь хочет один раз довести процесс до предсказуемого состояния и
переносить между проектами, а не пересобирать инфраструктуру каждый раз с нуля.
**How to apply:** при продолжении работы над ProjectTemplate — сверяться с этим списком
и с README.md. Открытый пункт на сейчас: автообновление RAG/LightRAG-индекса по git hook
vs. вручную — не решено, см. README.md «Статус».
См. также [[feedback-local-memory]] — где хранится память этого проекта.
