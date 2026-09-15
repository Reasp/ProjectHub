---
id: TASK-73
title: >-
  Security Health: панель npm audit по проектам и сканер секретов перед
  коммитом/в диффах агентов
status: To Do
assignee: []
created_date: '2026-09-15 03:10'
labels:
  - security
  - git
  - quality
milestone: m-0
dependencies: []
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Предложение doc-6 §4.2 (аудит зависимостей и сканер секретов) до сих пор не реализовано, а с моделями Astra-класса (Critical по киберспособностям, 2/500 прогонов с supply-chain-риском в оценке UK AISI) проверка того, что агент внёс в зависимости и не утекли ли ключи, становится частью harness, а не «приятным дополнением».

## Что сделать
1. `npm audit --json` (и `pip-audit`/`cargo audit` при наличии) по проекту по кнопке и по расписанию (через Automations): сводка Critical/High/Moderate во вкладке проекта, ссылка на advisory, кнопка «создать задачу».
2. Сканер секретов (чистый модуль, тесты): паттерны ключей (AWS, OpenAI `sk-`, Anthropic, GitHub `ghp_`, Telegram-бот, приватные ключи PEM, `.env`), проверка staged-диффа перед коммитом из GitInspector и диффов слотов Swarm перед слиянием; в Arena — штраф в скоринге (decision-20).
3. Проверка изменений зависимостей в диффе агента: новые пакеты в `package.json`/lock — отдельный блок в карточке слота «Добавлены зависимости» с версией и датой публикации; HITL-запрос при слиянии, если появились новые пакеты.
4. Уведомление `securityFinding` в `notificationTypes`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Панель npm audit с уровнями критичности и созданием задачи из находки
- [ ] #2 Сканер секретов — чистый модуль с тестами; блокирует коммит из GitInspector и предупреждает при слиянии слота Swarm
- [ ] #3 Новые зависимости в диффе агента выделены в карточке слота и требуют HITL при слиянии
- [ ] #4 Уведомление securityFinding проходит через шину и notificationRules; i18n; lint/test зелёные, pack:win собран
<!-- AC:END -->
