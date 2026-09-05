---
id: TASK-35
title: >-
  Персистентность AI Studio: убрать запись localStorage на каждый чанк, хранить
  историю сессий в файлах через main
status: Review
assignee: []
created_date: '2026-09-05 09:07'
updated_date: '2026-09-05 21:50'
labels:
  - audit
  - performance
  - ai-studio
  - P1
dependencies: []
references:
  - src/store/useAIStudioStore.ts
  - electron/main.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - electron/services/aiSessionStore.ts
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/aiSessionPersistence.ts
  - src/store/useAIStudioStore.ts
  - src/components/ai/AIStudioView.tsx
  - tests/unit/aiSessionStore.test.ts
  - tests/unit/aiSessionPersistence.test.ts
priority: high
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 3.1 (doc-7).

`useAIStudioStore` обёрнут в zustand `persist`: на каждый стриминговый чанк (по токену) весь объект `sessions` всех проектов сериализуется в `localStorage`. В сессиях лежат `toolCalls` с `diff.oldContent/newContent` и полным выводом команд. Это даёт лаг ввода при стриминге и переполнение квоты localStorage (5–10 МБ), после которого persist молча перестаёт сохранять, а история теряется при перезапуске.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Запись состояния во время стриминга дебаунсится (не чаще раза в 1–2 с) и выполняется после завершения ответа
- [x] #2 История сессий хранится в файлах ~/.projecthub/sessions/<hash(projectPath)>/<sessionId>.json через IPC, в localStorage остаются только лёгкие настройки (config без ключа, mode, activeSessionId)
- [x] #3 Тяжёлые поля (diff.oldContent/newContent, результаты команд) усечены до разумного лимита при сохранении, полный вывод доступен только в течение живой сессии
- [x] #4 Существующие сессии из localStorage мигрируются в файлы при первом запуске
- [ ] #5 Профилирование: при стриминге 2000 токенов нет заметных пауз ввода в PromptInputArea
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Что сделано**

- `electron/services/aiSessionStore.ts` (новый): файловое хранилище `~/.projecthub/sessions/<sha1(projectPath)[:16]>/<sessionId>.json`. Хэш пути без учёта регистра и разделителей; `project.json` с исходным путём в каталоге проекта. `sessionId` валидируется регуляркой (`[A-Za-z0-9_-]{1,120}`) — защита от path traversal. Запись атомарная (tmp + rename). `compactSessionForStorage` усекает: `diff.oldContent/patch` до 20 000 символов, `diff.newContent` — только для уже принятых/отклонённых diff (pending остаётся целым, иначе после перезапуска применился бы обрезанный файл), `toolCall.result` и строковые `args` — до 8 000, текст сообщений — до 200 000; при усечении ставится `diff.truncated = true`. `importLegacy` — миграция старого localStorage-блоба без перезаписи существующих файлов, пустые диалоги пропускаются.
- IPC `aiSessions:list/save/delete/import` в `main.ts`, мост в `preload.ts`, типы `AISession` и методы в `electron.d.ts`.
- `src/store/aiSessionPersistence.ts` (новый): `createDebouncedStorage` — обёртка над localStorage для zustand persist (запись раз в 1 с, пропуск одинаковых значений, синхронный сброс на `pagehide/beforeunload`); `SessionPersister` — одна подписка на `sessions` стора, сравнение по ссылке, дебаунс 1.5 с, немедленный `flushNow()` на complete/error стрима, удаление файла при закрытии диалога; `migrateLegacySessions` — вырезает `sessions` из блоба после импорта.
- `useAIStudioStore`: `sessions` убраны из `partialize`, `merge/migrate` отбрасывают legacy-`sessions`, `version: 2`; добавлены `sessionsLoaded` и `loadSessions(projectPath)` (один раз на проект, слияние с сессиями, созданными до загрузки). `AIStudioView` вызывает `loadSessions` и создаёт пустой диалог только после загрузки.
- Тесты: `tests/unit/aiSessionStore.test.ts`, `tests/unit/aiSessionPersistence.test.ts` (22 теста): хэш, валидация id, save/list/delete, усечение, миграция, дебаунс (50 обновлений → 1 запись).

**AC #5 (профилирование)** не отмечен: запись localStorage на каждый чанк убрана полностью (сессии не сериализуются в рендерере вообще, настройки — не чаще раза в секунду и только при изменении), но живое измерение пауз ввода в PromptInputArea при стриминге 2000 токенов нужно подтвердить вручную на собранном `release/win-unpacked/ProjectHub.exe`.
<!-- SECTION:NOTES:END -->
