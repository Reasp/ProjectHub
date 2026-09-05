---
id: TASK-30
title: >-
  Защита рендерера: setWindowOpenHandler, will-navigate, CSP, permission handler
  и Mermaid strict
status: To Do
assignee: []
created_date: '2026-09-05 09:07'
labels:
  - audit
  - security
  - electron
  - P0
dependencies: []
references:
  - electron/main.ts
  - src/components/common/MermaidDiagram.tsx
  - src/components/common/MarkdownViewer.tsx
  - index.html
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 4.2, 4.3, 4.4 (doc-7).

В `createWindow` нет `webContents.setWindowOpenHandler` и обработчика `will-navigate`: ссылка `target=_blank` из MarkdownViewer (документ, задача, ответ LLM) открывает внешний сайт в окне Electron с тем же preload и доступом к `window.api`. `MermaidDiagram` инициализирует mermaid с `securityLevel: 'loose'` и вставляет SVG через `dangerouslySetInnerHTML`, что позволяет XSS из markdown-контента. В `index.html` отсутствует CSP. `setPermissionRequestHandler`/`setPermissionCheckHandler` разрешают любые permission для любых webContents.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 setWindowOpenHandler открывает http/https через shell.openExternal и возвращает { action: 'deny' } для всех остальных
- [ ] #2 Обработчик will-navigate блокирует навигацию за пределы file:// dist и VITE_DEV_SERVER_URL
- [ ] #3 В index.html добавлен meta Content-Security-Policy (default-src 'self'; img-src 'self' data: file:; connect-src для dev-сервера/Ollama/API), приложение работает в dev и prod
- [ ] #4 mermaid.initialize использует securityLevel 'strict'; SVG перед вставкой проходит DOMPurify (или эквивалент)
- [ ] #5 Permission handler разрешает только media/audioCapture для собственных окон, остальное отклоняется
- [ ] #6 Ссылки в MarkdownViewer открываются через window.api.openExternal, а не target=_blank
<!-- AC:END -->
