---
id: TASK-76.5
title: 'UI памяти проекта во вкладке документов: просмотр, правка, удаление, i18n'
status: Review
assignee: []
created_date: '2026-09-26 13:28'
updated_date: '2026-09-26 14:29'
labels:
  - memory
  - ui
dependencies:
  - TASK-76.2
parent_task_id: TASK-76
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-51. Раздел Память в Docs проекта: список фактов (тип, источник, дата), просмотр, правка, удаление с подтверждением через DialogHost (decision-17), ошибки валидации и секретов понятным текстом, строки ru/en.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Факты памяти видны списком с фильтром по типу; факт открывается, правится и удаляется, MEMORY.md обновляется
- [x] #2 Ошибки записи (секрет, дубликат, лимиты) показаны переведённым текстом; строки ru и en
- [x] #3 Модалки через createPortal и шкалу z-index decision-17
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Сделано: src/components/docs/MemoryView.tsx (список фактов с фильтром по типу и поиском, карточка с источником/автором/датами и телом через MarkdownViewer, форма создания и правки, удаление с подтверждением через useDialogStore → DialogHost z-[10001], уведомления через useTimeoutState, сброс выбора при смене проекта), переключатель «Документы | Память» в шапке DocsRagView, memoryErrorView.ts (перевод кодов: формат, секреты по видам, дубликат с id и заголовком, неизвестная ошибка), строки ru/en (раздел memory в i18n). Новых модалок нет — подтверждение идёт через существующий DialogHost (decision-17). Тест memoryErrorView: у каждого кода хранилища, формата и вида секрета есть перевод ru/en, наборы ключей совпадают. Скриншоты свежего кода (electron.exe поверх vite build; пользовательский ProjectHub.exe запущен из release/win-unpacked, pack:win упал на ENOTFOUND github.com): список и карточка, отказ по секрету в форме (JWT), подтверждение удаления, RU-интерфейс и форма правки. По скриншоту убран дубль подписи типа в подсказках.
<!-- SECTION:NOTES:END -->
