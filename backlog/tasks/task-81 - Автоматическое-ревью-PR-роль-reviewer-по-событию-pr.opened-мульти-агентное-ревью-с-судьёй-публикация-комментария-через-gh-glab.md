---
id: TASK-81
title: >-
  Автоматическое ревью PR: роль reviewer по событию pr.opened, мульти-агентное
  ревью с судьёй, публикация комментария через gh/glab
status: To Do
assignee: []
created_date: '2026-09-15 03:15'
labels:
  - pr
  - review
  - swarm
  - automation
milestone: m-0
dependencies:
  - TASK-74
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Claude Code `/ultrareview`, Cursor BugBot, Codex `review/start` и Copilot делают ревью PR фоновым агентом. В ProjectHub есть роль `reviewer`, LLM-ревьюер Arena (decision-12, `reviewerPrompt`), интеграция PR (TASK-8, `prService`) и обратная ссылка PR в задаче (TASK-64) — не хватает связки «PR открыт → ревью → комментарий» (doc-10).

## Что сделать
1. Правило Automations (по умолчанию выключено): `pr.opened`/`pr.updated` → запуск ревью.
2. Режим `review` в `agentFleetService`: N ревьюеров (разные движки/тиры) получают дифф PR + контекст задачи (`contextBuilder`) и возвращают структурированные находки (файл, строка, серьёзность, описание, предложение); судья (`arenaJudgeService`) дедуплицирует и ранжирует, отбрасывая неподтверждённые (адверсариальная верификация как в `/ultrareview`).
3. Публикация: один сводный комментарий в PR через `gh pr comment`/`glab` (никогда не «approve» автоматически), плюс карточка в задаче; HITL-подтверждение перед публикацией (настраиваемо).
4. Для Codex — использовать `review/start` app-server как один из ревьюеров.
5. Стоимость ревью учитывается и показывается; лимит бюджета на ревью.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Событие pr.opened запускает ревью через Automations (правило по умолчанию выключено)
- [ ] #2 Режим review: находки ревьюеров структурированы, дедуплицированы и верифицированы судьёй; парсер находок — чистый модуль с тестами
- [ ] #3 Сводный комментарий публикуется в PR через gh/glab только после HITL-подтверждения (настраиваемо); авто-approve невозможен
- [ ] #4 Карточка результатов ревью в задаче и во вкладке PR с стоимостью; i18n; lint/test зелёные, pack:win собран
<!-- AC:END -->
