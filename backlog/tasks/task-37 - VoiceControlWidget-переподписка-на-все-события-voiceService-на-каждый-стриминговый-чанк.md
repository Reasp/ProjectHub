---
id: TASK-37
title: >-
  VoiceControlWidget: переподписка на все события voiceService на каждый
  стриминговый чанк
status: Review
assignee: []
created_date: '2026-09-05 09:08'
updated_date: '2026-09-10 02:03'
labels:
  - audit
  - performance
  - voice
  - P1
dependencies: []
references:
  - src/components/voice/VoiceControlWidget.tsx
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
modified_files:
  - src/components/voice/VoiceControlWidget.tsx
  - src/services/voiceService.ts
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункт аудита 3.2 (doc-7).

Главный `useEffect` в `VoiceControlWidget` зависит от `sessions`, `pendingApprovals`, `projects`, `selectedProject`, `activeSessionId`. Во время стриминга ответа `sessions` меняется на каждый чанк, поэтому эффект пересоздаёт 7 подписок и вызывает `voiceService.setLanguage` → `saveConfig` → `localStorage.setItem` и `syncToOverlay` (IPC) на каждый токен.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Подписки на voiceService и onVoiceExternalControl создаются один раз при монтировании, изменяемые данные (projects, sessions, approvals, language) читаются через useRef или useProjectStore.getState()/useAIStudioStore.getState() в момент команды
- [x] #2 voiceService.setLanguage вызывается только при фактическом изменении language
- [x] #3 Таймеры setTimeout в executeCommand и onDeviceNotice очищаются при размонтировании
- [ ] #4 Проверено React Profiler: во время стриминга VoiceControlWidget не выполняет cleanup/setup эффекта подписок
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Убрать из компонента подписку на useProjectStore()/useAIStudioStore() целиком: реактивно подписываться только на `language` через селектор.
2. `executeCommand` сделать стабильным (`useCallback` с пустыми зависимостями), все данные и экшены сторов читать через `useProjectStore.getState()` / `useAIStudioStore.getState()` в момент выполнения команды.
3. Разделить эффекты: `setLanguage` — отдельный эффект с зависимостью `[language]`; подписки на voiceService, `onVoiceExternalControl` и hotkey — эффект с стабильными зависимостями (фактически один раз при монтировании).
4. Все `setTimeout` (сброс transcript/feedback в executeCommand, скрытие уведомления устройства в onDeviceNotice) регистрировать через общий `scheduleTimeout` и очищать в cleanup эффекта подписок.
5. В `voiceService.setLanguage` добавить ранний выход, если язык не изменился (защита от лишних `saveConfig` → `localStorage.setItem`).
6. `tsc`, `npm run pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Что сделано**

- `src/components/voice/VoiceControlWidget.tsx`:
  - Компонент больше не вызывает `useProjectStore()` и `useAIStudioStore()` без селектора — раньше любое изменение любого из сторов (в т.ч. каждый стриминговый чанк в `sessions`) перерисовывало виджет. Теперь единственная реактивная подписка — `useProjectStore((s) => s.language)`.
  - `executeCommand` обёрнут в `useCallback([])`; `projects`, `selectedProject`, `sessions`, `pendingApprovals`, `processes`, `tasks`, `language` и все экшены читаются через `getState()` в момент команды, поэтому данные всегда актуальны без пересоздания функции.
  - Эффект подписок (`onStateChange`, `onPauseChange`, `onAudioLevel`, `onResult`, `onError`, `onDeviceNotice`, `onVoiceExternalControl`, hotkey Ctrl+Shift+V) теперь зависит только от стабильных `executeCommand` и `scheduleTimeout` — выполняется один раз при монтировании.
  - `voiceService.setLanguage` вынесен в отдельный эффект `[language]`.
  - Все `setTimeout` проходят через `scheduleTimeout`, идентификаторы хранятся в `timersRef` и очищаются в cleanup при размонтировании.
  - Удалён неиспользуемый импорт `VoiceConfig`.
- `src/services/voiceService.ts`: `setLanguage` не вызывает `saveConfig`, если язык не изменился.

**Проверка**

- `npx tsc --noEmit` — без ошибок.
- Структурно: зависимости эффекта подписок — две функции из `useCallback` с пустыми массивами зависимостей, изменение `sessions`/`pendingApprovals` компонент вообще не перерисовывает (нет подписки на `useAIStudioStore`).
- AC #4 (React Profiler во время стриминга) требует ручной проверки в запущенном приложении с реальной сессией Claude — в автономной сессии не выполнялась.
<!-- SECTION:NOTES:END -->
