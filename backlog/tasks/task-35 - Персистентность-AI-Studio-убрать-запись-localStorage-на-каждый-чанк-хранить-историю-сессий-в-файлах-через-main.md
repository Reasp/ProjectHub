---
id: TASK-35
title: >-
  Персистентность AI Studio: убрать запись localStorage на каждый чанк, хранить
  историю сессий в файлах через main
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
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
- [ ] #1 Запись состояния во время стриминга дебаунсится (не чаще раза в 1–2 с) и выполняется после завершения ответа
- [ ] #2 История сессий хранится в файлах ~/.projecthub/sessions/<hash(projectPath)>/<sessionId>.json через IPC, в localStorage остаются только лёгкие настройки (config без ключа, mode, activeSessionId)
- [ ] #3 Тяжёлые поля (diff.oldContent/newContent, результаты команд) усечены до разумного лимита при сохранении, полный вывод доступен только в течение живой сессии
- [ ] #4 Существующие сессии из localStorage мигрируются в файлы при первом запуске
- [ ] #5 Профилирование: при стриминге 2000 токенов нет заметных пауз ввода в PromptInputArea
<!-- AC:END -->
