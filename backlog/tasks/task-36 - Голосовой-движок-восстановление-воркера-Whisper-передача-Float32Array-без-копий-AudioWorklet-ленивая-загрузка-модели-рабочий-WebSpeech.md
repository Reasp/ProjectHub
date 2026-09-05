---
id: TASK-36
title: >-
  Голосовой движок: восстановление воркера Whisper, передача Float32Array без
  копий, AudioWorklet, ленивая загрузка модели, рабочий WebSpeech
status: To Do
assignee: []
created_date: '2026-09-05 09:08'
labels:
  - audit
  - voice
  - performance
  - P1
dependencies: []
references:
  - electron/services/localWhisperService.ts
  - electron/workers/whisperWorker.mjs
  - electron/preload.ts
  - src/services/voiceService.ts
  - electron/main.ts
documentation:
  - >-
    backlog/docs/doc-7 -
    Технический-аудит-ProjectHub-стабильность-утечки-производительность-безопасность.md
priority: medium
type: bug
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Пункты аудита 1.5, 2.6, 3.5, 3.6, 3.7, 4.8, 5.6 (doc-7).

1) `localWhisperService`: при выходе воркера с ненулевым кодом в статусе `ready` воркер обнуляется, статус остаётся `ready`, fallback равен null, и все последующие `transcribe` бросают «initializing» навсегда; `pendingJobs` не сбрасываются на `exit`; таймер 30 с на каждую транскрипцию не очищается.
2) `preload.transcribeLocalWhisper` конвертирует Float32Array в обычный массив (`Array.from`), main снова делает `new Float32Array`, воркер получает ещё одну копию.
3) `voiceService` использует устаревший ScriptProcessorNode на главном потоке; `resampleTo16k` аллоцирует массив на каждый чанк.
4) Модель Whisper загружается на каждом старте приложения (`initBackground` в whenReady), даже если голос выключен.
5) `engine: 'webspeech'` не работает: `startHandsFreeListening` всегда идёт по пути Whisper.
6) `transcribePcmWithCloud` подставляет ключ AI Studio (Anthropic/DeepSeek) как Bearer к Groq/OpenAI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 При аварийном выходе воркера статус переходит в error, pendingJobs отклоняются, выполняется ограниченное число попыток respawn (например, 3) с экспоненциальной задержкой
- [ ] #2 Таймер ожидания транскрипции очищается при получении результата или ошибки
- [ ] #3 Аудио передаётся через IPC как Float32Array/ArrayBuffer без Array.from, в воркер передаётся через transferList
- [ ] #4 Захват звука реализован через AudioWorklet (с фолбэком на ScriptProcessorNode для старых окружений), ресемплинг не аллоцирует новые буферы на каждый чанк
- [ ] #5 initBackground вызывается только при первом включении hands-free или явном прогреве из настроек; на старте приложения модель не загружается
- [ ] #6 Выбор engine=webspeech реально запускает SpeechRecognition, а не Whisper
- [ ] #7 Fallback на ключ из projecthub-ai-studio-storage удалён; облачные STT-провайдеры используют только whisperApiKey
<!-- AC:END -->
