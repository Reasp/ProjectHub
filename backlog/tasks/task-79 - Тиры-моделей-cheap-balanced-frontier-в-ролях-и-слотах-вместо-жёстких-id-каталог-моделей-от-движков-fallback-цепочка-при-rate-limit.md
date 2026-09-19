---
id: TASK-79
title: >-
  Тиры моделей (cheap/balanced/frontier) в ролях и слотах вместо жёстких id,
  каталог моделей от движков, fallback-цепочка при rate limit
status: Review
assignee: []
created_date: '2026-09-15 03:14'
updated_date: '2026-09-19 06:54'
labels:
  - ai
  - roles
  - providers
  - routing
  - cost
milestone: m-0
dependencies:
  - TASK-70
references:
  - >-
    backlog/decisions/decision-44 -
    Тиры-моделей-и-fallback-цепочка-слота-таблица-model-tiers-правила-переключения-и-отчёт.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Роли (decision-9) и слоты Swarm хранят конкретные `model`-id. При смене поколения моделей (август 2026 — ретайр `gpt-5.4`; сентябрь — Astra/5.6) роли молча ломаются, а выбор «дёшево для рутины / фронтир для сложного» приходится делать руками для каждого движка. OpenCode/Cline продают «75+ провайдеров», но у них нет политики выбора; в ProjectHub уже есть учёт стоимости (`agentCost`) и `RateLimitWarningBanner` — не хватает слоя маршрутизации ([[decision-26]] п. 3–4, doc-10).

## Модель
- Тир: `cheap | balanced | frontier`. Таблица `<userData>/model-tiers.json` (редактируемая в UI) с дефолтами: Claude — Haiku 4.5 / Sonnet 5 / Opus 5 (или Fable 5.1); OpenAI — `gpt-5.6-luna` / `gpt-5.6-sol` / `gpt-6-astra`; Gemini/OpenRouter/Ollama — по каталогу; для Claude CLI — алиасы `haiku|sonnet|opus`.
- Роль/слот: поле `modelTier` (по умолчанию: architect/reviewer → frontier, implementer/tester → balanced, doc-writer → cheap); явный `model` остаётся как переопределение.
- Резолв per-движок в `roleEngineAdapter.buildEngineInvocation` (для CLI) и в `aiAgentService` (для API); каталог доступных моделей — от движка (`model/list` Codex, каталог Anthropic/OpenAI/OpenRouter из API, настройки Claude CLI), с кэшем и ручным обновлением.
- Fallback: при 429/503/«model not found» слот переключается на следующую модель того же тира (или тира ниже) с записью в лог и уведомлением; для CLI-движков — рестарт хода с `--model`, для API — повтор запроса. Лимит переключений — 2.
- Отчёт: в карточке слота и экспорте — какой тир запрошен, какая модель реально использована и почему.

## Что сделать
1. `modelTiers.ts` — чистый модуль (схема, резолв, порядок fallback, тесты) + сервис с загрузкой/сохранением таблицы.
2. Интеграция в роли (`roleTypes`, файлы ролей — обратная совместимость с `model`), адаптер движков, `aiAgentService`, `agentFleetService` (fallback).
3. UI: настройки тиров (таблица движок × тир), выбор тира в `NewSwarmModal`/менеджере ролей, индикация фактической модели.
4. Обновить встроенные роли и документацию ролей.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Чистый модуль тиров (схема model-tiers.json, нормализация, цепочка per-движок с порядком и спуском в младший тир, решение о переключении) покрыт unit-тестами
- [x] #2 Таблица тиров заполняется из настроенного (модель AI Studio, профили и кэш их каталогов, алиасы Claude CLI) без вендорских дефолтов; локальная модель может стоять в любом тире
- [x] #3 Роли и слоты поддерживают modelTier; явный model важнее тира; старые файлы ролей с model работают как раньше
- [x] #4 Каталог моделей тиров берётся от провайдеров (каталог профиля с кэшем и обновлением, алиасы Claude CLI); модель тира, которой нет в каталоге, подсвечивается в настройках
- [x] #5 Слот переключается на следующее звено только по providerError.kind из decision-43 §8, не больше 2 раз за ход, с ожиданием retryAfterMs, записью в лог и уведомлением; auth/config/bad_request (кроме context) не переключают; API-слоты и Claude CLI
- [x] #6 Claude CLI: API-ошибка из stream-json (assistant.error, result.is_error/api_error_status) классифицируется и даёт failed с providerError вместо completed
- [x] #7 В карточке слота и экспорте Markdown/JSON видны запрошенный тир, фактическая модель и причина каждого переключения
- [x] #8 UI настройки таблицы тиров и выбор тира в NewSwarmModal и редакторе ролей; i18n ru/en
- [x] #9 ADR decision-44; живая проверка цепочки на Ollama и 401 Anthropic; скриншот собранного exe; lint/test/check-bundle зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-15: уточнение по decision-26 п. 0 — таблица тиров не должна иметь захардкоженных вендорских дефолтов: при первом запуске тиры заполняются из того, что реально настроено у пользователя (профили TASK-70, Ollama, Claude CLI), примеры в описании (Haiku/Sonnet/Opus, luna/sol/astra) — лишь иллюстрация. Локальная модель может быть любым тиром, включая frontier.

2026-09-19: зависимость от TASK-71 снята (decision-44 п. 9): Codex не установлен и не оплачен; тиры Codex CLI задаются вручную и передаются как `-m <модель>` без проверки, каталог `model/list` — после TASK-71. Классификация ошибок Claude CLI делается здесь (79.3): stream-json даёт `assistant.error` и `result.api_error_status` (проверено вживую на 2.1.275); Codex/Gemini без классификации.

## Итог (decision-44, 2026-09-19)
Подзадачи 79.1–79.5 в Review, подробности — в их Implementation Notes. Кратко: чистый модуль `modelTiers.ts` + сервис `<userData>/model-tiers.json` с заполнением из настроенного (без вендорских дефолтов); `modelTier` в ролях и слотах, встроенные роли с тирами; fallback в `agentFleetService` для API и Claude CLI по decision-43 §8 (≤ 2 переключения, Retry-After, лог, шина, уведомление); классификация API-ошибок Claude CLI (раньше ход с несуществующей моделью был completed); вкладка «Тиры», выбор тира в слоте и роли, отчёт в карточке и экспорте.

Проверки: ESLint 0 ошибок / 499 предупреждений (baseline); `npm test` 114/114 файлов, 1350/1350, node-процессов 13 до и после; check-bundle ✅; index-docs, lint:docs, check-index — ок, `search_docs` находит decision-44. `pack:win` 2 раза, последний exe 14:54:14, app.asar 14:54:13. GitNexus перестроен `analyze --force`, CLAUDE.md/AGENTS.md откатаны, `.claude/skills/gitnexus` удалён. Скриншоты собранного exe на копии userData (удалена).

Не проверено вживую: 429/503 облачных провайдеров (ключей нет) — фикстуры и локальный HTTP-сервер; 401 для Claude CLI (вход через аккаунт перекрывает ключ из окружения) — по документации; Codex/Gemini — только тир через `-m`, без классификации.
<!-- SECTION:NOTES:END -->
