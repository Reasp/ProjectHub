---
id: TASK-50
title: >-
  Мелкие утечки и оптимизации: очистка setTimeout в компонентах, автоочистка
  завершённых PTY-сессий, RAG в utilityProcess
status: To Do
assignee: []
created_date: '2026-09-05 09:10'
labels:
  - audit
  - performance
  - memory-leak
  - P2
dependencies: []
references:
  - src/components/git/GitInspector.tsx
  - src/components/docs/DocsRagView.tsx
  - src/App.tsx
  - electron/services/ptyService.ts
  - electron/services/ragSearch.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: low
type: enhancement
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 2.7, 2.8, 3.8 (doc-7).

26 вызовов `setTimeout` в компонентах (GitInspector showError/showSuccess, DocsRagView, FileExplorer, App.showRemoteToast, VoiceControlWidget, MarkdownViewer CodeBlock) не очищаются при размонтировании, что приводит к setState после unmount и «залипающим» уведомлениям. Завершившиеся PTY-сессии остаются в `ptyService.sessions` и в списке вкладок с xterm-буфером 5000 строк до ручного закрытия. `ragSearch` загружает transformers и LanceDB в main-процесс, эмбеддинг запроса блокирует event loop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Введён хук useTimeoutState/useToast, все временные уведомления используют его и очищают таймеры в cleanup
- [ ] #2 Сессии PTY со статусом exited автоматически удаляются через настраиваемый таймаут (по умолчанию 10 минут) с уведомлением в UI
- [ ] #3 Эмбеддинг и поиск LanceDB вынесены в utilityProcess или worker_threads; main не блокируется при поиске
- [ ] #4 Проверено: после закрытия модалок и переключения вкладок в консоли нет предупреждений о setState на размонтированных компонентах
<!-- AC:END -->
