---
id: TASK-30
title: >-
  Защита рендерера: setWindowOpenHandler, will-navigate, CSP, permission handler
  и Mermaid strict
status: Done
assignee: []
created_date: '2026-09-05 09:07'
updated_date: '2026-09-05 11:57'
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
modified_files:
  - electron/main.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - index.html
  - src/components/common/MermaidDiagram.tsx
  - src/components/common/MarkdownViewer.tsx
  - src/components/actions/ActionRunnerBar.tsx
  - package.json
  - package-lock.json
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
- [x] #1 setWindowOpenHandler открывает http/https через shell.openExternal и возвращает { action: 'deny' } для всех остальных
- [x] #2 Обработчик will-navigate блокирует навигацию за пределы file:// dist и VITE_DEV_SERVER_URL
- [x] #3 В index.html добавлен meta Content-Security-Policy (default-src 'self'; img-src 'self' data: file:; connect-src для dev-сервера/Ollama/API), приложение работает в dev и prod
- [x] #4 mermaid.initialize использует securityLevel 'strict'; SVG перед вставкой проходит DOMPurify (или эквивалент)
- [x] #5 Permission handler разрешает только media/audioCapture для собственных окон, остальное отклоняется
- [x] #6 Ссылки в MarkdownViewer открываются через window.api.openExternal, а не target=_blank
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что сделано

**electron/main.ts** — блок «Защита рендерера (TASK-30)»:
- `hardenWebContents(contents)` применяется к главному окну и к voice-overlay: `setWindowOpenHandler` (http/https → `shell.openExternal`, всегда `{ action: 'deny' }`), `will-navigate` и `will-redirect` блокируют всё, кроме `isAppUrl` (origin `VITE_DEV_SERVER_URL` или `file://` строго внутри `dist/`), `will-attach-webview` запрещён.
- Permission-handler'ы: `isPermissionAllowed` разрешает только `media` (только audio-типы), `audioCapture` и `clipboard-sanitized-write` (кнопки «Копировать» в MarkdownViewer/терминале), и только для webContents собственных окон с app-URL. Всё остальное — отказ с логом `[Security]`.
- IPC `shell:openExternal`: принимает только http/https/mailto, открывает в системном браузере, возвращает boolean.

**preload / types**: `window.api.openExternal(url)`.

**index.html**: meta CSP — `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: http: https:; connect-src 'self' http(s)://127.0.0.1:* / localhost:* + ws для HMR + https:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`. Одна политика для dev и prod: preamble React Refresh в @vitejs/plugin-react 6 — виртуальный модуль, а не inline-скрипт, поэтому `script-src 'self'` работает в dev. `'unsafe-inline'` для стилей нужен Tailwind в dev, inline-стилям React и `<style>` внутри SVG Mermaid. `connect-src` с любым локальным портом — потому что адреса Ollama/локального Whisper настраиваются пользователем.

**MermaidDiagram.tsx**: `securityLevel: 'strict'`, SVG перед `dangerouslySetInnerHTML` проходит `DOMPurify.sanitize` (профили svg+svgFilters+html, `foreignObject` разрешён для htmlLabels — как делает сам mermaid, script/iframe/object/embed и on*-атрибуты вырезаются). `dompurify` добавлен явной зависимостью в package.json (раньше был только транзитивным через mermaid).

**MarkdownViewer.tsx**: компонент `ExternalLink` вместо `<a target="_blank">`: клик → `preventDefault` + `window.api.openExternal` для http/https/mailto; относительные пути и прочие схемы отображаются серыми и не открываются. **ActionRunnerBar.tsx**: ссылка на dev-URL тоже через `openExternal`.

## Проверка
- `tsc --noEmit` — чисто; `npm run pack:win` — успешно, `release/win-unpacked/ProjectHub.exe` обновлён.
- Собранный exe: окно открывается, в консоли рендерера нет `Refused ...` (CSP-отказов), MCP-сервер и Whisper стартуют.
- `npm run dev` (40 с): Vite HMR подключился по ws, React смонтировался, CSP-отказов нет.
- Запуск Electron из shell агента — только со снятой `ELECTRON_RUN_AS_NODE` (см. память проекта).

## На что смотреть при ревью
- Список разрешений: `clipboard-sanitized-write` добавлен сверх «media/audioCapture» из AC #5 — иначе `navigator.clipboard.writeText` в кнопках копирования отклоняется.
- Если у пользователя картинки в markdown лежат по `http://` не на localhost — `img-src` их пропускает намеренно.
- Пункт 4.3 аудита про `sandbox: false` не трогал: preload использует `ipcRenderer` напрямую, включение sandbox — отдельная задача.
<!-- SECTION:NOTES:END -->
