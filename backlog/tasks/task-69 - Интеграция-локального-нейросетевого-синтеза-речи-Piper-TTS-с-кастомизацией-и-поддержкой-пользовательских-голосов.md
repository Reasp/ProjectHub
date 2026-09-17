---
id: TASK-69
title: >-
  Локальный нейросетевой TTS на голосах Piper (sherpa-onnx в worker
  main-процесса), кастомизация и импорт пользовательских голосов
status: Done
assignee: []
created_date: '2026-09-15 00:02'
updated_date: '2026-09-17 12:51'
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
modified_files:
  - electron/services/ttsTextSplit.ts
  - electron/services/piperVoiceConfig.ts
  - electron/services/ttsVoiceRegistry.ts
  - electron/services/ttsVoiceStore.ts
  - electron/services/piperTtsService.ts
  - electron/workers/ttsWorker.mjs
  - electron/ipc/ttsIpc.ts
  - electron/ipc/index.ts
  - electron/main.ts
  - electron/preload.ts
  - src/services/ttsPlayer.ts
  - src/services/voiceService.ts
  - src/components/voice/VoiceSettingsModal.tsx
  - src/components/voice/VoiceControlWidget.tsx
  - src/types/electron.d.ts
  - src/i18n/types.ts
  - src/i18n/ru.ts
  - src/i18n/en.ts
  - tests/unit/ttsTextSplit.test.ts
  - tests/unit/piperVoiceConfig.test.ts
  - tests/unit/ttsVoiceRegistry.test.ts
  - tests/unit/ttsVoiceStore.test.ts
  - package.json
  - scripts/check-bundle.mjs
  - >-
    backlog/decisions/decision-25 -
    Локальный-TTS-на-голосах-Piper-через-sherpa-onnx-в-worker-main-процесса.md
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
- [x] #1 Реализованы electron/services/piperTtsService.ts и electron/workers/ttsWorker.mjs: ленивая загрузка модели, очередь заданий с jobId, таймаут, ограниченный respawn и fallback в main (по образцу localWhisperService, decision-21)
- [x] #2 Реестр встроенных голосов (ru: irina, dmitri, denis, ruslan; en: amy, lessac) с загрузкой в <userData>/models/tts по кнопке, прогрессом и проверкой sha256; модели не входят в бандл приложения
- [x] #3 VoiceSettingsModal: выбор TTS-движка (Системный / Piper), голоса со статусом загрузки, скорости и громкости, кнопка «Прослушать»; строки в i18n ru/en
- [x] #4 Импорт пользовательского голоса (.onnx + .onnx.json): валидация конфига, конвертация в формат sherpa (tokens.txt, metadata), понятные ошибки при невалидных файлах
- [x] #5 Команды read_tasks, read_doc и stop_reading работают через Piper; stop прерывает и генерацию (по jobId), и воспроизведение; звук идёт через выбранное устройство вывода (setSinkId); VAD не реагирует на собственную речь приложения
- [x] #6 Синтез на 100% локальный на CPU: после загрузки моделей нет сетевых запросов; генерация по предложениям — первый чанк < 1 с, RTF < 1 на medium-голосе (замер зафиксирован в notes)
- [x] #7 При отсутствии модели, ошибке воркера или недоступном нативном модуле приложение деградирует в системный speechSynthesis без краша и показывает причину в настройках
- [x] #8 sherpa-onnx-node и платформенный пакет добавлены в externals и asarUnpack; npm run check-bundle, lint, test зелёные; npm run pack:win собран и release/win-unpacked/ProjectHub.exe озвучивает текст
- [x] #9 Unit-тесты на чистые модули: разбиение на предложения, парсер .onnx.json → tokens.txt, реестр голосов и пути кэша
- [x] #10 ADR decision-25 переведён в accepted с фактическими замерами (RTF, память, время загрузки) и лицензионными заметками (GPL-компонент espeak-ng, лицензия датасета RHVoice)
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Спайк (шаг 1) — вариант A подтверждён

Проверено 2026-09-16 на Windows 10, Electron 44.0.0, Node 22.16.0, sherpa-onnx-node 1.13.8, голос
`vits-piper-ru_RU-irina-medium`. Вариант B (WASM в рендерере) не понадобился.

- **Нативный модуль грузится из упакованного приложения.** `require` по пути внутрь `app.asar`
  работает — Electron прозрачно подменяет файлы распакованными из `app.asar.unpacked`.
- **Главная находка: в Electron V8 запрещены external buffers.** `generate()` падает с
  «External buffers are not allowed» и в главном потоке, и в воркере. Лечится
  `enableExternalBuffer: false` в каждом запросе. В обычном node ошибки нет — ловушка для
  разработки вне Electron, поэтому вынесена отдельным пунктом в decision-25.
- **`**/*.node` в asarUnpack недостаточно:** рядом с `sherpa-onnx.node` должны лежать его DLL
  (`onnxruntime.dll` 17 МБ и др.), поэтому в asarUnpack добавлены целиком каталоги платформенных
  пакетов. Пересборка не нужна — модуль на N-API (`npmRebuild: false` сохранён).
- **ABI:** N-API стабилен между Node 22 (modules 127) и Electron 44 (modules 149).

## Замеры (AC#6 выполнен с запасом)

| Метрика | Значение |
|---|---|
| Загрузка модели | 818–980 мс (872 мс в воркере из упакованного `app.asar`) |
| RTF | 0.061–0.071 (в 14–16 раз быстрее реального времени) |
| Первый чанк | 53 мс в node, 209–263 мс в Electron |
| RSS после загрузки / после генерации | ~134–143 МБ / ~235–290 МБ |

## Импорт пользовательских голосов

«Сырая» модель Piper с Hugging Face **не принимается** sherpa: `'sample_rate' does not exist in
the metadata`, причём процесс **аварийно завершается** (exit 127), а не бросает исключение. Отсюда
два следствия: чужие модели проверяются только в воркере, и metadata приходится добавлять.

Решение без Python и без protobuf-зависимости: ONNX — это protobuf `ModelProto`, где
`metadata_props` — repeated-поле 14, а элементы repeated-поля можно дописать в конец сообщения.
Дописывание 128 байт делает модель с HF рабочей (проверено на реальном файле). `tokens.txt`
строится из `phoneme_id_map` — сверено с релизным `tokens.txt` sherpa, 151 символ, полное
совпадение. Поля `phoneme_type` в реальных конфигах с HF нет, признак espeak — `espeak.voice`.

## Архитектура

- Чистые модули без Electron/React: `ttsTextSplit` (предложения, сокращения, лимит длины),
  `piperVoiceConfig` (валидация конфига, tokens.txt, protobuf-metadata), `ttsVoiceRegistry`
  (6 голосов с реальными sha256, пути кэша, защита от обхода каталога).
- `ttsVoiceStore` — загрузка с прогрессом и проверкой sha256, распаковка системным `tar`
  (bzip2 в Node нет), импорт, удаление. `espeak-ng-data` (18 МБ) хранится **один раз** и общий
  для всех голосов, включая импортированные.
- `piperTtsService` + `ttsWorker.mjs` — ленивая загрузка, очередь с `jobId`, таймауты 45/90 с,
  до 2 перезапусков. Отмена реальная: возврат `0` из `onProgress` прерывает синтез внутри sherpa.
- Рендерер: `ttsPlayer` (AudioContext на частоте модели, `setSinkId`, склейка чанков встык),
  маршрутизация в `voiceService.speak`, глушение VAD на время собственной речи.

## Отступление от decision-21 (зафиксировано в ADR)

In-process fallback в main намеренно **не** сделан: синтез в main заблокировал бы event loop на
всю фразу, а деградация уже есть уровнем выше — рендерер возвращается к системному
`speechSynthesis`. При недоступности воркера сервис переходит в `unavailable` с кодом причины
(`native_module_missing`, `worker_crashed`, …), который рендерер переводит через i18n и
показывает в настройках.

## Что проверено автоматически и что требует ручной проверки

Проверено: синтез и отмена через **реальный воркер из упакованного `app.asar`**; загрузка
нативного модуля из release-сборки; импорт голоса (fs, metadata, tokens.txt, манифест, ошибки)
интеграционным тестом; 75 unit-тестов на чистые модули и хранилище.

Требует ручного клика в UI (для этого задача и уходит в Review): скачивание голоса кнопкой с
прогрессом, звучание через выбранное устройство вывода (`setSinkId`), реакция VAD на собственную
речь, команды `read_tasks` / `read_doc` / `stop_reading` с загруженным голосом. Звук и GUI
headless-проверкой не подтверждаются.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-16 11:57
---
Живая проверка в GUI (2026-09-16). Задача остаётся в Review: часть критериев на этой машине проверить нечем.

Прогон в упакованном `release/win-unpacked/ProjectHub.exe` (снятая `ELECTRON_RUN_AS_NODE`, `PROJECTHUB_LOG_LEVEL=debug`), управление по CDP напрямую — Playwright не устанавливался.

**Подтверждено живьём:**

- **Скачивание голоса кнопкой с прогрессом (AC#2).** `ru_RU-dmitri-medium` установлен нажатием «Download»: ~10 с на 64 МБ, фазы `download` → `verify` → `extract` → `done`, проценты монотонны и считаются от настоящего `Content-Length`. Отмена загрузки кнопкой тоже работает и не оставляет мусора.
- **Синтез (AC#1, AC#6).** Модель грузится в воркер за 843 мс (`[PiperTTS] Voice ru_RU-dmitri-medium loaded in 843ms (22050 Hz)`). На прогретой модели первый чанк — **134 мс** при 2,33 с звука, то есть RTF ≈ 0,06: сходится с замерами спайка в decision-25 и укладывается в AC#6 с большим запасом. Ошибок синтеза нет, событие `tts:done` приходит, промис `speak()` резолвится.
- **Вывод в выбранное устройство, `setSinkId` (AC#5, часть).** На вкладке «Audio Devices» выбрано конкретное устройство (не «по умолчанию»), настройка сохранилась в конфиг, последующая озвучка прошла без предупреждения `[TtsPlayer] setSinkId failed` в консоли рендерера (консоль слушалась по CDP: в `main.log` строки рендерера не попадают даже на уровне debug).
- **Отмена генерации и остановка (AC#5, часть).** Смена движка вызывает `stopSpeaking()`: после неё ни одного нового чанка, очередь в main пуста, ошибок нет.
- **Статус движка в настройках (AC#7, часть).** Панель показывает «Model not loaded» до первой озвучки и «Ready» со временем загрузки после неё.

**Не проверено и почему:**

- **VAD не реагирует на собственную речь (AC#5, остаток)** — на машине **нет устройства аудиозахвата**: `navigator.mediaDevices.enumerateDevices()` возвращает `audioinput: []`, на уровне ОС единственная аудиоконечная точка — `Remote Audio` (RDP). Без микрофона VAD не запускается в принципе.
- **Команды `read_tasks`, `read_doc`, `stop_reading` голосом (AC#5, остаток)** — по той же причине: они приходят из распознанной речи.
- **Импорт пользовательского голоса (AC#4)** — точка входа открывает нативный диалог выбора файла (`dialog.showOpenDialog`), а он не автоматизируется через CDP. Логика импорта покрыта интеграционным тестом, живой клик остаётся.
- **Деградация в системный движок (AC#7, остаток)** — воспроизведение потребовало бы удалить рабочий голос на машине владельца; не делал.

Остаток вынесен в **TASK-90** (живая проверка на машине с микрофоном). Звук как таковой подтвердить нельзя и в принципе: сеанс RDP, единственный выход — «Remote Audio»; проверен весь конвейер до графа воспроизведения включительно, слышимость остаётся за владельцем.
---

created: 2026-09-17 11:21
---
Промежуточный итог живой проверки 2026-09-17 (фейковый микрофон Chromium + синтезированная Piper речь, упакованный exe; метод согласован владельцем).

**Найдено и исправлено (не закоммичено):**
1. **Импорт битой модели ронял всё приложение** (crash dump): нативный abort sherpa в `worker_threads` убивает main-процесс. Исправлено: импортированная модель сначала проходит пробу в отдельном `utilityProcess` (`ttsProbe.mjs`, `ttsVoiceProbe.ts`, чистый `ttsVoiceProbeOutcome.ts` + тесты), коды `model_rejected/probe_timeout/probe_unavailable` с переводом.
2. **Критично: любая озвучка Piper после распознавания Whisper роняла приложение** — в одном процессе конфликтуют `onnxruntime.dll` 1.21 (onnxruntime-node) и 1.28.2 (sherpa). Воспроизведено детерминированно без микрофона. Исправлено: весь синтез Piper перенесён из `worker_threads` в `utilityProcess` (решение владельца).
3. **`read_tasks`/`read_doc` были недостижимы голосом**: правила навигации по подстроке «задач»/«документ» стояли раньше; плюс парсер стал терпим к формам «прочитаю задачу», «прочитая документ», которые слышит Whisper. Тесты.
4. **Причина деградации не показывалась в настройках** для ошибки голоса (показывалось «Модель не загружена»), а отсутствие нативного модуля классифицировалось как `load_failed`. Исправлено: `ttsStatusView.ts` + `isNativeModuleMissingError`, тесты, обновление статуса после прослушивания и по ошибке синтеза.

**Подтверждено живьём по AC:** AC#1 (сервис/процесс, отмена по jobId — после отмены ни одного чанка), AC#4 (невалидный конфиг → понятная ошибка; битый .onnx → отклонён без краша; сырой голос с HF импортирован и звучит), AC#5 (голосом: «Какие задачи?» → Piper читает 39 с; «Прочитай документ» → озвучка; «Хватит» → остановка; во время озвучки речь не уходит в распознавание), AC#6 (прогретый первый чанк 132 мс, RTF ≈ 0.06), AC#7 (все три причины: нет модели, ошибка загрузки, нет нативного модуля — откат в системный голос + причина в настройках).

**Не проверяемо здесь:** устойчивость к эху озвучки через колонки — держится на эхоподавлении, у фейкового устройства его нет (остаётся в TASK-90).

**Осталось:** обновить decision-25 / новый ADR (utilityProcess), финальные проверки, коммит.
---

created: 2026-09-17 12:47
---
Итоговая проверка (2026-09-17). Критерии отмечены агентом по разрешению владельца (в обход decision-28).

**Оговорки к отметкам:**
- **AC#1**: синтез выполняется не в `worker_threads`, а в `utilityProcess` ([[decision-34]]): в одном процессе с Whisper конфликтовали `onnxruntime.dll`, а воркер не изолирует нативные падения. In-process fallback в main намеренно не сделан, деградация идёт в системный `speechSynthesis` ([[decision-25]] п. 4).
- **AC#5**: «не реагирует на собственную речь» проверено фейковым микрофоном (гейт `ttsMuted`). Эхо через колонки зависит от эхоподавления реального устройства и остаётся в TASK-90.
- **AC#10**: пересмотр места выполнения синтеза зафиксирован в [[decision-34]], в decision-25 добавлена отметка о пересмотре.

**Найденный дефект вынесен в TASK-93:** импорт с именем встроенного голоса подменяет его, а при неудачной пробе удаляет рабочий встроенный голос.

**Проверки:** `pack:win` собран 20:46 (в составе lint — 0 ошибок, 502 предупреждения, ниже базового уровня 503; vitest — 96 файлов, 1029 тестов; check-bundle чисто), `lint:docs` и `index-docs` чисто.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Добавлен второй движок озвучки — локальный нейросетевой TTS на голосах Piper (VITS/ONNX) через `sherpa-onnx-node`, рядом с системным `speechSynthesis`. Работает полностью оффлайн на CPU, умеет выбирать голос, скорость, громкость и устройство вывода, импортирует пользовательские голоса.

**Архитектура.** Синтез выполняется в Electron `utilityProcess` (`ttsWorker.mjs`, `piperTtsService`): ленивая загрузка модели, очередь с `jobId`, отмена, таймауты, ограниченный respawn. Изначально синтез жил в `worker_threads` ([[decision-25]]), но живая проверка показала две проблемы. Первая: `onnxruntime.dll` sherpa (1.28) и Whisper (1.21) конфликтуют в одном процессе, и озвучка после распознавания роняла приложение. Вторая: `abort()` sherpa на битой модели убивает весь main. Перенос зафиксирован в [[decision-34]]. Импортированный голос сначала проходит пробу в отдельном одноразовом процессе (`ttsProbe.mjs`, чистый `ttsVoiceProbeOutcome`).

**Голоса.** Шесть встроенных (ru ×4, en ×2) скачиваются по кнопке с прогрессом и проверкой sha256; распаковка идёт внутри процесса ([[decision-32]]). `espeak-ng-data` хранится один раз на все голоса. Импорт `.onnx + .onnx.json` работает без Python и protobuf-зависимости: `tokens.txt` строится из `phoneme_id_map`, metadata дописывается в `metadata_props`.

**Рендерер.** `ttsPlayer` воспроизводит звук через `AudioContext` + `setSinkId`, VAD на время собственной речи глушится. В настройках есть раздел TTS с причиной деградации (`ttsStatusView`). Команды `read_tasks`/`read_doc` снова достижимы голосом: раньше их перехватывала навигация.

**Замеры:** загрузка модели ~0,85 с, прогретый первый чанк 132–134 мс, RTF ≈ 0,06.

**Живая проверка** (упакованный exe, фейковый микрофон Chromium, речь Piper): установка голоса кнопкой; синтез и отмена; `setSinkId`; «Какие задачи?» → чтение 39 с; «Хватит» → остановка; во время озвучки речь не уходит в распознавание; импорт невалидного конфига и битого `.onnx` отклоняется без краша; сырой голос с HF импортирован и звучит; все три причины деградации показываются в настройках.

**Проверки:** lint 0 ошибок (502 предупреждения), 96 файлов / 1029 тестов, check-bundle, lint:docs, index-docs, `pack:win` — зелёные.

**Осталось вне задачи:** эхо озвучки через колонки (TASK-90), подмена и удаление встроенного голоса при импорте с тем же именем (TASK-93).
<!-- SECTION:FINAL_SUMMARY:END -->
