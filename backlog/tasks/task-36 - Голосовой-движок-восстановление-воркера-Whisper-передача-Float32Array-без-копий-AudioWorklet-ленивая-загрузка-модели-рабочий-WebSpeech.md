---
id: TASK-36
title: >-
  Голосовой движок: восстановление воркера Whisper, передача Float32Array без
  копий, AudioWorklet, ленивая загрузка модели, рабочий WebSpeech
status: Review
assignee:
  - claude
created_date: '2026-09-05 09:08'
updated_date: '2026-09-06 18:53'
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
modified_files:
  - electron/services/localWhisperService.ts
  - electron/preload.ts
  - electron/main.ts
  - src/types/electron.d.ts
  - src/services/voiceService.ts
  - src/components/voice/VoiceSettingsModal.tsx
  - public/voice-capture-worklet.js
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
- [x] #1 При аварийном выходе воркера статус переходит в error, pendingJobs отклоняются, выполняется ограниченное число попыток respawn (например, 3) с экспоненциальной задержкой
- [x] #2 Таймер ожидания транскрипции очищается при получении результата или ошибки
- [x] #3 Аудио передаётся через IPC как Float32Array/ArrayBuffer без Array.from, в воркер передаётся через transferList
- [x] #4 Захват звука реализован через AudioWorklet (с фолбэком на ScriptProcessorNode для старых окружений), ресемплинг не аллоцирует новые буферы на каждый чанк
- [x] #5 initBackground вызывается только при первом включении hands-free или явном прогреве из настроек; на старте приложения модель не загружается
- [x] #6 Выбор engine=webspeech реально запускает SpeechRecognition, а не Whisper
- [x] #7 Fallback на ключ из projecthub-ai-studio-storage удалён; облачные STT-провайдеры используют только whisperApiKey
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План реализации

1. **electron/services/localWhisperService.ts**
   - `PendingJob` получает `timer`; таймер очищается при `result`/`error`/flush/dispose.
   - Обработчик `exit`: любой неожиданный выход (не через `dispose`) → `status = 'error'`, отклонение всех `pendingJobs`, до 3 попыток respawn с экспоненциальной задержкой (1с → 2с → 4с). Успешный `ready` сбрасывает счётчик. После исчерпания попыток статус остаётся `error` с сообщением.
   - In-process fallback остаётся только для случая, когда скрипт воркера не найден / `new Worker` бросил (структурная проблема), а не для рантайм-крэшей.
   - `transcribe`: если `unloaded` — ленивый `initBackground()`; если `loading` — ждём `ready` (до 90 с) вместо мгновенного «initializing»; если `error` — бросаем сохранённую ошибку.
   - Аудио уходит в воркер через `postMessage(msg, [buffer])` (transferList); если Float32Array — view на общий буфер, делается `slice()`.
2. **electron/preload.ts / electron/main.ts / src/types/electron.d.ts**
   - `transcribeLocalWhisper` передаёт Float32Array как есть (structured clone Electron сохраняет TypedArray), без `Array.from`.
   - Новый IPC `voice:warmupLocalWhisper` → `initBackground()` + возврат состояния. Вызов `initBackground()` из `whenReady` удалён.
3. **src/services/voiceService.ts**
   - Захват через `AudioWorklet` (`public/voice-capture-worklet.js`, грузится как `'self'` — CSP `script-src 'self'` не пропускает blob:), фолбэк на `ScriptProcessorNode`, если `audioWorklet` недоступен или `addModule` упал.
   - `resampleTo16k` пишет в переиспользуемый scratch-буфер и возвращает subarray; копия делается только при накоплении фразы.
   - `engine === 'webspeech'` → `startHandsFreeListening` запускает `SpeechRecognition` (с авто-рестартом на `onend`, пока слушаем), не Whisper. `stopListening`/`restartAudioCapture` учитывают движок.
   - При старте hands-free с `engine=whisper`, `provider=local` — вызов `warmupLocalWhisper()` (первый прогрев модели).
   - Удалён fallback на ключ из `projecthub-ai-studio-storage`; облачные провайдеры используют только `whisperApiKey`.
4. **src/components/voice/VoiceSettingsModal.tsx**
   - Селектор движка (Whisper / Web Speech API) + подсказка о поддержке; блок провайдера показывается только для Whisper.
   - Кнопка «Прогреть модель» для локального провайдера со статусом (`unloaded/loading/ready/error`, время загрузки).
   - Плейсхолдер API-ключа без упоминания AI Studio.
5. Проверка: `npm run build` (tsc + vite), `npm run pack:win` (правило 14).

**Уточнение по итогам теста (п. 1)**: счётчик respawn сбрасывается не на `ready`, а только после успешного `result` (и при явном `initBackground()` из состояния error — кнопка «Прогреть модель» как ручной retry). Иначе crash-loop «ready → крэш на задаче» обходил лимит.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Ход работы (2026-09-07)

**main-процесс (`localWhisperService.ts`)**: `PendingJob.timer` очищается в `takePendingJob`/`flushPendingWithError`/`dispose`; аварийный `exit` → `status='error'`, отклонение очереди, respawn 1с→2с→4с (макс. 3), счётчик сбрасывается только после успешного `result` (иначе воркер, падающий на каждой задаче, перезапускался бы бесконечно — это выявил изолированный тест). Ленивая загрузка: `transcribe` при `unloaded` сам вызывает `initBackground()` и ждёт `ready` до 90 с. Аудио в воркер уходит через `postMessage(msg, [buffer])`; view на общий буфер копируется через `slice()`. In-process fallback оставлен только для случая «скрипт воркера не найден / `new Worker` бросил».

**IPC**: `preload.transcribeLocalWhisper` передаёт Float32Array как есть; новый `voice:warmupLocalWhisper`; вызов `initBackground()` из `whenReady` удалён.

**Рендерер (`voiceService.ts`)**: захват через AudioWorklet (`public/voice-capture-worklet.js`, грузится как `'self'` — CSP `script-src` не пропускает blob:), фолбэк на ScriptProcessorNode; `resampleTo16k` пишет в scratch-буфер и возвращает subarray; `engine='webspeech'` реально запускает `SpeechRecognition` с авто-рестартом на `onend` и остановкой при фатальных ошибках (`not-allowed`, `audio-capture`); при первом hands-free с локальным провайдером — `warmupLocalWhisper()`; fallback на ключ AI Studio удалён, без `whisperApiKey` облачный провайдер бросает понятную ошибку.

**UI (`VoiceSettingsModal.tsx`)**: селектор движка Whisper / Web Speech API (недоступный вариант disabled + подсказка), блок провайдера только для Whisper, карточка статуса модели (`unloaded/loading/ready/error`, время загрузки) с кнопкой «Прогреть модель» и опросом статуса, пока модалка открыта.

**Проверка**: `tsc --noEmit` чисто; `npm run pack:win` (lint:docs + tsc + vite build + electron-builder) успешно, `dist/voice-capture-worklet.js` попал в asar. Изолированный прогон `localWhisperService.ts` через `node --experimental-strip-types` с фейковым воркером (scratchpad): ленивая инициализация из `transcribe`, буфер detached после transfer, крэш → `error`/очередь пуста/respawn через 1с, повторные крэши → 2с, 4с, после 3-й попытки `respawn limit (3) reached`, `transcribe` в error-состоянии отклоняется с этим сообщением, после `dispose` процесс завершается сразу (висящих таймеров нет). AudioWorklet и Web Speech проверялись только сборкой и типами — в среде агента нет микрофона (ручная проверка при ревью).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Итог

Закрыты пункты аудита 1.5, 2.6, 3.5, 3.6, 3.7, 4.8, 5.6 (doc-7) по голосовому движку.

**Main-процесс.** `localWhisperService` переписан вокруг надёжного жизненного цикла воркера: таймер каждой транскрипции хранится в задаче и очищается при результате/ошибке/flush; аварийный выход воркера переводит сервис в `error`, отклоняет очередь и делает до 3 перезапусков с задержкой 1с → 2с → 4с (счётчик сбрасывается только после успешной транскрипции, чтобы crash-loop не обходил лимит). Модель грузится лениво: первое `transcribe` или явный `voice:warmupLocalWhisper` поднимают воркер, вызов из `whenReady` удалён. Аудио передаётся в воркер по transferList без копий.

**IPC.** `transcribeLocalWhisper` отправляет Float32Array напрямую (без `Array.from`); добавлен `warmupLocalWhisper`.

**Рендерер.** Захват через AudioWorklet (`public/voice-capture-worklet.js`, совместим с CSP `script-src 'self'`) с фолбэком на ScriptProcessorNode; ресемплер пишет в переиспользуемый scratch-буфер. `engine='webspeech'` реально запускает `SpeechRecognition` с авто-рестартом непрерывного режима. Fallback на ключ AI Studio удалён — облачные провайдеры используют только `whisperApiKey`, без него бросается понятная ошибка.

**UI.** В настройках голоса появился селектор движка (Whisper / Web Speech API), карточка статуса локальной модели и кнопка «Прогреть модель».

**Проверка.** `tsc` чисто, `npm run pack:win` собрал `release/win-unpacked/ProjectHub.exe`; логика respawn/transfer/таймеров подтверждена изолированным прогоном сервиса с фейковым воркером. Ручная проверка микрофона (AudioWorklet, Web Speech) — при ревью, в среде агента нет аудиоустройств.
<!-- SECTION:FINAL_SUMMARY:END -->
