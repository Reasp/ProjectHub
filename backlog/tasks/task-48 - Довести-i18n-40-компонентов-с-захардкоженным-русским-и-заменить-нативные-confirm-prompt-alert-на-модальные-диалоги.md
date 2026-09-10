---
id: TASK-48
title: >-
  Довести i18n (40 компонентов с захардкоженным русским) и заменить нативные
  confirm/prompt/alert на модальные диалоги
status: Review
assignee: []
created_date: '2026-09-05 09:10'
updated_date: '2026-09-10 07:36'
labels:
  - audit
  - i18n
  - ui
  - P2
dependencies: []
references:
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - src/components/voice/VoiceControlWidget.tsx
  - src/components/common/MarkdownViewer.tsx
  - src/components/kanban/KanbanBoard.tsx
  - src/components/git/GitInspector.tsx
  - src/components/explorer/FileExplorer.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: low
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 6.7, 6.8 (doc-7).

Задача 16 (i18n) закрыта, но 40 файлов в `src/components` содержат захардкоженные русские строки: HUD голосового виджета («Слушаю речь…», «Talon Voice активен», «Whisper инференс…»), диалоги confirm в KanbanBoard/FileExplorer/GitInspector, «Скопировано/Копировать» в MarkdownViewer, ошибки MermaidDiagram, сообщения `[Backlog] …` в terminalLogs, заголовок окна. Кроме того, 14 вызовов `confirm()`/`prompt()`/`alert()` блокируют рендерер нативными диалогами (переименование сессии, alias голоса, удаление ветки/файла/задачи, «Rule 5» на канбане).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все пользовательские строки в src/components вынесены в словари ru/en; grep по кириллице в src/components возвращает только комментарии
- [x] #2 Реализованы общие компоненты ConfirmDialog и PromptDialog (Promise-API через хук useDialog), все 14 вызовов confirm/prompt/alert заменены
- [x] #3 Логи terminalLogs формируются через t(), либо ключи и параметры сохраняются и локализуются при отображении
- [x] #4 Проверено переключение языка: HUD голоса, диалоги подтверждения и MarkdownViewer отображаются на выбранном языке
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
1. Очищены от кириллических строк все 40+ компонентов в src/components. Скрипт проверки кириллицы вне комментариев возвращает строго 0 строк.
2. Реализованы DialogHost, useDialog и useDialogStore с Promise-API (confirm, prompt, alert), полностью заменены нативные блокирующие вызовы confirm/prompt/alert в UI.
3. Логи terminalLogs формируются через словарь t() и добавлены в словари.
4. Синхронизированы и расширены словари src/i18n/ru.ts, src/i18n/en.ts и типы src/i18n/types.ts.
5. TypeScript (npx tsc --noEmit) — 0 ошибок.
6. ESLint (npm run lint) — 0 ошибок.
7. Unit-тесты (npm test) — 22 тест-файла, 186 пройденных тестов.
8. Документация (npm run lint:docs) — 83 файла проверено, 100% валидно, RAG-индекс актуален.
9. Сборка десктопного приложения (npm run pack:win) выполнена успешно в release/win-unpacked/ProjectHub.exe (Правило 14).
<!-- SECTION:NOTES:END -->
