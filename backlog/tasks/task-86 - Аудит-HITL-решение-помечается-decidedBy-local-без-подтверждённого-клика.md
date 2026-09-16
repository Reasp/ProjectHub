---
id: TASK-86
title: 'Аудит HITL: решение помечается decidedBy local без подтверждённого клика'
status: To Do
assignee: []
created_date: '2026-09-16 00:25'
labels:
  - hitl
  - audit
  - security
dependencies:
  - TASK-82
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обнаружено в TASK-82 (2026-09-16) при прогоне сценария «Блокнот» в собранном приложении (`release/win-unpacked/ProjectHub.exe`, Claude CLI в AI Studio).

## Симптом
Действия в диалоге «Save As» были корректно подняты политикой до `dangerous` и создали карточки `computer_action`:
- «Опасное действие на компьютере: computer_set_value → notepad.exe «Save As»»
- «Опасное действие на компьютере: computer_press_button → notepad.exe «Save As»»

В аудите (`<userData>/audit/hitl-2026-09.jsonl`) они записаны как `decision: allow`, `decidedBy: local`. По `hitlTypes.ts` значение `local` означает «Пользователь в окне ProjectHub».

Проблема: автоматический одобритель прогона (Playwright, клики по кнопкам «Разрешить»/«Отклонить») не зафиксировал **ни одного** клика — счётчик решений равен 0, файл решений пуст. То есть карточки были одобрены без подтверждённого действия человека, но в журнале помечены как решение человека.

## Что уже проверено
- `sendApprovalResponse` вызывается только из IPC (`electron/ipc/aiIpc.ts`) → preload → UI (`AIStudioView.tsx`, `VoiceControlWidget.tsx`); автоматического пути к нему не найдено.
- Дефолт источника: `sendApprovalResponse(requestId, response, source: HitlDecisionSource = { kind: 'local' })` в `claudeBridgeService.ts` — если вызвать без явного `source`, решение будет помечено как пользовательское.
- Авто-ответ моста без повторного `permission_prompt` относится к инструментам `mcp__projecthub-hitl__computer_*` (политику уже применил прокси), а не к карточкам `computer_action`.
- В конфиге пользователя `autoApprove: false`, `autoApproveRules.enabled: true` (allowFileWrite/allowFileRead/allowSubagents).

## Почему важно
Журнал HITL — доказательство того, кто разрешил опасное действие на компьютере (decision-27 п. 4, decision-10). Если решение, принятое автоматически, помечается как `local`, аудит перестаёт отличать человека от автоматики.

## Гипотезы
1. Клик всё же произошёл, но не был залогирован драйвером проверки (тогда дефект только в методике, а не в коде).
2. Решение сформировано кодом с дефолтным `source = { kind: 'local' }` — тогда нужен явный источник (`auto`) во всех неинтерактивных путях.

См. [[decision-27]], [[decision-10]], TASK-82.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Воспроизведено и установлено, какой код одобряет карточки computer_action в прогоне AI Studio (клик пользователя или автоматический путь)
- [ ] #2 Решение, принятое не человеком, помечается в аудите отличным от local источником (например auto) — дефолтный source в sendApprovalResponse не выдаёт автоматику за пользователя
- [ ] #3 Поведение покрыто unit-тестом: автоматический путь не даёт decidedBy local
- [ ] #4 Если дефект был только в методике проверки (клик не логировался) — это зафиксировано в задаче, и код оставлен без изменений
<!-- AC:END -->
