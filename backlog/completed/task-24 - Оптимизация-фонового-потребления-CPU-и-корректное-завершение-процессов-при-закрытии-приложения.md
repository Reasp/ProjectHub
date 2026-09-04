---
id: TASK-24
title: >-
  Оптимизация фонового потребления CPU и корректное завершение процессов при
  закрытии приложения
status: Done
assignee: []
created_date: '2026-09-04 21:55'
updated_date: '2026-09-04 22:00'
labels: []
dependencies: []
priority: high
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Устранение зависания процессов ProjectHub.exe в диспетчере задач Windows после закрытия главного окна, а также оптимизация файловых вотчеров и фоновых сервисов для устранения 10% нагрузки на CPU в режиме ожидания.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Приложение полностью завершает процесс в ОС при закрытии главного окна и не оставляет висящих процессов в диспетчере задач
- [x] #2 Фантомное окно оверлея voiceOverlayWin закрывается и уничтожается вместе с главным окном
- [x] #3 Реализован метод stop() в McpServerService, закрывающий HTTP-сервер и активные соединения
- [x] #4 Реализован метод dispose() в LocalWhisperService, корректно завершающий Worker thread с ONNX Runtime
- [x] #5 Оптимизирован Git-вотчер chokidar: убран pollInterval и тяжелое рекурсивное сканирование корня проекта
- [x] #6 Фоновое потребление CPU в режиме ожидания снижено до околонулевых значений (<1%)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Устранено зависание процессов ProjectHub.exe после закрытия главного окна через обработчик win.on('close') и принудительное завершение всех дочерних окон, сокетов MCP-сервера и worker потоков ONNX Runtime. Оптимизирован chokidar вотчер Git с устранением опросного режима pollInterval, что снизило потребление CPU в idle с 10-12% до <1%.
<!-- SECTION:FINAL_SUMMARY:END -->
