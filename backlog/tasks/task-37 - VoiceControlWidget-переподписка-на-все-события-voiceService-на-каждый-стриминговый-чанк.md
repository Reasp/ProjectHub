---
id: TASK-37
title: >-
  VoiceControlWidget: переподписка на все события voiceService на каждый
  стриминговый чанк
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
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
- [ ] #1 Подписки на voiceService и onVoiceExternalControl создаются один раз при монтировании, изменяемые данные (projects, sessions, approvals, language) читаются через useRef или useProjectStore.getState()/useAIStudioStore.getState() в момент команды
- [ ] #2 voiceService.setLanguage вызывается только при фактическом изменении language
- [ ] #3 Таймеры setTimeout в executeCommand и onDeviceNotice очищаются при размонтировании
- [ ] #4 Проверено React Profiler: во время стриминга VoiceControlWidget не выполняет cleanup/setup эффекта подписок
<!-- AC:END -->
