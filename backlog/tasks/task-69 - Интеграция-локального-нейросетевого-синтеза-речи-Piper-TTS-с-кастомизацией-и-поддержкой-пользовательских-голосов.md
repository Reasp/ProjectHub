---
id: TASK-69
title: >-
  Локальный нейросетевой TTS на голосах Piper (sherpa-onnx в worker
  main-процесса), кастомизация и импорт пользовательских голосов
status: To Do
assignee: []
created_date: '2026-09-15 00:02'
updated_date: '2026-09-15 02:33'
labels:
  - voice
  - tts
  - piper
  - sherpa-onnx
  - ai
  - multimodal
dependencies: []
references:
  - 'https://github.com/OHF-Voice/piper1-gpl'
  - 'https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU'
  - 'https://k2-fsa.github.io/sherpa/onnx/tts/piper.html'
  - 'https://www.npmjs.com/package/sherpa-onnx-node'
  - 'https://www.npmjs.com/package/@mintplex-labs/piper-tts-web'
  - >-
    backlog/decisions/decision-21 -
    Тяжёлые-вычисления-main-процесса-в-worker_threads-с-fallback-в-main.md
priority: medium
type: feature
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Второй движок озвучки рядом с системным `speechSynthesis`: локальный нейросетевой TTS на голосах Piper (VITS/ONNX), работающий полностью оффлайн на CPU, с выбором голоса, скорости, громкости и импортом собственных голосов.

## Результаты исследования (2026-09-15)

**Состояние Piper.** Исходный `rhasspy/piper` заархивирован (октябрь 2025). Развитие — `OHF-Voice/piper1-gpl` (Open Home Foundation), лицензия **GPL-3.0** (из-за встроенного espeak-ng), Python-пакет `piper-tts` 1.6.0 (июль 2026). Node-биндинга у Piper нет. Голоса — отдельный артефакт `rhasspy/piper-voices` (HF, репозиторий MIT); русские: `ru_RU-irina`, `ru_RU-dmitri`, `ru_RU-denis`, `ru_RU-ruslan` (все `medium`, 22050 Гц, обучены на данных RHVoice, лицензия датасета в MODEL_CARD — «Unknown»). Kokoro-82M (лучшее качество на CPU в 2026) русский не поддерживает — как основной движок не подходит.

**Варианты рантайма в ProjectHub:**
- **A. `sherpa-onnx-node` 1.13.8 (Apache-2.0, k2-fsa)** — prebuilt native через optionalDependencies (`sherpa-onnx-win-x64`, `-linux-x64`, `-darwin-arm64`, …), встроенный фонемизатор espeak-ng (компонент под GPL), поддержка Piper-голосов. В релизах sherpa-onnx (`tts-models`) лежат уже конвертированные архивы `vits-piper-<voice>` + общий `espeak-ng-data`. Для пользовательских `.onnx + .onnx.json` нужна конвертация: `tokens.txt` из `phoneme_id_map` + metadata (`model_type=vits`, `comment=piper`, `sample_rate`, `n_speakers`, `voice=<espeak voice>`) в ONNX.
- **B. `onnxruntime-web` + piper-phonemize WASM в рендерере** (`@mintplex-labs/piper-tts-web` 1.0.5 / `@diffusionstudio/vits-web`, MIT) — без нативных зависимостей, голоса с HF без конвертации, но WASM медленнее и ассеты по умолчанию с CDN (для оффлайна — self-host).
- **C. `onnxruntime-node` (уже в дереве зависимостей) + своя фонемизация** — готового Node-фонемизатора espeak-ng нет; отклонён.

**Решение** ([[decision-25]], `proposed` → `accepted` по итогам реализации): **вариант A** в `worker_threads` main-процесса по образцу `whisperWorker` (decision-21), с деградацией в системный `speechSynthesis`. Вариант B — запасной, если prebuilt sherpa не заведётся в упакованном Electron (проверить первым шагом).

## Архитектура

1. `electron/services/piperTtsService.ts` + `electron/workers/ttsWorker.mjs`: ленивая загрузка модели, очередь заданий с `jobId`, таймаут, ограниченный respawn, fallback в main (как `localWhisperService`). Генерация **по предложениям**: PCM Float32 чанки уходят в рендерер по IPC по мере готовности (первое слово слышно < 1 с).
2. Модели в `<userData>/models/tts/<voiceId>/` (общий кэш `appPaths`). Реестр встроенных голосов (ru ×4, en ×2: `amy`, `lessac`) с URL на релизы sherpa-onnx и sha256; загрузка по кнопке с прогрессом. **Модели в бандл не входят.**
3. Импорт пользовательского голоса: выбрать `.onnx` + `.onnx.json` → валидация (`phoneme_type=espeak`, `espeak.voice`, `sample_rate`) → конвертация в JS (`tokens.txt`; metadata в ONNX через protobuf `metadata_props` — либо подтвердить, что sherpa читает без metadata) → копия в кэш → голос в списке.
4. Рендерер: `voiceService.speak()` выбирает движок: `piper` → IPC `piper:speak` → `AudioContext` + `setSinkId(audioOutputDeviceId)` (выбранное устройство вывода, чего `speechSynthesis` не умеет); `system` → как сейчас. `stop_reading` отменяет генерацию по `jobId` и останавливает плеер. Во время воспроизведения VAD глушится (не слушать самого себя).
5. `VoiceSettingsModal`: раздел TTS — движок (Системный / Piper), голос со статусом загрузки, скорость (`length_scale`), громкость, кнопка «Прослушать», импорт голоса. i18n ru/en.
6. Сборка: `sherpa-onnx-node` и платформенный пакет — в `external` (`vite.config.ts`, правило 17 `check-bundle`) и в `asarUnpack` (как `node-pty`); `pack-win.mjs` копирует воркер.
7. Unit-тесты (без Electron): разбиение текста на предложения, парсер `.onnx.json` → `tokens.txt`, реестр голосов, пути кэша.

## Вне scope
- Клонирование голоса/дообучение (только импорт готовых моделей).
- Ремонт `engine: 'webspeech'` для STT (doc-7 п. 5.6) — отдельная задача.

## Ссылки
- https://github.com/OHF-Voice/piper1-gpl — актуальный Piper (GPL-3.0)
- https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU — русские голоса
- https://k2-fsa.github.io/sherpa/onnx/tts/piper.html — Piper в sherpa-onnx, конвертация, espeak-ng-data
- https://www.npmjs.com/package/sherpa-onnx-node — Node-аддон (1.13.8, Apache-2.0)
- https://www.npmjs.com/package/@mintplex-labs/piper-tts-web — запасной WASM-вариант
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Реализованы electron/services/piperTtsService.ts и electron/workers/ttsWorker.mjs: ленивая загрузка модели, очередь заданий с jobId, таймаут, ограниченный respawn и fallback в main (по образцу localWhisperService, decision-21)
- [ ] #2 Реестр встроенных голосов (ru: irina, dmitri, denis, ruslan; en: amy, lessac) с загрузкой в <userData>/models/tts по кнопке, прогрессом и проверкой sha256; модели не входят в бандл приложения
- [ ] #3 VoiceSettingsModal: выбор TTS-движка (Системный / Piper), голоса со статусом загрузки, скорости и громкости, кнопка «Прослушать»; строки в i18n ru/en
- [ ] #4 Импорт пользовательского голоса (.onnx + .onnx.json): валидация конфига, конвертация в формат sherpa (tokens.txt, metadata), понятные ошибки при невалидных файлах
- [ ] #5 Команды read_tasks, read_doc и stop_reading работают через Piper; stop прерывает и генерацию (по jobId), и воспроизведение; звук идёт через выбранное устройство вывода (setSinkId); VAD не реагирует на собственную речь приложения
- [ ] #6 Синтез на 100% локальный на CPU: после загрузки моделей нет сетевых запросов; генерация по предложениям — первый чанк < 1 с, RTF < 1 на medium-голосе (замер зафиксирован в notes)
- [ ] #7 При отсутствии модели, ошибке воркера или недоступном нативном модуле приложение деградирует в системный speechSynthesis без краша и показывает причину в настройках
- [ ] #8 sherpa-onnx-node и платформенный пакет добавлены в externals и asarUnpack; npm run check-bundle, lint, test зелёные; npm run pack:win собран и release/win-unpacked/ProjectHub.exe озвучивает текст
- [ ] #9 Unit-тесты на чистые модули: разбиение на предложения, парсер .onnx.json → tokens.txt, реестр голосов и пути кэша
- [ ] #10 ADR decision-25 переведён в accepted с фактическими замерами (RTF, память, время загрузки) и лицензионными заметками (GPL-компонент espeak-ng, лицензия датасета RHVoice)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Спайк (0.5 дня): `npm i sherpa-onnx-node`, минимальный скрипт синтеза `vits-piper-ru_RU-irina-medium` из релиза sherpa-onnx; проверить загрузку нативного модуля из `release/win-unpacked` (asarUnpack). Если не работает — переключиться на вариант B (renderer WASM) и обновить decision-25.
2. Чистые модули + тесты: `ttsTextSplit.ts` (предложения, лимит длины), `piperVoiceConfig.ts` (парсер `.onnx.json` → tokens/metadata), `ttsVoiceRegistry.ts` (встроенные голоса, URL, sha256, пути кэша).
3. `ttsWorker.mjs` + `piperTtsService.ts` (очередь, jobId, отмена, таймаут, respawn, fallback) + IPC (`electron/ipc/voiceIpc.ts`): `tts:listVoices`, `tts:downloadVoice`, `tts:importVoice`, `tts:speak` (stream chunks), `tts:cancel`, `tts:status`.
4. Рендерер: `ttsPlayer.ts` (AudioContext, очередь чанков, setSinkId, stop), интеграция в `voiceService.speak/stop`, глушение VAD на время речи.
5. `VoiceSettingsModal` — раздел TTS, i18n ru/en.
6. Сборка: externals, asarUnpack, `pack-win.mjs`; `npm run pack:win`, ручной smoke (read_tasks, stop_reading, смена устройства вывода).
7. decision-25 → accepted с замерами; `npm run index-docs`; задача → Review.
<!-- SECTION:PLAN:END -->
