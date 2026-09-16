/**
 * Коды ошибок локального TTS (TASK-69, TASK-87, decision-25, decision-32).
 *
 * Main-процесс отдаёт наружу **код**, а не текст: строки интерфейса живут в i18n рендерера
 * (decision-25 п. 3). Слабое место такого контракта — код, для которого перевода не завели:
 * пользователь видит сырой `already_installed` вместо сообщения.
 *
 * Поэтому списки объявлены значениями, а не только типами: unit-тест проверяет, что у каждого
 * кода есть перевод в `ru` и `en` и что в словаре нет осиротевших ключей (правило 17).
 *
 * Чистый модуль: без Electron и файловой системы.
 */

/** Ошибки хранилища голосов: скачивание, проверка, распаковка, импорт, удаление. */
export const TTS_VOICE_STORE_ERROR_CODES = [
  'invalid_voice_id',
  'unknown_voice',
  'download_failed',
  'download_in_progress',
  'checksum_mismatch',
  'extract_failed',
  'archive_corrupted',
  'unsafe_archive_entry',
  'model_not_found',
  'config_not_found',
  'espeak_data_missing'
] as const;

export type TtsVoiceStoreErrorCode = (typeof TTS_VOICE_STORE_ERROR_CODES)[number];

/** Ошибки разбора пользовательского конфига Piper (`.onnx.json`). */
export const PIPER_VOICE_CONFIG_ERROR_CODES = [
  'invalid_json',
  'not_an_object',
  'missing_phoneme_id_map',
  'empty_phoneme_id_map',
  'missing_espeak_voice',
  'missing_sample_rate',
  'unsupported_phoneme_type'
] as const;

export type PiperVoiceConfigErrorCode = (typeof PIPER_VOICE_CONFIG_ERROR_CODES)[number];

/** Причины недоступности движка синтеза (воркер, нативный модуль, модель). */
export const PIPER_TTS_UNAVAILABLE_CODES = [
  'worker_script_missing',
  'native_module_missing',
  'worker_crashed',
  'voice_not_installed',
  'load_failed'
] as const;

export type PiperTtsUnavailableCode = (typeof PIPER_TTS_UNAVAILABLE_CODES)[number];

/** Отказы на уровне IPC: до хранилища и движка дело не дошло. */
export const TTS_IPC_ERROR_CODES = ['no_window', 'invalid_request'] as const;

export type TtsIpcErrorCode = (typeof TTS_IPC_ERROR_CODES)[number];

/** Все коды, которые могут уйти в рендерер и обязаны иметь перевод. */
export const ALL_TTS_ERROR_CODES: readonly string[] = [
  ...TTS_VOICE_STORE_ERROR_CODES,
  ...PIPER_VOICE_CONFIG_ERROR_CODES,
  ...PIPER_TTS_UNAVAILABLE_CODES,
  ...TTS_IPC_ERROR_CODES
];
