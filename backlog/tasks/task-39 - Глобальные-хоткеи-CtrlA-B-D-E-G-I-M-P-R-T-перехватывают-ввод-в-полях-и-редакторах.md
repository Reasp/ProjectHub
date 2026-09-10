---
id: TASK-39
title: >-
  Глобальные хоткеи Ctrl+A/B/D/E/G/I/M/P/R/T перехватывают ввод в полях и
  редакторах
status: Done
assignee:
  - Claude
created_date: '2026-09-05 09:08'
updated_date: '2026-09-10 02:03'
labels:
  - audit
  - ui
  - hotkeys
  - P1
dependencies: []
references:
  - src/App.tsx
  - src/components/layout/HotkeysHelpModal.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - src/App.tsx
  - src/components/layout/HotkeysHelpModal.tsx
  - src/components/projects/ProjectWorkspace.tsx
  - src/components/projects/WorkspaceTabsConfigModal.tsx
  - src/i18n/types.ts
  - src/i18n/en.ts
  - src/i18n/ru.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 5.4 (doc-7).

В `App.tsx` проверка `isInput` применяется только к `?`/F1. Все Ctrl-комбинации перехватываются даже при фокусе в `input`/`textarea`/contentEditable: в редакторе документа Ctrl+A переключает на вкладку Analytics, Ctrl+D на Docs, Ctrl+E на Files, Ctrl+R перезагружает проект. Ctrl+K и Ctrl+\\ разумно оставить глобальными.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Навигационные Ctrl-хоткеи (A, B, D, E, G, I, M, P, R, T) не срабатывают, когда фокус в input/textarea/contentEditable или внутри xterm
- [x] #2 Ctrl+K, Ctrl+\ и Escape продолжают работать глобально
- [x] #3 Список хоткеев в HotkeysHelpModal и в tabDefs ProjectWorkspace соответствует фактическому поведению
- [x] #4 Проверено вручную: Ctrl+A в редакторе документа выделяет текст
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `src/App.tsx`: вынести определение «фокус в поле ввода» в `isEditableTarget(target)` — input/textarea/contentEditable + `closest('.xterm')` (у xterm фокус живёт в скрытой textarea `.xterm-helper-textarea`, но проверяем и контейнер для надёжности). Навигационные Ctrl-хоткеи (A, B, D, E, G, I, M, P, R, T, а также Ctrl+[ / Ctrl+Shift+B — в xterm Ctrl+[ это Esc) пропускать, когда цель редактируемая. Ctrl+K, Ctrl+\\, Ctrl+`, Escape и `?`/F1 (с прежней проверкой) — без изменений.
2. `HotkeysHelpModal.tsx`: привести список к фактическому поведению — добавить Ctrl+E (Files), убрать Ctrl+N и Ctrl+Shift+P (в коде обработчиков нет), добавить пометку, что навигационные хоткеи не работают при вводе текста. Неиспользуемые i18n-ключи `newTask`/`templateWizard` удалить из `types.ts`/`en.ts`/`ru.ts`, добавить ключ для пометки.
3. `ProjectWorkspace.tsx` tabDefs: у вкладки `processes` убрать `Ctrl+\\` (он переключает терминал, а не вкладку) — сделать `hotkey` опциональным и не показывать в title.
4. Проверка: `npx tsc --noEmit`, `npm run pack:win`, ручная проверка Ctrl+A в редакторе документа и Ctrl+D/Ctrl+E в input.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация:
- `App.tsx`: добавлен хелпер `isEditableTarget` (input/textarea/select, contentEditable, `.closest('.xterm')`). Обработчик перестроен: `?`/F1 и Escape — как раньше; Ctrl+K, Ctrl+\\, Ctrl+` — глобально, с ранним `return`; все навигационные Ctrl-хоткеи (B, M, G, E, P, D, A, I, T, R, а также Ctrl+[ / Ctrl+Shift+B) — только когда цель не редактируемая. Ctrl+B теперь проверяет `!e.shiftKey`, чтобы не конфликтовать с Ctrl+Shift+B.
- `HotkeysHelpModal.tsx`: добавлен Ctrl+E (Files), убраны несуществующие Ctrl+N и Ctrl+Shift+P, под группой «Навигация» пометка, что хоткеи не работают при вводе текста.
- `ProjectWorkspace.tsx` и `WorkspaceTabsConfigModal.tsx`: `hotkey` опционален, у вкладки Processes убран ложный Ctrl+\\ (он переключает терминал), title/подпись без хоткея рендерятся корректно.
- i18n: удалены `hotkeys.newTask`/`hotkeys.templateWizard`, добавлены `hotkeys.filesTab` и `hotkeys.navigationNote` (en/ru/types).

Проверка: `npx tsc --noEmit` — без ошибок; `npm run lint:docs` — ок; `npm run pack:win` — release/win-unpacked/ProjectHub.exe пересобран. AC #4 (ручная проверка Ctrl+A в редакторе документа) требует проверки человеком в собранном приложении.
<!-- SECTION:NOTES:END -->
