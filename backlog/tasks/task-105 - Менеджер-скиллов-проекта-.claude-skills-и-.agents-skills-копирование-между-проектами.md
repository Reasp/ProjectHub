---
id: TASK-105
title: >-
  Менеджер скиллов проекта: .claude/skills и .agents/skills, копирование между
  проектами
status: Review
assignee: []
created_date: '2026-09-27 04:18'
updated_date: '2026-09-28 02:05'
labels:
  - skills
  - ui
dependencies: []
modified_files:
  - electron/services/skillCatalog.ts
  - electron/services/skillService.ts
  - electron/ipc/skillsIpc.ts
  - electron/ipc/index.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/lib/lineDiff.ts
  - src/components/ai/roles/SkillsPanel.tsx
  - src/components/ai/roles/skillsView.ts
  - src/components/ai/roles/RolesSettingsModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/skillCatalog.test.ts
  - tests/unit/skillService.test.ts
  - tests/unit/skillsView.test.ts
  - tests/unit/lineDiff.test.ts
  - >-
    backlog/decisions/decision-61 -
    Менеджер-скиллов-проекта-копии-в-.claude-skills-и-.agents-skills-атомарная-замена-и-источники-импорта.md
  - .rag-index/
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вынесено из TASK-77 (п. 4 «Что сделать», decision-54 п. 12): список скиллов проекта в .claude/skills и .agents/skills, расхождения между копиями, копирование скилла из шаблона или другого проекта.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Чистый модуль skillCatalog.ts: разбор frontmatter SKILL.md, хэш содержимого с нормализацией EOL, сравнение копий по файлам, статусы synced/diverged/claudeOnly/agentsOnly, валидация id скилла; unit-тесты
- [x] #2 Сервис skillService.ts: список скиллов проекта в .claude/skills и .agents/skills (вложенные на уровень глубже — с предупреждением), без перехода по симлинкам и с лимитами размера; источники копирования: шаблон ProjectTemplate, другие зарегистрированные проекты, личные скиллы ~/.claude/skills
- [x] #3 Копирование скилла (между копиями одного проекта и из источника) атомарной заменой каталога; существующий отличающийся скилл перезаписывается только по явному выбору; пути проверяются (зарегистрированный проект, id без выхода из каталога); тесты на временных каталогах
- [x] #4 UI в менеджере ролей: вид «Скиллы» — список со статусами, сравнение файлов копий, предпросмотр SKILL.md, копирование в другую копию, импорт из источника с выбором целевых каталогов, индикатор расхождений; i18n ru/en
- [x] #5 ADR фиксирует модель: каталоги, статусы, правила перезаписи, источники; index-docs и lint:docs проходят
- [x] #6 Живая проверка в собранном exe (pack:win): скриншот вида «Скиллы» на временном проекте с расходящимися копиями, копирование работает
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. search_docs + impact по точкам встраивания (RolesSettingsModal, preload, electron.d.ts, регистрация IPC).
2. electron/services/skillCatalog.ts — чистая логика + tests/unit/skillCatalog.test.ts.
3. electron/services/skillService.ts — ФС: сканирование, источники, копирование с атомарной заменой + тесты на временных каталогах.
4. electron/ipc/skillsIpc.ts, preload, типы.
5. SkillsPanel.tsx в RolesSettingsModal, i18n.
6. decision-61, index-docs, lint:docs.
7. lint, test, check-bundle, pack:win, живая проверка через playwright-core.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация (2026-09-28), модель — decision-61.

- electron/services/skillCatalog.ts — чистый модуль: validateSkillId (1–2 сегмента, без .., скрытых и служебных имён), hashSkillFileContent (текст без учёта CRLF/LF, бинарные побайтно), hashSkillFiles, parseSkillMd (gray-matter, значения к строкам), diffSkillFiles, buildSkillCatalog/summarizeSkillCatalog (synced/diverged/claudeOnly/agentsOnly), skillCopyAction, skillCopyBlocker.
- electron/services/skillService.ts — сканирование корней (вложенные group/name с пометкой nested, каталог без SKILL.md — noSkillMd, ссылки не читаются, лимит 500 файлов / 20 МБ), источники (шаблон через resolveTemplatePath, ~/.claude/skills, зарегистрированные проекты), copySkill: временный каталог рядом → сверка хэша → rename, старый каталог уходит только после успеха; overwrite только с явным флагом; запись через ссылку/junction на пути запрещена.
- electron/ipc/skillsIpc.ts — skills:list/sources/sourceList/copy, всё через assertRegisteredProject; preload и типы рендерера.
- src/lib/lineDiff.ts — построчный LCS-дифф с пределом таблицы и collapseUnchanged (контекст 3 строки вокруг правок).
- src/components/ai/roles/SkillsPanel.tsx + skillsView.ts — вид «Скиллы проекта» в менеджере ролей: вкладки «В проекте» и «Импорт», индикатор расходящихся копий, перезапись через DialogHost (danger).
- i18n ru/en (раздел skills).

Проверки: npm run lint — 0 ошибок, 494 предупреждения (baseline); npm test — 181 файл / 2024 теста; tsc --noEmit чистый; check-bundle OK; index-docs + lint:docs OK; pack:win собран дважды (второй раз после сворачивания контекста диффа).

Живая проверка: обёртка C:\Temp\ph-105\app (redirect.cjs подменяет ~/.projecthub/projects.json на временный реестр) поверх dist-electron сборки pack:win, electron.exe + playwright-core, --user-data-dir во временном каталоге. Настоящий реестр не тронут (mtime 2026-09-01). Сценарий на временном проекте: 4 скилла со статусами расходятся/только Claude/только Antigravity/совпадают (code-style совпадает при CRLF и LF), проблема «нет description»; дифф release-notes +1 −2 с пофайловым сравнением; «Заменить копию Antigravity версией Claude» → диалог подтверждения → каталог заменён целиком (diff -r идентичен, лишний файл удалён, временных .projecthub-* нет); db-migrations скопирован; импорт review-helper из другого проекта в оба корня; у шаблона видны обе расходящиеся версии init-dev-project; отмена подтверждения при импорте ничего не пишет; console.error в окне — 0. Скриншоты: C:\Temp\ph-105\shots\01-skills-list … 06-import.png. Не проверено визуально: английская локаль (ключи проверены типами), импорт из ~/.claude/skills в UI (покрыт unit-тестом).

Наблюдение: копии init-dev-project в самом ProjectHub расходятся (.claude vs .agents) и отстают от F:\ProjectTemplate — менеджер это показывает; синхронизацию не выполнял, это решение пользователя.
<!-- SECTION:NOTES:END -->
