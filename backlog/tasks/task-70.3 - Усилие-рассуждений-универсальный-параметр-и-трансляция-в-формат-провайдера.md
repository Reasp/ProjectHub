---
id: TASK-70.3
title: 'Усилие рассуждений: универсальный параметр и трансляция в формат провайдера'
status: Review
assignee: []
created_date: '2026-09-18 12:54'
updated_date: '2026-09-18 14:29'
labels:
  - ai
  - model-agnostic
dependencies:
  - TASK-70.1
parent_task_id: TASK-70
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
AC#3 TASK-70. Параметр `none|low|medium|high|max` слота/сессии; адаптер по флагу профиля `compat.reasoning` (decision-39) транслирует его в `reasoning_effort`, `reasoning: {effort}`, `think` (Ollama), а для Anthropic — в thinking (decision-33) или молча игнорирует. Дельты `reasoning_content`/`reasoning` — в поток thought.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Трансляция усилия для всех стилей compat.reasoning и Anthropic покрыта unit-тестами
- [x] #2 Параметр задаётся в UI сессии и слота
- [x] #3 Дельты рассуждений показываются как thought
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация (decision-41, 2026-09-18)
- `electron/services/reasoningEffort.ts` — чистый модуль: шкала `none|low|medium|high|max` (`normalizeReasoningEffort`), `openAICompatibleReasoningFields` по `compat.reasoning` (reasoning_effort / reasoning.effort / ollama_think → reasoning_effort / none → не отправлять + note), `reasoningErrorHint` (подсказка к 400 от сервера), `pickSupportedEffort`, `ANTHROPIC_EFFORT_BUDGET_TOKENS`, `claudeCliEffortArgs` (`--effort`, «none» не передаётся), `extractReasoningDelta` (reasoning_content → reasoning → reasoning_details без двойного показа).
- `buildOpenAICompatibleChatBody`: поля `reasoningEffort` и `notes`. `aiAgentService`: усилие в OpenAI-совместимом и Anthropic-путях, notes в лог один раз за ход, подсказка к ошибке, разбор дельт через `extractReasoningDelta` (раньше читался только `reasoning_content`).
- `buildAnthropicMessagesBody`: `parseAnthropicModelCapabilities` читает `capabilities.effort`; усилие заменяет `thinkingBudget`: adaptive → thinking adaptive/summarized + `output_config.effort` (ближайший поддерживаемый уровень ниже), только enabled → бюджет по уровню, `none` → ничего (не `disabled`) + note.
- Claude CLI: `--effort` в AI Studio (`claudeBridgeService`) и слотах claude-cli (`buildEngineInvocation`, `effortNote` в лог агента); Codex/Gemini — не передаётся, пояснение в логе.
- Пресет Ollama и прежний `ollama` → `ollama_think`, прежний `openrouter` → `reasoning_object`. Сохранённые профили не мигрируются.
- Слот: `resolveSlotProviderConfig` — своё усилие важнее, «как в AI Studio»/только модель наследуют усилие AI Studio, профиль/Ollama — только своё. Роль (frontmatter) — не добавлено, обоснование в ADR.
- UI: `ReasoningEffortSelect` + `src/lib/reasoningEffort.ts` (`effortTargetKind`, `withReasoningEffort`). AISettingsModal — выбор для всех провайдеров с подсказкой по стилю/CLI, слайдер thinkingBudget скрыт при заданном усилии. NewSwarmModal — компактный выбор в каждом слоте (API и CLI), у claude-cli «без рассуждений» недоступно; смена провайдера и выбор роли усилие не сбрасывают. Быстрый переключатель в шапке AI Studio не делался.

## Живая проверка, 2026-09-18
- Ollama 0.34 (localhost, qwen2.5:7b-instruct) и 0.31.2 (192.168.1.11, ornith:35b с thinking), curl: `think` через `/v1` игнорируется (с `think:false` модель рассуждает); `reasoning_effort` и `reasoning:{effort}` принимаются, допустимы none|low|medium|high|max, на `xhigh` — 400; `none` выключает рассуждения; поток — `delta.reasoning`, непотоковый — `message.reasoning`.
- Временный тест через настоящие `aiAgentService`/`llmProfileService`/`slotProvider` (удалён), ornith:35b: low → тело `reasoning_effort: "low"`, 731 символ thought, ответ 391; none → 0 символов thought, 391; без усилия — поля нет, модель рассуждает (351); слот с профилем по имени и `max` → `reasoning_effort: "max"`, 1515; прежний провайдер ollama + medium → 876; qwen2.5 + high → 400 «does not support thinking» с подсказкой.
- Claude CLI 2.1.275: `claude -p --effort low` работает; `--effort none` CLI отвергает предупреждением — поэтому не передаётся.
- Скриншоты собранного exe (копия userData, временный HOME с профилем Ollama, копии удалены): настройки AI Studio — выбор «Low» и подсказка формата профиля; New Duel — выбор в обоих слотах, у claude-cli «none» disabled, после сброса провайдера усилие слота сохранилось. По скриншоту сокращена подпись компактного выбора («Усилие: …»).

## Не проверено
Облачных ключей нет: OpenAI, OpenRouter, xAI и Anthropic API вживую не проверены — трансляция по документации (openai-node `ReasoningEffort`, OpenRouter Reasoning Tokens, скилл claude-api) и unit-тестам.

## Проверки
- Чат AI Studio в собранном exe: профиль Ollama (192.168.1.11), `ornith:35b`, усилие low → блок «Thinking Process» с рассуждениями и ответ 391 (AC#3 проверен в UI).
- Unit: `reasoningEffort.test.ts`, `reasoningEffortUi.test.ts`, дополнения в `anthropicRequest.test.ts`, `slotProvider.test.ts`, `roleEngineAdapter.test.ts`, `providerSelect.test.ts`. Полный `npm test`: 108/108 файлов, 1214/1214, сирот нет (12 node-процессов до и после). ESLint: 0 ошибок, 499 предупреждений (как baseline). lint:docs, index-docs — ок.
- `pack:win` 2 раза (build зелёный, check-bundle ✅), последний exe 22:26:16, app.asar 22:26:15.
<!-- SECTION:NOTES:END -->
