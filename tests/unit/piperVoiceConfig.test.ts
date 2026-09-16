import { describe, expect, it } from 'vitest';

import {
  buildPiperOnnxMetadata,
  buildTokensTxt,
  encodeOnnxMetadataProps,
  onnxHasPiperMetadata,
  parsePiperVoiceConfig,
  PiperVoiceConfigError,
  type PiperVoiceConfigErrorCode
} from '../../electron/services/piperVoiceConfig';

/** Минимальный корректный конфиг Piper — как в `.onnx.json` с Hugging Face (phoneme_type там нет). */
function makeRawConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    audio: { sample_rate: 22050 },
    espeak: { voice: 'ru' },
    num_speakers: 1,
    language: { code: 'ru_RU', name_english: 'Russian' },
    inference: { noise_scale: 0.4, noise_w: 0.6, length_scale: 1.2 },
    phoneme_id_map: { а: [10], _: [0], $: [2], '^': [1] },
    ...overrides
  };
}

/** Возвращает код ошибки разбора; падает, если конфиг неожиданно оказался валидным. */
function configErrorCode(raw: unknown): PiperVoiceConfigErrorCode {
  try {
    parsePiperVoiceConfig(raw);
  } catch (err) {
    expect(err).toBeInstanceOf(PiperVoiceConfigError);
    return (err as PiperVoiceConfigError).code;
  }
  throw new Error('ожидалась ошибка PiperVoiceConfigError, но конфиг разобрался');
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = offset;
  for (;;) {
    const byte = bytes[i];
    expect(byte).toBeDefined();
    i += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value, next: i };
}

/** Обратный разбор `metadata_props`: заодно проверяет теги полей и корректность varint-длин. */
function decodeMetadataProps(bytes: Uint8Array): Record<string, string> {
  const decoder = new TextDecoder();
  const result: Record<string, string> = {};
  let i = 0;
  while (i < bytes.length) {
    expect(bytes[i]).toBe(0x72); // поле 14 (metadata_props), wire type 2
    i += 1;
    const entryLen = readVarint(bytes, i);
    i = entryLen.next;
    const entry = bytes.subarray(i, i + entryLen.value);
    expect(entry.length).toBe(entryLen.value);
    i += entryLen.value;

    let j = 0;
    expect(entry[j]).toBe(0x0a); // StringStringEntryProto.key
    j += 1;
    const keyLen = readVarint(entry, j);
    j = keyLen.next;
    const key = decoder.decode(entry.subarray(j, j + keyLen.value));
    j += keyLen.value;

    expect(entry[j]).toBe(0x12); // StringStringEntryProto.value
    j += 1;
    const valueLen = readVarint(entry, j);
    j = valueLen.next;
    const value = decoder.decode(entry.subarray(j, j + valueLen.value));
    j += valueLen.value;

    expect(j).toBe(entry.length); // лишних байтов в записи нет
    result[key] = value;
  }
  return result;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('piperVoiceConfig — разбор конфига голоса (TASK-69)', () => {
  it('принимает и строку JSON, и уже разобранный объект', () => {
    const fromObject = parsePiperVoiceConfig(makeRawConfig());
    const fromString = parsePiperVoiceConfig(JSON.stringify(makeRawConfig()));

    expect(fromString).toEqual(fromObject);
    expect(fromObject.sampleRate).toBe(22050);
  });

  it('читает частоту, голос espeak, число спикеров и параметры вывода', () => {
    const cfg = parsePiperVoiceConfig(makeRawConfig({ num_speakers: 3 }));

    expect(cfg.sampleRate).toBe(22050);
    expect(cfg.espeakVoice).toBe('ru');
    expect(cfg.numSpeakers).toBe(3);
    expect(cfg.language).toBe('Russian');
    expect(cfg.noiseScale).toBe(0.4);
    expect(cfg.noiseScaleW).toBe(0.6);
    expect(cfg.lengthScale).toBe(1.2);
    expect(cfg.phonemeIdMap['а']).toEqual([10]);
  });

  it('без секции inference подставляет дефолты 0.667 / 0.8 / 1.0', () => {
    const raw = makeRawConfig();
    delete raw.inference;
    const cfg = parsePiperVoiceConfig(raw);

    expect(cfg.noiseScale).toBeCloseTo(0.667, 6);
    expect(cfg.noiseScaleW).toBeCloseTo(0.8, 6);
    expect(cfg.lengthScale).toBeCloseTo(1.0, 6);
  });

  it('без num_speakers считает модель односпикерной', () => {
    const raw = makeRawConfig();
    delete raw.num_speakers;

    expect(parsePiperVoiceConfig(raw).numSpeakers).toBe(1);
  });

  it('берёт sample_rate и с верхнего уровня, если секции audio нет', () => {
    const raw = makeRawConfig({ sample_rate: 16000 });
    delete raw.audio;

    expect(parsePiperVoiceConfig(raw).sampleRate).toBe(16000);
  });

  it('отсутствие phoneme_type — не ошибка (в файлах с Hugging Face поля нет)', () => {
    const raw = makeRawConfig();
    expect('phoneme_type' in raw).toBe(false);

    expect(() => parsePiperVoiceConfig(raw)).not.toThrow();
    expect(parsePiperVoiceConfig(raw).espeakVoice).toBe('ru');
  });

  it('явный phoneme_type espeak принимается в любом регистре', () => {
    expect(() => parsePiperVoiceConfig(makeRawConfig({ phoneme_type: 'espeak' }))).not.toThrow();
    expect(() => parsePiperVoiceConfig(makeRawConfig({ phoneme_type: 'eSpeak' }))).not.toThrow();
  });
});

describe('piperVoiceConfig — коды ошибок разбора (TASK-69)', () => {
  it('битый JSON — invalid_json', () => {
    expect(configErrorCode('{ это не json')).toBe('invalid_json');
  });

  it('не объект — not_an_object', () => {
    expect(configErrorCode('[1, 2, 3]')).toBe('not_an_object');
    expect(configErrorCode(42)).toBe('not_an_object');
  });

  it('без espeak.voice — missing_espeak_voice', () => {
    const raw = makeRawConfig();
    delete raw.espeak;
    expect(configErrorCode(raw)).toBe('missing_espeak_voice');
    expect(configErrorCode(makeRawConfig({ espeak: { voice: '   ' } }))).toBe('missing_espeak_voice');
  });

  it('без phoneme_id_map — missing_phoneme_id_map', () => {
    const raw = makeRawConfig();
    delete raw.phoneme_id_map;
    expect(configErrorCode(raw)).toBe('missing_phoneme_id_map');
  });

  it('пустая таблица символов — empty_phoneme_id_map', () => {
    expect(configErrorCode(makeRawConfig({ phoneme_id_map: {} }))).toBe('empty_phoneme_id_map');
  });

  it('без частоты дискретизации — missing_sample_rate', () => {
    const raw = makeRawConfig();
    delete raw.audio;
    expect(configErrorCode(raw)).toBe('missing_sample_rate');
    expect(configErrorCode(makeRawConfig({ audio: { sample_rate: 0 } }))).toBe('missing_sample_rate');
  });

  it('phoneme_type text не поддерживается — unsupported_phoneme_type', () => {
    expect(configErrorCode(makeRawConfig({ phoneme_type: 'text' }))).toBe('unsupported_phoneme_type');
  });

  it('ошибка несёт код и человекочитаемое сообщение', () => {
    const err = new PiperVoiceConfigError('missing_sample_rate', 'audio.sample_rate');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PiperVoiceConfigError');
    expect(err.code).toBe('missing_sample_rate');
    expect(err.message).toContain('missing_sample_rate');
    expect(err.message).toContain('audio.sample_rate');
  });
});

describe('piperVoiceConfig — tokens.txt (TASK-69)', () => {
  it('строки «символ id» отсортированы по id и файл заканчивается переводом строки', () => {
    const cfg = parsePiperVoiceConfig(makeRawConfig());
    const tokens = buildTokensTxt(cfg);

    expect(tokens).toBe('_ 0\n^ 1\n$ 2\nа 10\n');
    expect(tokens.endsWith('\n')).toBe(true);

    const lines = tokens.split('\n').filter((l) => l.length > 0);
    const ids = lines.map((l) => Number(l.split(' ')[1]));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    for (const line of lines) expect(line).toMatch(/^\S+ \d+$/);
  });
});

describe('piperVoiceConfig — metadata ONNX (TASK-69)', () => {
  it('метаданные для sherpa содержат model_type, comment и частоту', () => {
    const cfg = parsePiperVoiceConfig(makeRawConfig({ num_speakers: 2 }));
    const meta = buildPiperOnnxMetadata(cfg);

    expect(meta.model_type).toBe('vits');
    expect(meta.comment).toBe('piper');
    expect(meta.sample_rate).toBe('22050');
    expect(meta.n_speakers).toBe('2');
    expect(meta.voice).toBe('ru');
    expect(meta.has_espeak).toBe('1');
  });

  it('каждая запись — поле 14 (0x72) с ключом 0x0A и значением 0x12', () => {
    const bytes = encodeOnnxMetadataProps({ model_type: 'vits' });
    const encoder = new TextEncoder();

    // 0x72 = (14 << 3) | 2, длина записи коротких строк умещается в один байт varint
    expect(bytes[0]).toBe(0x72);
    expect(bytes[1]).toBe(bytes.length - 2);
    expect(bytes[1] & 0x80).toBe(0);
    expect(bytes[2]).toBe(0x0a);
    expect(bytes[3]).toBe('model_type'.length);
    expect(indexOfBytes(bytes, encoder.encode('model_type'))).toBe(4);

    const valueTagAt = 4 + 'model_type'.length;
    expect(bytes[valueTagAt]).toBe(0x12);
    expect(bytes[valueTagAt + 1]).toBe('vits'.length);
    expect(indexOfBytes(bytes, encoder.encode('vits'))).toBe(valueTagAt + 2);
    expect(bytes.length).toBe(2 + 2 + 'model_type'.length + 2 + 'vits'.length);
  });

  it('несколько записей декодируются обратно без потерь', () => {
    const meta = buildPiperOnnxMetadata(parsePiperVoiceConfig(makeRawConfig()));
    const bytes = encodeOnnxMetadataProps(meta);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decodeMetadataProps(bytes)).toEqual(meta);
  });

  it('длина в varint: многобайтовая для значений длиннее 127 байт', () => {
    const longValue = 'x'.repeat(200);
    const bytes = encodeOnnxMetadataProps({ comment: longValue });

    expect(bytes[0]).toBe(0x72);
    expect(bytes[1] & 0x80).not.toBe(0); // продолжение varint
    expect(bytes[2] & 0x80).toBe(0); // второй и последний байт длины
    expect(decodeMetadataProps(bytes)).toEqual({ comment: longValue });
  });

  it('не-ASCII значение кодируется в UTF-8 и длина считается в байтах', () => {
    const bytes = encodeOnnxMetadataProps({ language: 'Русский' });
    const encoded = new TextEncoder().encode('Русский');

    expect(encoded.length).toBe(14); // 7 символов, 14 байт
    expect(indexOfBytes(bytes, encoded)).toBeGreaterThan(0);
    expect(decodeMetadataProps(bytes)).toEqual({ language: 'Русский' });
  });

  it('пустые метаданные дают пустой буфер', () => {
    expect(encodeOnnxMetadataProps({}).length).toBe(0);
  });
});

describe('piperVoiceConfig — признак готовой metadata в ONNX (TASK-69)', () => {
  const bytesOf = (text: string) => new TextEncoder().encode(text);

  it('true, когда в хвосте есть и model_type, и sample_rate', () => {
    expect(onnxHasPiperMetadata(bytesOf(' model_type vits sample_rate 22050'))).toBe(true);
  });

  it('false, когда есть только один из маркеров или нет ни одного', () => {
    expect(onnxHasPiperMetadata(bytesOf('model_type vits'))).toBe(false);
    expect(onnxHasPiperMetadata(bytesOf('sample_rate 22050'))).toBe(false);
    expect(onnxHasPiperMetadata(bytesOf('просто байты модели'))).toBe(false);
    expect(onnxHasPiperMetadata(new Uint8Array(0))).toBe(false);
  });

  it('распознаёт metadata, которую сам же и закодировал', () => {
    const meta = buildPiperOnnxMetadata(parsePiperVoiceConfig(makeRawConfig()));
    expect(onnxHasPiperMetadata(encodeOnnxMetadataProps(meta))).toBe(true);
  });
});
