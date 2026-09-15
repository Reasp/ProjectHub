---
id: TASK-79
title: >-
  Тиры моделей (cheap/balanced/frontier) в ролях и слотах вместо жёстких id,
  каталог моделей от движков, fallback-цепочка при rate limit
status: To Do
assignee: []
created_date: '2026-09-15 03:14'
updated_date: '2026-09-15 03:30'
labels:
  - ai
  - roles
  - providers
  - routing
  - cost
milestone: m-0
dependencies:
  - TASK-70
  - TASK-71
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
- [ ] #1 Чистый модуль тиров (схема, резолв per-движок, порядок fallback) покрыт unit-тестами
- [ ] #2 Роли и слоты поддерживают modelTier; старые файлы ролей с model продолжают работать
- [ ] #3 Каталог моделей берётся от движков/провайдеров с кэшем и ручным обновлением; недоступная модель тира подсвечивается в настройках
- [ ] #4 При 429/503/model-not-found слот переключается на следующую модель цепочки (не более 2 раз) с записью в лог и уведомлением
- [ ] #5 В карточке слота и экспорте видны запрошенный тир, фактическая модель и причина переключения
- [ ] #6 UI настройки таблицы тиров и выбор тира в NewSwarmModal/менеджере ролей; i18n; lint/test зелёные, pack:win собран
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-09-15: уточнение по decision-26 п. 0 — таблица тиров не должна иметь захардкоженных вендорских дефолтов: при первом запуске тиры заполняются из того, что реально настроено у пользователя (профили TASK-70, Ollama, Claude CLI), примеры в описании (Haiku/Sonnet/Opus, luna/sol/astra) — лишь иллюстрация. Локальная модель может быть любым тиром, включая frontier.
<!-- SECTION:NOTES:END -->
