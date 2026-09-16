---
id: TASK-86
title: 'Аудит HITL: решение помечается decidedBy local без подтверждённого клика'
status: Review
assignee: []
created_date: '2026-09-16 00:25'
updated_date: '2026-09-16 02:00'
labels:
  - hitl
  - audit
  - security
dependencies:
  - TASK-82
modified_files:
  - electron/services/hitlPolicy.ts
  - electron/services/hitlTypes.ts
  - electron/services/claudeBridgeService.ts
  - electron/ipc/hitlIpc.ts
  - electron/ipc/aiIpc.ts
  - src/types/electron.d.ts
  - tests/unit/hitlDecisionSource.test.ts
  - tests/unit/hitlService.test.ts
  - tests/unit/claudeBridgeService.test.ts
  - tests/unit/claudeCliHitl.test.ts
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
- [x] #1 Воспроизведено и установлено, какой код одобряет карточки computer_action в прогоне AI Studio (клик пользователя или автоматический путь)
- [x] #2 Решение, принятое не человеком, помечается в аудите отличным от local источником (например auto) — дефолтный source в sendApprovalResponse не выдаёт автоматику за пользователя
- [x] #3 Поведение покрыто unit-тестом: автоматический путь не даёт decidedBy local
- [x] #4 Если дефект был только в методике проверки (клик не логировался) — это зафиксировано в задаче, и код оставлен без изменений
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Что установлено (AC #1, #4)

Карточки `computer_action` в прогоне AI Studio одобрял **человек кликом в окне ProjectHub** — пользователь подтвердил это 2026-09-16. То есть `decidedBy: local` в аудите верен, а дефект был в методике проверки.

Доказательства из артефактов прогона:
- `waitedMs` у спорных решений — 277457 / 12355 / 5682 / 1566 мс, тогда как у авто-решений политики (`decidedBy: auto`, правило `computer-allowlist`) в том же журнале `waitedMs: 0`;
- у записей нет `deviceName`, а путь кнопок системного уведомления (`notificationService`) пишет `deviceName: "Системное уведомление"`;
- в первом прогоне сработал kill-switch «human grabbed the mouse» — человек физически был за машиной.

**Почему счётчик решений был нулевым.** Драйвер `driver-exe.mjs` искал кнопку одобрения строго по тексту `^(Разрешить|Allow|Approve)$`, а в `InteractiveApprovalCard` кнопка подписана `t.aiStudio.approval.allowOnce` = «Одобрить один раз» и содержит внутри голосовой бейдж. Совпадений не было ни одного, поэтому `shots/exe-decisions.txt` и `shots/exe2-decisions.txt` пусты (0 байт) — драйвер не сделал и не залогировал ни одного клика, хотя человек кликал сам. MCP-одобрители `approver.mjs`/`approver2.mjs` (они пишут `kind: 'mcp'`) в exe-прогоне не применялись: реальный `mcp_server_token` отсутствовал.

## Что исправлено в коде (AC #2)

Дефект в аудите всё же был — в виде опасных умолчаний, которые позволяли неинтерактивному вызову попасть в журнал как решение человека:

1. `claudeBridgeService.sendApprovalResponse(requestId, response, source = { kind: 'local' })` — дефолт убран, `source` обязателен. Любой новый вызывающий обязан назвать источник явно.
2. `ipcMain.handle('hitl:decide')` сводил **любое** неизвестное значение `source.kind` к `local` (`source?.kind === 'remote' || source?.kind === 'mcp' ? source.kind : 'local'`). Теперь источник проверяется белым списком.
3. Новая чистая функция `normalizeDecisionSource` в `hitlPolicy.ts` (правило 17 — без Electron/React, покрыта тестами): отсутствие источника → `local` (вызов из окна); `local|remote|mcp` → проходят с обрезкой `deviceId`/`deviceName`; `auto|timeout|cancelled|shutdown` и мусор → `null`, решение не применяется. Поле `rule` (имя авто-правила) извне не принимается — оно принадлежит источнику `auto`.
4. `HitlDecideResult` получил `reason: 'invalid_source'` (в `hitlTypes.ts` и в типах рендерера).
5. `aiIpc` передаёт `{ kind: 'local' }` явно с комментарием, что вызов пришёл из окна через preload.

## Тесты (AC #3)

- `tests/unit/hitlDecisionSource.test.ts` — 6 кейсов на `normalizeDecisionSource`: пустой источник, внешние источники с устройством, отклонение `auto`/`timeout`/`cancelled`/`shutdown`, отклонение мусора вместо подмены на `local`, непротекание `rule`, состав белого списка.
- `tests/unit/hitlService.test.ts` — новый кейс: решение с источником `auto` пишется в аудит как `decidedBy: auto` с именем правила, а выборка `decidedBy: 'local'` остаётся пустой.
- Обновлены вызовы в `claudeBridgeService.test.ts` и `claudeCliHitl.test.ts` (обязательный `source`). Тесты в `tsconfig.json` не входят, поэтому смену сигнатуры поймал не `tsc`, а прогон vitest.

Проверки: `npm test` — 759 тестов зелёные (76 файлов), `npm run lint` — 0 ошибок (503 предупреждения baseline), `npx tsc --noEmit` — чисто, `npm run lint:docs` — чисто.

## Замечание на будущее

Автоматические прогоны UI не должны опираться на точный текст кнопки. Для сценариев с HITL надёжнее MCP-путь (`projecthub_list_pending_approvals` + `projecthub_approve_action`, источник `mcp` в аудите) — он же честно отличается от человека в журнале.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Разобрано: карточки `computer_action` в прогоне TASK-82 одобрял человек кликом в окне ProjectHub (подтверждено пользователем), поэтому `decidedBy: local` в аудите был верен. Нулевой счётчик решений — дефект методики: драйвер `driver-exe.mjs` искал кнопку по строгому тексту `^(Разрешить|Allow|Approve)$`, а кнопка подписана «Одобрить один раз» и содержит внутри голосовой бейдж, так что ни одного клика драйвер не сделал и не залогировал (`shots/exe*-decisions.txt` пусты). Косвенные подтверждения присутствия человека: `waitedMs` 277457/12355/5682/1566 мс против `waitedMs: 0` у авто-решений, отсутствие `deviceName` (его пишет путь системного уведомления) и сработавший kill-switch «human grabbed the mouse».

Дефект в самом аудите всё равно был устранён — опасные умолчания позволяли неинтерактивному вызову назваться человеком:
- `claudeBridgeService.sendApprovalResponse` больше не имеет дефолта `source = { kind: 'local' }` — источник обязателен;
- `hitl:decide` не сводит неизвестный `source.kind` к `local`: новая чистая функция `normalizeDecisionSource` (`hitlPolicy.ts`) принимает только `local|remote|mcp`, отсутствие источника трактует как вызов из окна, а `auto|timeout|cancelled|shutdown` и мусор отклоняет новым `reason: 'invalid_source'`; имя авто-правила `rule` извне не принимается;
- `aiIpc` передаёт `{ kind: 'local' }` явно.

Покрытие: `tests/unit/hitlDecisionSource.test.ts` (6 кейсов) и новый кейс в `hitlService.test.ts` — решение с источником `auto` пишется как `decidedBy: auto`, выборка по `local` пуста. Уточнение зафиксировано в [[decision-10]] п. 4 (ADR действующий, статус не менялся — это восстановление заявленной в нём семантики, а не новый выбор).

Проверки: `npm test` 759/759 зелёные, `npm run lint` 0 ошибок (503 предупреждения — baseline), `npx tsc --noEmit` чисто, `npm run lint:docs` чисто, `npm run index-docs` пересобран (39 файлов, 362 чанка), `npm run pack:win` завершился успешно (`dist-electron/main.js` обновлён, `check-bundle` в составе `build` пройден). Файлы в `release/win-unpacked/` при этом не синхронизированы: они заблокированы запущенным `ProjectHub.exe` (EPERM/EBUSY), поэтому сам exe остался от предыдущей сборки — обновится после перезапуска приложения.
<!-- SECTION:FINAL_SUMMARY:END -->
