---
id: TASK-114
title: >-
  Qwen3-TTS на macOS (Apple Silicon): рантайм qwentts.cpp на Metal, спайк на M1
  Pro
status: In Progress
assignee: []
created_date: '2026-09-29 04:52'
labels:
  - voice
  - tts
  - qwen
  - macos
milestone: m-0
dependencies:
  - TASK-104
references:
  - scripts/qwen-tts/mac_spike.py
  - 'https://github.com/ServeurpersoCom/qwentts.cpp'
  - 'https://github.com/andimarafioti/qwentts-cpp-python'
  - 'https://huggingface.co/Serveurperso/Qwen3-TTS-GGUF'
priority: medium
type: spike
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Второй движок озвучки (TASK-104, [[decision-64]]) работает только с видеокартой NVIDIA: сайдкар построен на PyTorch с CUDA graphs. На macOS кнопка установки откажет с `qwen_gpu_missing`, и говорить будет Piper или системный голос.

Те же модели Qwen3-TTS запускаются на Apple Silicon другим рантаймом — `qwentts.cpp` (C++, GGML, бэкенд Metal; MIT). Привязки `qwentts-cpp-python` 0.4.1 ставятся готовым колесом для macOS 14+ arm64.

## Что известно (проверено 2026-09-29 по исходникам пакетов, не запуском)

- Рантайму не нужен PyTorch: зависимости — `numpy` и `huggingface-hub`. Установка — десятки мегабайт вместо 5.5 ГБ.
- Поддерживает всё, что есть на Windows: CustomVoice (пресеты с инструкцией подачи), VoiceDesign, Base (клон по эмбеддингу диктора через `extract_voice_ref`), потоковую выдачу `stream()` с параметром `seed`.
- Первый чанк настраивается отдельно от последующих (`first_chunk_frames` 1/2/4/8 кадров) — на Windows такого нет, первый звук там ждёт полный чанк.
- Веса — готовые GGUF в `Serveurperso/Qwen3-TTS-GGUF` (ревизия `b7ee2e8c`): модель 1.7B — 3.84 ГБ в BF16, 2.04 ГБ в Q8_0, 1.18 ГБ в Q4_K_M; кодек — 0.25–0.36 ГБ.
- Колёса того же рантайма есть для Linux с CUDA; для Windows колеса нет.
- Сохранённый голос переносим между платформами: это рецепт и эталонная запись WAV.

## Чего не знаем

- **Скорость на M1 Pro.** Автор замеров на Mac не публикует. Единственная найденная цифра — RTF около 0.55 на M2 Max у сторонней реализации на Swift в пакетном режиме. У M1 Pro графическое ядро примерно вдвое слабее, поэтому модель 1.7B может оказаться на границе реального времени или за ней — это оценка, а не измерение.
- Качество квантованных весов (Q8, Q4) против BF16.
- Воспроизводится ли рецепт VoiceDesign побитово при том же seed, как на Windows.
- Принимает ли рантайм имя языка в нижнем регистре.

## Спайк

Скрипт `scripts/qwen-tts/mac_spike.py` снимает на Mac те же метрики теми же фразами, что замеры decision-64: первый звук, скорость после первого чанка, разрывы воспроизведения, память. Логика скрипта проверена на Windows с поддельным рантаймом; сам синтез на Mac не запускался — Mac у агента нет.

Запуск на Mac:

```
python3 -m venv ~/qwen-spike && source ~/qwen-spike/bin/activate
pip install "qwentts-cpp-python>=0.4.1" numpy
python mac_spike.py            # ~4.7 ГБ весов, 5–10 минут
python mac_spike.py --full     # плюс BF16, голос по описанию и клон: ещё ~8 ГБ
```

Если `huggingface.co` недоступен: `export HF_ENDPOINT=https://hf-mirror.com`.

Для разбора нужны `qwen-spike-out/report.json` и `summary.txt`; записи WAV стоит прослушать — акцент и естественность скрипт не оценивает.

## Порог применимости

Тот же, что в decision-50 п. 2 и decision-64: первый звук около секунды, генерация не медленнее воспроизведения. Если 1.7B в Q8 не проходит — смотреть Q4 и модель 0.6B (без инструкции подачи и с менее устойчивым клоном, см. замер 4 decision-64).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Замеры на M1 Pro 16 ГБ сняты скриптом mac_spike.py: первый звук, скорость после первого чанка, разрывы, память — для 1.7B в Q8_0 и Q4_K_M и для 0.6B в Q8_0
- [ ] #2 Прогон --full: эталон VoiceDesign и клон Base на тех же фразах, проверена побитовая воспроизводимость рецепта
- [ ] #3 Записи прослушаны человеком: акцент, естественность, различие квантований, сходство клона с эталоном
- [ ] #4 ADR: подключать ли рантайм qwentts.cpp на macOS, с какой моделью и квантованием; замеры — в Context
- [ ] #5 Если решение положительное — заведена задача на реализацию: выбор рантайма по платформе в сайдкаре и установке, манифест весов GGUF с sha256, проверка на Mac
<!-- AC:END -->
