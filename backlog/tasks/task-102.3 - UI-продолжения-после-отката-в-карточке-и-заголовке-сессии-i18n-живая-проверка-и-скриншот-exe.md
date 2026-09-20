---
id: TASK-102.3
title: >-
  UI продолжения после отката в карточке и заголовке сессии, i18n, живая
  проверка и скриншот exe
status: Review
assignee: []
created_date: '2026-09-19 13:42'
updated_date: '2026-09-20 00:50'
labels:
  - swarm
  - ui
dependencies: []
parent_task_id: TASK-102
priority: low
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-48 п. 6. Подпись кнопки по режиму во вкладке «Таймлайн», кнопка «Продолжить после отката» в заголовке сессии done-loop/handoff, dialog.prompt (DialogHost z-[10001]), пометки отменённых итераций/этапов и продолжений, ru/en. Живой прогон на qwen2.5:7b-instruct (done-loop и handoff), скриншот собранного exe.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопки и пометки видны в собранном exe (скриншот)
- [x] #2 Живой прогон на Ollama: done-loop и handoff продолжены после отката
- [x] #3 Тексты ru/en
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-48 п. 6.
- `src/lib/rewindContinueView.ts` + `AgentTimelinePanel`: подпись кнопки и текст диалога по режиму (`continueButtonText`/`continueDialogText`), список «Продолжения» из трассы.
- `SwarmArenaView`: баннер «Продолжить после отката» для done-loop и handoff (виден, когда сессия не активна и у агента есть неиспользованное пояснение), подтверждение через `dialog.prompt` (DialogHost `z-[10001]`); в степпере этапов — «отменён откатом» и «перезапуск ×N».
- `DoneLoopPanel`: полоса прогресса и счётчик — по текущему отрезку; у итераций — бейджи «после отката N» и «отменена откатом» (полностью отменённые приглушены).
- Final Summary после продолжения: «итераций 4, после отката 2 из 2» (сквозной счётчик и счётчик отрезка) — нашлось в живом прогоне.
- Строки ru/en в `agentTimeline`; тест `rewindContinueView.test.ts` проверяет оба словаря.
- Живой прогон (qwen2.5:7b-instruct, localhost:11434; одобрения — через MCP `projecthub_list_pending_approvals`/`projecthub_approve_action`, 8 решений, `decidedBy: mcp`): цикл «до готовности» — успех за 2 итерации, откат к чекпоинту #1 (`start`) удалил `one.txt`, обе итерации помечены `full`, продолжение с уточнением прошло новой сессией движка (1 сообщение в истории), итерации 3–4 в отрезке 1, `one.txt` создан заново, критерии отмечены снова. Handoff — 2 этапа, откат этапа 1 удалил 3 файла (`impl.txt` и отчёты `.projecthub/handoff`), оба этапа перешли в `pending` с `invalidatedAt`, перезапуск повторил оба этапа (`rerunCount` 1/1). Прогон целиком — 95 с.

Скриншоты собранного exe (копия userData без кэшей/аудита/логов, временный HOME, сессии живого прогона в `<userData>/swarms`; реестр проектов не менялся — `projects:list` и `swarm:list` подменены в памяти main через `app.evaluate`, потому что `app.getPath('home')` на Windows игнорирует HOME и guard путей сверяется с настоящим реестром): scratchpad `shots/12-arena.png` — цикл: «Iteration 1 of 2» (счёт по отрезку), итерации 1–2 «cancelled by rewind», итерация 3 «after rewind 1», бейдж «rewound to #1»; `13-handoff.png` — баннер «A pipeline stage was rewound to a checkpoint» с кнопкой «Continue after rewind», этапы «cancelled by rewind · rerun ×1»; `14-timeline.png` — кнопка «Rerun from stage 1», запуск «Run 2 · after rewind», HITL «allowed (mcp)»; `15-continuations.png` — блок «Continuations»; `16-dialog.png` — подтверждение «Rerun the pipeline after rewind» поверх карточек (DialogHost); `17-ru-banner.png` — те же строки по-русски.
<!-- SECTION:NOTES:END -->
