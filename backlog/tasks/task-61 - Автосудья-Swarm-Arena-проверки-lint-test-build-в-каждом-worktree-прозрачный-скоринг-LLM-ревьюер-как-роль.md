---
id: TASK-61
title: >-
  Автосудья Swarm Arena: проверки lint/test/build в каждом worktree, прозрачный
  скоринг, LLM-ревьюер как роль
status: Review
assignee: []
created_date: '2026-09-10 07:17'
updated_date: '2026-09-11 11:20'
labels:
  - ade-roadmap
  - swarm
  - arena
  - quality
  - P2
dependencies:
  - TASK-55
  - TASK-56
  - TASK-60
references:
  - electron/services/agentFleetService.ts
  - electron/services/processManager.ts
  - electron/services/actionConfigService.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
documentation:
  - >-
    backlog/decisions/decision-12 -
    Автосудья-Swarm-Arena-объективные-метрики-LLM-ревью-и-финальное-решение-за-человеком.md
modified_files:
  - electron/services/arenaTypes.ts
  - electron/services/arenaChecks.ts
  - electron/services/arenaScoring.ts
  - electron/services/arenaConfig.ts
  - electron/services/reviewerPrompt.ts
  - electron/services/arenaJudgeService.ts
  - electron/services/processManager.ts
  - electron/services/agentFleetService.ts
  - electron/services/actionConfigService.ts
  - electron/services/swarmTypes.ts
  - electron/services/gitNexusClient.ts
  - electron/ipc/aiIpc.ts
  - electron/preload.ts
  - src/types/electron.d.ts
  - src/store/useSwarmStore.ts
  - src/utils/arenaFormat.ts
  - src/components/ai/swarm/SwarmArenaView.tsx
  - src/components/ai/swarm/ArenaJudgePanel.tsx
  - src/components/ai/swarm/ArenaSettingsModal.tsx
  - src/components/ai/swarm/ComposeResultModal.tsx
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/arenaChecks.test.ts
  - tests/unit/arenaScoring.test.ts
  - tests/unit/reviewerPrompt.test.ts
  - tests/unit/arenaConfig.test.ts
  - tests/unit/arenaJudge.test.ts
  - tests/unit/processManager.test.ts
  - >-
    backlog/decisions/decision-12 -
    Автосудья-Swarm-Arena-объективные-метрики-LLM-ревью-и-финальное-решение-за-человеком.md
  - >-
    backlog/decisions/decision-20 -
    Модель-автосудьи-Swarm-Arena-одноразовый-прогон-проверок-относительный-скоринг-в-когорте-и-нейтральные-компоненты.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ревизия от 2026-09-10 (см. decision-12).

**Что не так сейчас**
- Выбор победителя в арене полностью ручной. Метрики: длительность, число символов, `tokensEstimated = chars/4`, скорость символов в секунду. Сравнивать кандидатов по этим числам бессмысленно.
- При трёх и более кандидатах с большими диффами ручное чтение не масштабируется.
- Нет прогона тестов и сборки в worktree кандидата до слияния; сломанный результат обнаруживается уже в основном дереве.

**Зависимости**: материализация результатов в git (TASK-55), персистентность и стоимость (TASK-56), роли (TASK-60).

**Что сделать**
1. Секция `checks` в `.projecthub.json` проекта: список проверок (`lint`, `test`, `build`, `typecheck`) с командами, таймаутами и флагом «блокирующая». Значения по умолчанию выводятся из `package.json` scripts.
2. Запуск проверок в worktree каждого кандидата через `processManager` после завершения агента (параллельно, с ограничением конкурентности и изоляцией портов), сбор статуса, времени, числа упавших тестов, вывода.
3. Метрики диффа: файлы, добавленные/удалённые строки, затронутые модули и число зависимых символов по GitNexus (если индекс есть).
4. Скоринг: блокирующий критерий это статус проверок; далее взвешенная сумма покрытия критериев приёмки задачи (чеклист AC), размера и локальности диффа, стоимости и времени. Веса в настройках проекта, объяснение балла показывается рядом с числом.
5. LLM-ревьюер как роль `reviewer`: получает дифф кандидата, задачу и AC, возвращает структурированный отзыв (замечания по файлам, риски, оценка по каждому AC). Отзыв показывается колонкой в арене; ревьюер может работать на другой модели.
6. Кнопка «Рекомендовать» подсвечивает лучшего кандидата; опция «авто-мердж лучшего при зелёных проверках и балле выше порога» выключена по умолчанию и пишется в аудит HITL.
7. Частичная сборка результата из нескольких кандидатов по файлам (использует механизм из TASK-55).
8. Unit-тесты на скоринг и парсинг результатов проверок.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Проверки из .projecthub.json запускаются в worktree каждого кандидата после завершения агента, их статус, время и число упавших тестов видны в арене
- [x] #2 Скоринг показывает итоговый балл и его разложение по компонентам; веса настраиваются в проекте; кандидат с проваленной блокирующей проверкой не может быть рекомендован
- [x] #3 Роль reviewer выдаёт структурированный отзыв по каждому кандидату с оценкой по критериям приёмки, отзыв отображается в арене
- [x] #4 Авто-мердж выключен по умолчанию, при включении срабатывает только при зелёных проверках и балле выше порога и пишется в аудит
- [x] #5 Можно собрать результат из файлов нескольких кандидатов
- [x] #6 Unit-тесты на скоринг и парсинг результатов проверок, npm run build проходит
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `arenaTypes.ts` — типы автосудьи: CheckDefinition/CheckRunResult, ScoreWeights/ScoreComponent/CandidateScore, ReviewerVerdict, ArenaConfig, JudgeState.
2. `arenaChecks.ts` (чистый) — дефолты проверок из package.json scripts, парсеры вывода (vitest/jest/mocha/pytest/cargo/eslint/tsc), хвост вывода.
3. `arenaScoring.ts` (чистый) — нормализация относительно когорты, взвешенный балл с разложением по компонентам, блокирующие проверки, ранжирование.
4. `reviewerPrompt.ts` (чистый) — сборка промпта роли `reviewer` (задача + AC + дифф + результаты проверок) и толерантный парсинг JSON-ответа.
5. `processManager.runOnce()` — одноразовый запуск команды с таймаутом/отменой/лимитом вывода, тот же `resolveShellSpawn`.
6. `arenaJudgeService.ts` — оркестрация: проверки в worktree каждого кандидата (параллельно с лимитом, изоляция портов), метрики диффа + модули/зависимые символы по GitNexus, LLM-ревьюер, скоринг, рекомендация.
7. `agentFleetService`: запуск судьи после fan-out, авто-мердж при зелёных проверках и балле выше порога (выкл. по умолчанию) с записью в аудит HITL, `composeFromCandidates` (сборка по файлам из нескольких кандидатов).
8. IPC/preload/типы рендерера + store + UI: панель судьи, бейджи проверок и балла в карточке, вкладка Review, модалка сборки и настроек весов.
9. Unit-тесты на парсеры проверок, скоринг и парсинг ответа ревьюера; `npm run lint`, `npm test`, `npm run build`, `npm run pack:win`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Что сделано**

Чистые модули (без Electron, покрыты unit-тестами):
- `arenaTypes.ts` — типы судьи, зеркало в `src/types/electron.d.ts`.
- `arenaChecks.ts` — дефолтные проверки из `package.json` scripts (пропуская вотчеры) либо Cargo/pytest; парсеры вывода vitest/jest/mocha/pytest/cargo/eslint/tsc; нормализация записей `checks` из `.projecthub.json`.
- `arenaScoring.ts` — взвешенный балл 0..100 с разложением по 7 компонентам, относительная нормализация в когорте, блокирующий критерий, ранжирование, рекомендация и вердикт авто-мерджа.
- `reviewerPrompt.ts` — промпт роли `reviewer` (задача + AC + дифф + результаты проверок) и толерантный разбор ответа.
- `arenaConfig.ts` — слияние `.projecthub.json` (`checks`, `arena`) с дефолтами стека.

Побочные эффекты:
- `processManager.runOnce()` — одноразовый запуск команды до завершения: тот же `resolveShellSpawn`, таймаут и `AbortSignal` со снятием дерева процессов, лимит вывода, `portStrategy: 'auto'` с учётом уже выданных портов. В реестр `activeProcesses` не пишет (см. decision-20 п.1).
- `arenaJudgeService.ts` — проверки в worktree каждого кандидата (параллельно с лимитом), метрики диффа (модули локально, зависимые символы через `gitnexus detect-changes`), LLM-ревью, скоринг, рекомендация.
- `agentFleetService`: автозапуск судьи после fan-out **только для настоящей арены** (>1 кандидата, `origin !== 'assigned'`) — у одиночного агента сравнивать не с кем, а проверки и платное ревью были бы неожиданной тратой; для него остаётся кнопка. Авто-мердж через `pickWinner` с записью в аудит HITL (`rule: arena-auto-merge`). `composeFromCandidates` — сборка по файлам из нескольких кандидатов.
- IPC/preload/store: `swarm:runJudge`, `swarm:cancelJudge`, `swarm:compose`, `arena:getConfig`, `arena:saveConfig`.

UI: панель `ArenaJudgePanel` (запуск/отмена, стадия, рекомендация, разложение балла лидера, ранжирование), бейджи проверок и балла в карточке кандидата, вкладки «Проверки» и «Ревью», `ArenaSettingsModal` (проверки, веса, ревьюер, авто-мердж) и `ComposeResultModal` — обе через `createPortal` + `z-[9999]` по правилу 19.

**ADR**: decision-12 переведён в `accepted`; заведён decision-20 — механика прогона проверок, относительная нормализация в когорте, нейтральные компоненты без данных, отказ от рекомендации при ничьей.

**Проверено**: `npm run lint` — 0 ошибок, 510 предупреждений (baseline не вырос); `npm test` — 588 тестов, три полных прогона подряд зелёные; `npm run build` и `npm run pack:win` проходят; распакованное приложение стартует.

**Замечание по флакости**: новые тесты `runOnce` спавнят реальные процессы, и отдельным файлом они перегружали машину настолько, что чужие timing-зависимые тесты (`claudeBridgeService`, TTL/autoOpen в `processManager`) начинали падать. Тесты слиты в `tests/unit/processManager.test.ts` — там все процессоспавнящие кейсы идут последовательно в одном воркере.

**На что смотреть при ревью**: ревьюер включён по умолчанию (`arena.reviewer.enabled`), то есть арена с несколькими кандидатами автоматически тратит один вызов модели на кандидата; отключается в настройках судьи. Баллы разных прогонов несравнимы между собой — это следствие относительной нормализации (decision-20 п.3).
<!-- SECTION:NOTES:END -->
