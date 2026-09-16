/**
 * Разбор конфига голоса Piper (`<voice>.onnx.json`) и подготовка модели для sherpa-onnx (TASK-69).
 *
 * Голоса Piper с Hugging Face — это пара файлов `<voice>.onnx` + `<voice>.onnx.json`. sherpa-onnx
 * ждёт от модели два дополнительных артефакта, которых в «сыром» файле с HF нет (проверено в
 * спайке 2026-09-16):
 *
 * 1. `tokens.txt` — таблица «символ → id», восстанавливается из `phoneme_id_map` конфига
 *    (сверено с tokens.txt из релиза sherpa: 151 символ, полное совпадение);
 * 2. metadata внутри самого ONNX (`model_type`, `comment=piper`, `sample_rate`, …). Без неё
 *    загрузка падает с `'sample_rate' does not exist in the metadata` и **аварийно завершает
 *    процесс**, а не бросает исключение, — поэтому модель проверяется в воркере, а не в main.
 *
 * ONNX — это protobuf-сообщение `ModelProto`, где `metadata_props` — repeated-поле номер 14.
 * Элементы repeated-поля разрешено дописывать в конец сообщения, поэтому metadata добавляется
 * приписыванием байтов к файлу — без protobuf-зависимости и без Python (проверено в спайке).
 *
 * Чистый модуль: без Electron и файловой системы — покрыт unit-тестами (правило 17).
 */

/** Коды ошибок разбора: рендерер переводит их в сообщения i18n, main не хранит тексты интерфейса. */
export type PiperVoiceConfigErrorCode =
  | 'invalid_json'
  | 'not_an_object'
  | 'missing_phoneme_id_map'
  | 'empty_phoneme_id_map'
  | 'missing_espeak_voice'
  | 'missing_sample_rate'
  | 'unsupported_phoneme_type';

export class PiperVoiceConfigError extends Error {
  readonly code: PiperVoiceConfigErrorCode;
  /** Подробность для лога и подсказки в интерфейсе (имя поля, найденное значение). */
  readonly detail?: string;

  constructor(code: PiperVoiceConfigErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PiperVoiceConfigError';
    this.code = code;
    this.detail = detail;
  }
}

export interface PiperVoiceConfig {
  /** Частота дискретизации модели, Гц (обычно 22050). */
  sampleRate: number;
  /** Число голосов в модели; > 1 означает мультиспикерную модель. */
  numSpeakers: number;
  /** Голос espeak-ng для фонемизации (`ru`, `en-us`, …). */
  espeakVoice: string;
  /** Человекочитаемый язык из конфига — только для отображения. */
  language: string;
  noiseScale: number;
  noiseScaleW: number;
  lengthScale: number;
  /** Таблица «символ → id» из конфига Piper. */
  phonemeIdMap: Record<string, number[]>;
}

const DEFAULT_NOISE_SCALE = 0.667;
const DEFAULT_NOISE_SCALE_W = 0.8;
const DEFAULT_LENGTH_SCALE = 1.0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Разбирает и проверяет конфиг Piper.
 *
 * @param raw содержимое `.onnx.json` — строка или уже разобранный объект
 * @throws {PiperVoiceConfigError} с кодом причины, если конфиг не подходит
 */
export function parsePiperVoiceConfig(raw: unknown): PiperVoiceConfig {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new PiperVoiceConfigError('invalid_json', err instanceof Error ? err.message : String(err));
    }
  }

  const cfg = asRecord(data);
  if (!cfg) throw new PiperVoiceConfigError('not_an_object');

  // Фонемизация: поддерживается только espeak. Поле phoneme_type в файлах с HF часто отсутствует —
  // тогда признаком служит секция espeak (проверено на ru_RU-irina-medium).
  const phonemeType = cfg.phoneme_type;
  if (typeof phonemeType === 'string' && phonemeType.toLowerCase() !== 'espeak') {
    throw new PiperVoiceConfigError('unsupported_phoneme_type', phonemeType);
  }

  const espeak = asRecord(cfg.espeak);
  const espeakVoice = typeof espeak?.voice === 'string' ? espeak.voice.trim() : '';
  if (!espeakVoice) throw new PiperVoiceConfigError('missing_espeak_voice');

  const phonemeIdMapRaw = asRecord(cfg.phoneme_id_map);
  if (!phonemeIdMapRaw) throw new PiperVoiceConfigError('missing_phoneme_id_map');

  const phonemeIdMap: Record<string, number[]> = {};
  for (const [symbol, ids] of Object.entries(phonemeIdMapRaw)) {
    const list = Array.isArray(ids) ? ids : [ids];
    const numeric: number[] = [];
    for (const id of list) {
      const n = asFiniteNumber(id);
      if (n !== null) numeric.push(n);
    }
    if (numeric.length > 0) phonemeIdMap[symbol] = numeric;
  }
  if (Object.keys(phonemeIdMap).length === 0) throw new PiperVoiceConfigError('empty_phoneme_id_map');

  const audio = asRecord(cfg.audio);
  const sampleRate = asFiniteNumber(audio?.sample_rate) ?? asFiniteNumber(cfg.sample_rate);
  if (sampleRate === null || sampleRate <= 0) throw new PiperVoiceConfigError('missing_sample_rate');

  const inference = asRecord(cfg.inference);
  const languageRecord = asRecord(cfg.language);
  const language =
    (typeof languageRecord?.name_english === 'string' && languageRecord.name_english) ||
    (typeof languageRecord?.code === 'string' && languageRecord.code) ||
    (typeof cfg.language === 'string' ? cfg.language : '') ||
    espeakVoice;

  return {
    sampleRate,
    numSpeakers: Math.max(1, Math.trunc(asFiniteNumber(cfg.num_speakers) ?? 1)),
    espeakVoice,
    language,
    noiseScale: asFiniteNumber(inference?.noise_scale) ?? DEFAULT_NOISE_SCALE,
    noiseScaleW: asFiniteNumber(inference?.noise_w) ?? DEFAULT_NOISE_SCALE_W,
    lengthScale: asFiniteNumber(inference?.length_scale) ?? DEFAULT_LENGTH_SCALE,
    phonemeIdMap
  };
}

/**
 * Строит содержимое `tokens.txt` для sherpa: строка «<символ> <id>» на каждый символ,
 * отсортированная по id (формат релизных архивов sherpa).
 */
export function buildTokensTxt(config: PiperVoiceConfig): string {
  const rows = Object.entries(config.phonemeIdMap).map(([symbol, ids]) => ({ symbol, id: ids[0] }));
  rows.sort((a, b) => a.id - b.id);
  return rows.map((r) => `${r.symbol} ${r.id}`).join('\n') + '\n';
}

/** Метаданные, которые sherpa читает из ONNX при загрузке VITS/Piper-модели. */
export function buildPiperOnnxMetadata(config: PiperVoiceConfig): Record<string, string> {
  return {
    model_type: 'vits',
    comment: 'piper',
    language: config.language,
    voice: config.espeakVoice,
    has_espeak: '1',
    n_speakers: String(config.numSpeakers),
    sample_rate: String(config.sampleRate)
  };
}

/** Varint (base-128) — так protobuf кодирует длины. */
function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let n = value >>> 0;
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
}

function encodeLengthDelimited(fieldNumber: number, payload: Uint8Array): number[] {
  const tag = (fieldNumber << 3) | 2; // wire type 2 — length-delimited
  return [tag, ...encodeVarint(payload.length), ...payload];
}

/**
 * Кодирует metadata как элементы repeated-поля `metadata_props` (номер 14) `ModelProto`.
 * Результат дописывается в конец `.onnx` — protobuf разрешает элементы repeated-поля в любом
 * месте сообщения, поэтому переписывать файл целиком не нужно.
 */
export function encodeOnnxMetadataProps(metadata: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const entry = [
      ...encodeLengthDelimited(1, encoder.encode(key)),   // StringStringEntryProto.key
      ...encodeLengthDelimited(2, encoder.encode(String(value))) // StringStringEntryProto.value
    ];
    bytes.push(...encodeLengthDelimited(14, Uint8Array.from(entry))); // ModelProto.metadata_props
  }
  return Uint8Array.from(bytes);
}

/** Маркеры, по которым видно, что metadata в ONNX уже есть. */
const METADATA_MARKERS = ['model_type', 'sample_rate'];

/**
 * Проверяет, содержит ли модель metadata для sherpa. Метаданные лежат в конце файла, поэтому
 * достаточно передать его хвост (несколько килобайт) — читать 60 МБ целиком не нужно.
 */
export function onnxHasPiperMetadata(tail: Uint8Array): boolean {
  let text = '';
  for (let i = 0; i < tail.length; i += 1) text += String.fromCharCode(tail[i]);
  return METADATA_MARKERS.every((marker) => text.includes(marker));
}
