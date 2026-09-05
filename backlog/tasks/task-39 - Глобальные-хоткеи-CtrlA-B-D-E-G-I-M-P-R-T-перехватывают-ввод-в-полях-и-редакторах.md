---
id: TASK-39
title: >-
  Глобальные хоткеи Ctrl+A/B/D/E/G/I/M/P/R/T перехватывают ввод в полях и
  редакторах
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
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
- [ ] #1 Навигационные Ctrl-хоткеи (A, B, D, E, G, I, M, P, R, T) не срабатывают, когда фокус в input/textarea/contentEditable или внутри xterm
- [ ] #2 Ctrl+K, Ctrl+\ и Escape продолжают работать глобально
- [ ] #3 Список хоткеев в HotkeysHelpModal и в tabDefs ProjectWorkspace соответствует фактическому поведению
- [ ] #4 Проверено вручную: Ctrl+A в редакторе документа выделяет текст
<!-- AC:END -->
