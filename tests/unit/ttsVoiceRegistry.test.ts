import { describe, expect, it } from 'vitest';

import {
  BUILTIN_TTS_VOICES,
  DEFAULT_VOICE_BY_LANGUAGE,
  getArchiveRootDir,
  getBuiltinVoice,
  getBuiltinVoicesForLanguage,
  getSharedEspeakDataDir,
  getTtsRootDir,
  getVoiceDir,
  getVoicePaths,
  isValidVoiceId,
  makeImportedVoiceId,
  VOICE_MANIFEST_FILE
} from '../../electron/services/ttsVoiceRegistry';

const MODELS_DIR = 'C:/Users/Test/AppData/Roaming/project-hub/models';

describe('ttsVoiceRegistry — встроенный каталог голосов (TASK-69)', () => {
  it('шесть голосов: четыре русских и два английских', () => {
    expect(BUILTIN_TTS_VOICES).toHaveLength(6);

    const ids = BUILTIN_TTS_VOICES.map((v) => v.id);
    expect(ids).toEqual([
      'ru_RU-irina-medium',
      'ru_RU-dmitri-medium',
      'ru_RU-denis-medium',
      'ru_RU-ruslan-medium',
      'en_US-amy-medium',
      'en_US-lessac-medium'
    ]);
    expect(BUILTIN_TTS_VOICES.filter((v) => v.language === 'ru')).toHaveLength(4);
    expect(BUILTIN_TTS_VOICES.filter((v) => v.language === 'en')).toHaveLength(2);
  });

  it('у каждого голоса sha256 из 64 hex-символов и положительный размер архива', () => {
    for (const voice of BUILTIN_TTS_VOICES) {
      expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice.sha256.length).toBe(64);
      expect(voice.archiveBytes).toBeGreaterThan(0);
      expect(Number.isInteger(voice.archiveBytes)).toBe(true);
      expect(voice.label.trim().length).toBeGreaterThan(0);
      expect(voice.modelFile).toBe(`${voice.id}.onnx`);
    }
  });

  it('архивы скачиваются из релизов sherpa-onnx', () => {
    for (const voice of BUILTIN_TTS_VOICES) {
      expect(voice.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/')).toBe(true);
      expect(voice.url.endsWith('.tar.bz2')).toBe(true);
      expect(voice.url).toContain(getArchiveRootDir(voice.id));
    }
  });

  it('идентификаторы уникальны и безопасны', () => {
    const ids = BUILTIN_TTS_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isValidVoiceId(id)).toBe(true);

    const hashes = BUILTIN_TTS_VOICES.map((v) => v.sha256);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('голоса по умолчанию есть в каталоге и совпадают по языку', () => {
    for (const [language, voiceId] of Object.entries(DEFAULT_VOICE_BY_LANGUAGE)) {
      const voice = getBuiltinVoice(voiceId);
      expect(voice).toBeDefined();
      expect(voice?.language).toBe(language);
    }
  });

  it('getBuiltinVoicesForLanguage фильтрует по языку', () => {
    const ru = getBuiltinVoicesForLanguage('ru');
    expect(ru).toHaveLength(4);
    expect(ru.every((v) => v.language === 'ru')).toBe(true);
    expect(ru.map((v) => v.id)).toContain('ru_RU-irina-medium');

    const en = getBuiltinVoicesForLanguage('en');
    expect(en).toHaveLength(2);
    expect(en.every((v) => v.language === 'en')).toBe(true);
    expect(en.map((v) => v.id)).toEqual(['en_US-amy-medium', 'en_US-lessac-medium']);
  });

  it('getBuiltinVoice возвращает undefined для неизвестного голоса', () => {
    expect(getBuiltinVoice('ru_RU-irina-medium')?.label).toBe('Ирина');
    expect(getBuiltinVoice('нет-такого')).toBeUndefined();
    expect(getBuiltinVoice('')).toBeUndefined();
  });
});

describe('ttsVoiceRegistry — isValidVoiceId как защита от обхода каталога (TASK-69)', () => {
  it('принимает обычные идентификаторы голосов', () => {
    for (const id of ['ru_RU-irina-medium', 'en_US-amy-medium', 'voice1', 'a', 'my.voice-2']) {
      expect(isValidVoiceId(id)).toBe(true);
    }
    expect(isValidVoiceId(`a${'b'.repeat(63)}`)).toBe(true); // ровно 64 символа
  });

  it('отвергает разделители пути и переход вверх', () => {
    for (const id of [
      '..',
      '../secrets',
      '..\\secrets',
      'voice/../other',
      'voice..id',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'C:\\Windows\\System32',
      './voice',
      'voice/',
      '%2e%2e'
    ]) {
      expect(isValidVoiceId(id), `должен быть отвергнут: ${id}`).toBe(false);
    }
  });

  it('отвергает пустую и слишком длинную строку', () => {
    expect(isValidVoiceId('')).toBe(false);
    expect(isValidVoiceId(' ')).toBe(false);
    expect(isValidVoiceId(`a${'b'.repeat(64)}`)).toBe(false); // 65 символов
    expect(isValidVoiceId('a'.repeat(200))).toBe(false);
  });

  it('отвергает строку, начинающуюся не с буквы или цифры', () => {
    for (const id of ['_voice', '-voice', '.voice', ' voice', '~voice']) {
      expect(isValidVoiceId(id), `должен быть отвергнут: ${id}`).toBe(false);
    }
  });

  it('отвергает пробелы, переводы строк и прочие небезопасные символы', () => {
    for (const id of ['voice id', 'voice\nid', 'voice\n', 'voice\u0000id', 'voice$', 'voice:1', 'голос']) {
      expect(isValidVoiceId(id), `должен быть отвергнут: ${JSON.stringify(id)}`).toBe(false);
    }
  });

  it('отвергает не-строки, не полагаясь на приведение типов', () => {
    expect(isValidVoiceId(null as unknown as string)).toBe(false);
    expect(isValidVoiceId(undefined as unknown as string)).toBe(false);
    expect(isValidVoiceId(123 as unknown as string)).toBe(false);
  });
});

describe('ttsVoiceRegistry — makeImportedVoiceId (TASK-69)', () => {
  it('отбрасывает расширение модели', () => {
    expect(makeImportedVoiceId('ru_RU-irina-medium.onnx')).toBe('ru_RU-irina-medium');
    expect(makeImportedVoiceId('ru_RU-irina-medium.onnx.json')).toBe('ru_RU-irina-medium');
    expect(makeImportedVoiceId('ru_RU-irina-medium.ONNX')).toBe('ru_RU-irina-medium');
  });

  it('из полного пути берёт только имя файла', () => {
    expect(makeImportedVoiceId('C:\\Users\\Prof\\Downloads\\ru_RU-denis-medium.onnx')).toBe('ru_RU-denis-medium');
    expect(makeImportedVoiceId('/home/user/voices/en_US-amy-medium.onnx')).toBe('en_US-amy-medium');
    expect(makeImportedVoiceId('../../etc/passwd.onnx')).toBe('passwd');
    expect(makeImportedVoiceId('..\\..\\secret.onnx')).toBe('secret');
  });

  it('небезопасные символы заменяются, повторные точки схлопываются', () => {
    expect(makeImportedVoiceId('my voice 2.onnx')).toBe('my-voice-2');
    expect(makeImportedVoiceId('a..b.onnx')).toBe('a.b');
    expect(makeImportedVoiceId('voice#1?.onnx')).toBe('voice-1-');
  });

  it('результат всегда проходит isValidVoiceId', () => {
    const names = [
      'ru_RU-irina-medium.onnx',
      'C:\\Users\\Prof\\Downloads\\мой голос.onnx',
      '../../etc/passwd.onnx',
      'голос.onnx',
      '   .onnx',
      '.onnx',
      '',
      '...',
      '/',
      '\\',
      '-_-.onnx',
      `${'x'.repeat(200)}.onnx`
    ];

    for (const name of names) {
      const id = makeImportedVoiceId(name);
      expect(isValidVoiceId(id), `небезопасный id из «${name}»: ${id}`).toBe(true);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });

  it('для имён без безопасных символов подставляет запасной идентификатор', () => {
    const id = makeImportedVoiceId('голос модели.onnx');
    expect(id.startsWith('voice-')).toBe(true);
    expect(isValidVoiceId(id)).toBe(true);
  });

  it('длинное имя обрезается до допустимой длины', () => {
    const id = makeImportedVoiceId(`${'x'.repeat(200)}.onnx`);
    expect(id.length).toBe(64);
    expect(isValidVoiceId(id)).toBe(true);
  });
});

describe('ttsVoiceRegistry — раскладка файлов голоса (TASK-69)', () => {
  it('голоса лежат в <models>/tts/<voiceId>', () => {
    expect(getTtsRootDir(MODELS_DIR)).toBe(`${MODELS_DIR}/tts`);
    expect(getVoiceDir(MODELS_DIR, 'ru_RU-irina-medium')).toBe(`${MODELS_DIR}/tts/ru_RU-irina-medium`);
  });

  it('getVoicePaths описывает все файлы установленного голоса', () => {
    const paths = getVoicePaths(MODELS_DIR, 'ru_RU-irina-medium');
    const dir = `${MODELS_DIR}/tts/ru_RU-irina-medium`;

    expect(paths.dir).toBe(dir);
    expect(paths.modelPath).toBe(`${dir}/ru_RU-irina-medium.onnx`);
    expect(paths.tokensPath).toBe(`${dir}/tokens.txt`);
    expect(paths.configPath).toBe(`${dir}/ru_RU-irina-medium.onnx.json`);
    expect(paths.manifestPath).toBe(`${dir}/${VOICE_MANIFEST_FILE}`);

    for (const p of [paths.dir, paths.modelPath, paths.tokensPath, paths.configPath, paths.manifestPath, paths.dataDir]) {
      expect(p.startsWith(`${MODELS_DIR}/tts/`)).toBe(true);
      expect(p).not.toContain('//');
      expect(p).not.toContain('..');
    }
  });

  it('учитывает собственное имя файла модели у импортированного голоса', () => {
    const paths = getVoicePaths(MODELS_DIR, 'imported-1', 'model.onnx');
    const dir = `${MODELS_DIR}/tts/imported-1`;

    expect(paths.modelPath).toBe(`${dir}/model.onnx`);
    expect(paths.configPath).toBe(`${dir}/model.onnx.json`);
    expect(paths.tokensPath).toBe(`${dir}/tokens.txt`);
  });

  it('espeak-ng-data общий и лежит рядом с голосами, а не внутри каталога голоса', () => {
    const shared = getSharedEspeakDataDir(MODELS_DIR);
    const irina = getVoicePaths(MODELS_DIR, 'ru_RU-irina-medium');
    const amy = getVoicePaths(MODELS_DIR, 'en_US-amy-medium');

    expect(shared).toBe(`${MODELS_DIR}/tts/espeak-ng-data`);
    expect(irina.dataDir).toBe(shared);
    expect(amy.dataDir).toBe(shared);
    expect(shared.startsWith(`${irina.dir}/`)).toBe(false);
    expect(shared.startsWith(`${amy.dir}/`)).toBe(false);
    expect(shared.startsWith(`${getTtsRootDir(MODELS_DIR)}/`)).toBe(true);
  });

  it('не плодит двойные слэши при каталоге со слэшем на конце', () => {
    expect(getVoiceDir('C:/models/', 'voice1')).toBe('C:/models/tts/voice1');
    expect(getSharedEspeakDataDir('C:/models/')).toBe('C:/models/tts/espeak-ng-data');
  });

  it('каталог внутри архива sherpa — vits-piper-<id>', () => {
    expect(getArchiveRootDir('ru_RU-irina-medium')).toBe('vits-piper-ru_RU-irina-medium');
  });
});
