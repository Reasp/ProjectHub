---
id: TASK-73.1
title: >-
  TASK-73.1 чистые модули: разбор npm audit и pip-audit, скан секретов в диффе,
  изменения зависимостей, компонент security
status: Done
assignee: []
created_date: '2026-09-27 06:12'
updated_date: '2026-09-28 04:53'
labels:
  - security
dependencies: []
parent_task_id: TASK-73
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-56 п. 1–3, 5, 6. Модули dependencyAudit.ts, diffSecretScan.ts, dependencyDiff.ts, telegram_token в secretPatterns, компонент security в arenaScoring. Фикстуры — реальные выводы npm audit (прямая, транзитивная, ENOLOCK, офлайн, чистый) и pip-audit, снятые 2026-09-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Разбор npm audit v2 и pip-audit покрыт тестами на реальных выводах, включая ENOLOCK, офлайн и дубли id
- [x] #2 Скан диффа: только добавленные строки, номера строк, env_file, allowPaths, маркер (для человека), бинарные файлы, лимит
- [x] #3 Изменения зависимостей по package.json/lock/requirements и флаги риска по метаданным registry
- [x] #4 Компонент security в балле: 1/0/0.5/unknown; авто-мердж запрещён при секретах или новых зависимостях
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: dependencyAudit.ts, diffSecretScan.ts (+maskSecretsInPatch), dependencyDiff.ts, slotSecurity.ts, telegram_token в secretPatterns (+maskDetectedSecrets), компонент security в arenaScoring (вес 10, абсолютная шкала), запрет авто-мерджа при секретах или изменениях зависимостей. Фикстуры — реальные выводы npm 10.9.2 и pip-audit 2.10.1, npm view (обе формы ответа), настоящий git diff --cached с кириллицей и бинарником (tests/unit/fixtures/security). Тесты: dependencyAudit, diffSecretScan, dependencyDiff, slotSecurity, arenaScoring.
<!-- SECTION:NOTES:END -->
