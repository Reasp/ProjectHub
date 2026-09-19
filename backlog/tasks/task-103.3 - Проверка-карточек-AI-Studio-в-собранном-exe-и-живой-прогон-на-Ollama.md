---
id: TASK-103.3
title: Проверка карточек AI Studio в собранном exe и живой прогон на Ollama
status: Review
assignee: []
created_date: '2026-09-19 13:08'
updated_date: '2026-09-19 13:27'
labels:
  - hitl
  - ai-studio
dependencies: []
parent_task_id: TASK-103
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Живой прогон API-пути AI Studio на qwen2.5:7b-instruct (чтение → запись с карточкой → команда), одобрение через MCP. Скриншот карточки записи с диффом в собранном exe на копии userData.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Живой прогон на Ollama пройден, одобрения через MCP, аудит с origin studio
- [x] #2 Скриншот карточки записи с диффом в собранном exe
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
decision-47, раздел «Проверка».
- Живой прогон сервиса (временный тест, удалён): qwen2.5:7b-instruct на localhost, временный git-репозиторий, auto-approve off, одобрение внешним MCP-клиентом через встроенный MCP-сервер в процессе теста. read_file авто → write_file карточка с диффом (decidedBy mcp) → git status карточка, вывод чанком running; output.txt = HELLO FROM STUDIO; 4 с. Аудит: origin studio, engine api, auto-read у чтения.
- Собранный exe (pack:win 21:19, exe и app.asar свежие, в asar нет handleApiToolCall): копия userData без кэшей/audit/hitl/logs/remote*/computer-use*/models, временный HOME с ai-config (ollama qwen2.5, auto-approve off), временный git-репозиторий. Реестр exe читает настоящий projects.json — обработчик `projects:list` подменён в памяти main через Playwright `app.evaluate`, файл реестра не менялся; сессия чата записалась во временный HOME.
- Скриншоты (scratchpad/shots): 04 — живая карточка «Запись файла: output.txt»; 06 — она же в Центре решений (AI Studio, studio-demo, write_file); 11 — строка write_file pending с диффом +HELLO FROM STUDIO и карточка; 12 — после Approve Once: Completed, дифф Applied, файл записан; 10 — одна строка на вызов, отклонённая запись с диффом Rejected.
- Инцидент прогона: клик автоматизации по иконке lucide-x в Центре решений попал в «Deny Action» (аудит: deny, decidedBy local) — ошибка сценария, не продукта; поведение после отказа верное.
- После закрытия exe в системе остался экземпляр ProjectHub с настоящим userData, запущенный с `-Embedding` (COM-активация, как при клике по toast-уведомлению) — не трогал.
<!-- SECTION:NOTES:END -->
