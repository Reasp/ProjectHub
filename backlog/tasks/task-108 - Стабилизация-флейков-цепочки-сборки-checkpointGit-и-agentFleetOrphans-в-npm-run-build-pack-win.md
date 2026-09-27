---
id: TASK-108
title: >-
  Стабилизация флейков цепочки сборки: checkpointGit и agentFleetOrphans в npm
  run build / pack:win
status: Review
assignee: []
created_date: '2026-09-27 22:47'
updated_date: '2026-09-27 23:52'
labels:
  - tests
  - build
dependencies: []
references:
  - >-
    backlog/decisions/decision-57 -
    Тесты-с-реальными-процессами-тайм-ауты-по-числу-запусков-и-очистка-каталогов-до-дедлайна.md
modified_files:
  - electron/services/processSweep.ts
  - tests/helpers/removeTempDir.ts
  - tests/unit/removeTempDir.test.ts
  - tests/unit/agentFleetOrphans.test.ts
  - tests/unit/checkpointGit.test.ts
  - vitest.config.ts
  - >-
    backlog/decisions/decision-57 -
    Тесты-с-реальными-процессами-тайм-ауты-по-числу-запусков-и-очистка-каталогов-до-дедлайна.md
  - .rag-index/
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`npm run build` (и `pack:win`, который его вызывает) падает на тестах `checkpointGit` («откат: рабочий каталог совпадает со снимком…» — тайм-аут 5 с, затем EBUSY при удалении временного worktree) и `agentFleetOrphans` (EBUSY на каталоге `bg-runGeminiCliAgent` в afterAll). Отдельные прогоны (`npx vitest run`, `npm run test`, `sh -c "npm run lint && npm run test"`) зелёные; на чистом HEAD 7a41e20 падает так же — не регрессия. Нужно найти причину (кто держит каталог, почему только в цепочке build), а не поднимать тайм-ауты вслепую.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Причина падений найдена и описана в заметках задачи (что держит каталог, почему только в цепочке build)
- [x] #2 Тесты checkpointGit и agentFleetOrphans устойчивы к нагрузке: без тайм-аутов по умолчанию на тяжёлых git-тестах и без EBUSY при очистке временных каталогов
- [x] #3 Три подряд npm run pack:win проходят без ручных шагов
- [x] #4 Если меняется конфигурация тестов или цепочки build — зафиксирован ADR (правило 18)
- [x] #5 npm run lint (0 ошибок, предупреждений не больше baseline 494) и npm test зелёные
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Причина (подробно — decision-57):
1. Цепочка cmd/npm ни при чём. npm run build под env-tools прошёл (174/1975, 61 с), а отдельный npx vitest run этих двух файлов под искусственной нагрузкой (20 busy-процессов на 16 ядрах) падает теми же сигнатурами (9 из 15). В прошлой сессии transform ~160 с — машина была перегружена.
2. checkpointGit: 25–50 запусков git на тест (GIT_TRACE2_EVENT), в полном прогоне тест отката уже 2.45 с из 5. По тайм-ауту тело теста продолжает гонять git, пока afterEach удаляет каталог → EBUSY/ENOTEMPTY.
3. agentFleetOrphans: в момент EBUSY ни одного процесса теста живого (WMI), handle64 к моменту снимка ничего не находит; waitDead всегда 0 мс. process.kill(pid, 0) в libuv смотрит GetExitCodeProcess, код выхода ставится сразу при TerminateProcess, а дескриптор cwd убитого процесса закрывается позже. A/B: потомок с cwd вне каталога — EBUSY 0 из 3 против 6 из 6. Отвергнуты: conhost detached-потомка, антивирус (не установлен), git-процессы.
4. Попутно: во временном доме тестов не было AppData\Local → .NET GetFolderPath давал пустую строку → PowerShell из тестов записал F:\ProjectHub\Microsoft\Windows\PowerShell\ModuleAnalysisCache (удалён, причина подтверждена пробой с подменённым USERPROFILE).

Что сделано: tests/helpers/removeTempDir.ts (повтор при EBUSY/ENOTEMPTY/EPERM/EACCES до дедлайна 30 с) + тест на реальном процессе, держащем cwd; checkpointGit — vi.setConfig 30 с для тестов и хуков и очистка через хелпер; agentFleetOrphans — очистка через хелпер, граница остановки = LIST_PROCESSES_TIMEOUT_MS + CHILD_CLOSE_GRACE_MS + 5 с (константа вынесена из listWindowsProcesses, поведение не меняется, impact LOW); vitest.config.ts — AppData/Local и AppData/Roaming во временном доме. Пул vitest и цепочка build не менялись.

Проверки: под нагрузкой 20 на 16 ядер EBUSY и тайм-ауты checkpointGit исчезли (3 прогона); остаётся «добивает потомка» — снимок WMI дольше 15 с, реальный предел продукта (decision-37), не маскируется. Под нагрузкой 12 на 16 — 3/3 зелёных. npm run pack:win трижды подряд без ручных шагов: 5:16, 2:04, 2:00, каждый 175 файлов / 1979 тестов. ESLint 0 ошибок / 494 предупреждения; index-docs и lint:docs зелёные. Полный набор под нагрузкой выше числа ядер ломается во многих файлах — тайм-аутами не лечится, зафиксировано в ADR.
<!-- SECTION:NOTES:END -->
