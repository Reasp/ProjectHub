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

/**
 * Пробная загрузка импортированного голоса в отдельном процессе (decision-34): модель отвергнута
 * (процесс упал или синтез не удался), проба не уложилась во время, пробу нечем запустить.
 */
export const PIPER_VOICE_PROBE_ERROR_CODES = ['model_rejected', 'probe_timeout', 'probe_unavailable'] as const;

export type PiperVoiceProbeErrorCode = (typeof PIPER_VOICE_PROBE_ERROR_CODES)[number];

/**
 * Сообщение об ошибке означает, что нативный модуль sherpa-onnx не установлен для платформы.
 *
 * Формулировки разные: Node пишет «Cannot find module 'sherpa-onnx-node'» (`MODULE_NOT_FOUND`), а сам
 * `sherpa-onnx-node`, если нет платформенного пакета, — «Could not find sherpa-onnx-node. Tried …»
 * (проверено 2026-09-17 на сборке без `sherpa-onnx-win-x64`). Перезапуски воркера тут не помогают.
 */
export function isNativeModuleMissingError(message: string): boolean {
  return /MODULE_NOT_FOUND|Cannot find module|Could not find sherpa-onnx/i.test(message);
}

/**
 * Второй движок — Qwen3-TTS в сайдкаре Python (TASK-104, decision-64): окружение не установлено,
 * сайдкар не запустился или упал, модель не загрузилась, рецепт голоса не прошёл проверку.
 * Часть кодов приходит из самого сайдкара (`sidecar.py`) — список общий.
 */
export const QWEN_TTS_ERROR_CODES = [
  'qwen_not_installed',
  'qwen_model_missing',
  'qwen_sidecar_missing',
  'qwen_sidecar_crashed',
  'qwen_sidecar_timeout',
  'qwen_runtime_broken',
  'qwen_load_failed',
  'qwen_model_not_loaded',
  'qwen_out_of_memory',
  'qwen_synthesis_failed',
  'qwen_bad_request',
  'qwen_invalid_recipe',
  'qwen_probe_required',
  'qwen_voice_not_found'
] as const;

/** Установка окружения и весов Qwen3-TTS (`electron/workers/qwen/setup.mjs`). */
export const QWEN_INSTALL_ERROR_CODES = [
  'qwen_install_in_progress',
  'qwen_install_cancelled',
  'qwen_install_failed',
  'qwen_setup_missing',
  'qwen_python_missing',
  'qwen_gpu_missing',
  'qwen_disk_space',
  'qwen_venv_failed',
  'qwen_pip_failed',
  'qwen_download_failed',
  'qwen_checksum_mismatch'
] as const;

export type QwenTtsErrorCode =
  | (typeof QWEN_TTS_ERROR_CODES)[number]
  | (typeof QWEN_INSTALL_ERROR_CODES)[number];

const QWEN_CODES: readonly string[] = [...QWEN_TTS_ERROR_CODES, ...QWEN_INSTALL_ERROR_CODES];

/** Код из сайдкара или скрипта установки; неизвестный заменяется общим, чтобы в интерфейс не ушла сырая строка. */
export function toQwenErrorCode(code: unknown, fallback: QwenTtsErrorCode): QwenTtsErrorCode {
  return typeof code === 'string' && QWEN_CODES.includes(code) ? (code as QwenTtsErrorCode) : fallback;
}

/** Отказы на уровне IPC: до хранилища и движка дело не дошло. */
export const TTS_IPC_ERROR_CODES = ['no_window', 'invalid_request'] as const;

export type TtsIpcErrorCode = (typeof TTS_IPC_ERROR_CODES)[number];

/** Все коды, которые могут уйти в рендерер и обязаны иметь перевод. */
export const ALL_TTS_ERROR_CODES: readonly string[] = [
  ...TTS_VOICE_STORE_ERROR_CODES,
  ...PIPER_VOICE_CONFIG_ERROR_CODES,
  ...PIPER_TTS_UNAVAILABLE_CODES,
  ...PIPER_VOICE_PROBE_ERROR_CODES,
  ...QWEN_TTS_ERROR_CODES,
  ...QWEN_INSTALL_ERROR_CODES,
  ...TTS_IPC_ERROR_CODES
];
