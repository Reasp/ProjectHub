import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Частичный мок electron с временным userData (decision-29): хранилище голосов пишет модели
// в `<userData>/models/tts`, и тест не должен трогать реальный каталог пользователя.
const USER_DATA = path.join(os.tmpdir(), `projecthub-tts-store-${process.pid}`);

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? USER_DATA : os.homedir()),
    getAppPath: () => path.join(os.tmpdir(), 'projecthub-test-app.asar')
  }
}));

const store = await import('../../electron/services/ttsVoiceStore');
const registry = await import('../../electron/services/ttsVoiceRegistry');
const { onnxHasPiperMetadata } = await import('../../electron/services/piperVoiceConfig');

/** Конфиг голоса Piper в том виде, в каком он лежит на Hugging Face (без phoneme_type). */
const PIPER_CONFIG = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'ru' },
  inference: { noise_scale: 0.667, length_scale: 1.1, noise_w: 0.8 },
  phoneme_id_map: { _: [0], '^': [1], $: [2], ' ': [3], а: [7], б: [5] },
  num_speakers: 1,
  language: { name_english: 'Russian', code: 'ru_RU' }
};

/** Заглушка модели: importVoiceFromFiles не разбирает содержимое .onnx, только дописывает metadata. */
const FAKE_ONNX = Buffer.from('fake-onnx-model-payload', 'utf8');

const sourceDir = path.join(USER_DATA, 'source');
const modelSource = path.join(sourceDir, 'ru_RU-irina-medium.onnx');
const configSource = path.join(sourceDir, 'ru_RU-irina-medium.onnx.json');

async function writeSourceFiles() {
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(modelSource, FAKE_ONNX);
  await fs.writeFile(configSource, JSON.stringify(PIPER_CONFIG), 'utf8');
}

describe('ttsVoiceStore — импорт пользовательского голоса (TASK-69)', () => {
  beforeAll(async () => {
    await fs.rm(USER_DATA, { recursive: true, force: true });
    await writeSourceFiles();
  });

  it('без espeak-ng-data импорт отклоняется с понятным кодом', async () => {
    await expect(store.importVoiceFromFiles(modelSource, configSource)).rejects.toMatchObject({
      code: 'espeak_data_missing'
    });
  });

  it('импортирует голос: дописывает metadata, строит tokens.txt и манифест', async () => {
    // espeak-ng-data кладётся один раз рядом с голосами и общий для всех
    const espeakDir = registry.getSharedEspeakDataDir(path.join(USER_DATA, 'models'));
    await fs.mkdir(espeakDir, { recursive: true });
    await fs.writeFile(path.join(espeakDir, 'phontab'), 'stub', 'utf8');
    expect(await store.hasEspeakData()).toBe(true);

    const installed = await store.importVoiceFromFiles(modelSource, configSource);

    // Идентификатор — из имени файла, но не совпадает со встроенной Ириной (TASK-93)
    expect(installed.id).toBe('custom-ru_RU-irina-medium');
    expect(registry.isValidVoiceId(installed.id)).toBe(true);
    expect(installed.source).toBe('imported');
    expect(installed.language).toBe('ru');
    expect(installed.sampleRate).toBe(22050);
    expect(installed.lengthScale).toBe(1.1);
    // espeak-ng-data общий, а не внутри каталога голоса
    expect(installed.dataDir).toBe(espeakDir);

    // Модель скопирована и дополнена metadata, которой требует sherpa
    const written = await fs.readFile(installed.modelPath);
    expect(written.subarray(0, FAKE_ONNX.length).equals(FAKE_ONNX)).toBe(true);
    expect(written.length).toBeGreaterThan(FAKE_ONNX.length);
    expect(onnxHasPiperMetadata(new Uint8Array(written))).toBe(true);
    const asText = written.toString('latin1');
    expect(asText).toContain('sample_rate');
    expect(asText).toContain('22050');
    expect(asText).toContain('piper');

    // tokens.txt построен из phoneme_id_map и отсортирован по id
    const tokens = await fs.readFile(installed.tokensPath, 'utf8');
    const ids = tokens
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => Number(line.slice(line.lastIndexOf(' ') + 1)));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(tokens).toContain('а 7');

    // Манифест позволяет найти установленный голос после перезапуска
    const found = await store.getInstalledVoice(installed.id);
    expect(found?.modelPath).toBe(installed.modelPath);
    expect(found?.numSpeakers).toBe(1);
  });

  it('импортированный голос попадает в список рядом со встроенными', async () => {
    const voices = await store.listVoices();
    const imported = voices.find((v) => v.id === 'custom-ru_RU-irina-medium');
    expect(imported?.installed).toBe(true);
    expect(imported?.source).toBe('imported');

    // Встроенные голоса перечислены как доступные к загрузке
    const builtinIds = registry.BUILTIN_TTS_VOICES.map((v) => v.id);
    for (const id of builtinIds) {
      const item = voices.find((v) => v.id === id);
      expect(item, `голос ${id} отсутствует в списке`).toBeDefined();
      expect(item?.installed).toBe(false);
      expect(item?.archiveBytes).toBeGreaterThan(0);
    }
  });

  it('битый конфиг отклоняется с кодом разбора, а не падением', async () => {
    const brokenConfig = path.join(sourceDir, 'broken.onnx.json');
    await fs.writeFile(brokenConfig, '{ not json', 'utf8');
    await expect(store.importVoiceFromFiles(modelSource, brokenConfig)).rejects.toMatchObject({
      code: 'invalid_json'
    });

    const noVoiceConfig = path.join(sourceDir, 'no-espeak.onnx.json');
    await fs.writeFile(noVoiceConfig, JSON.stringify({ ...PIPER_CONFIG, espeak: {} }), 'utf8');
    await expect(store.importVoiceFromFiles(modelSource, noVoiceConfig)).rejects.toMatchObject({
      code: 'missing_espeak_voice'
    });
  });

  it('удаление голоса не трогает общий espeak-ng-data', async () => {
    expect(await store.deleteVoice('custom-ru_RU-irina-medium')).toBe(true);
    expect(await store.getInstalledVoice('custom-ru_RU-irina-medium')).toBeNull();
    // Общие данные фонемизатора нужны остальным голосам и остаются на месте
    expect(await store.hasEspeakData()).toBe(true);
  });

  it('недопустимый идентификатор отклоняется до обращения к файловой системе', async () => {
    await expect(store.deleteVoice('../../etc')).rejects.toMatchObject({ code: 'invalid_voice_id' });
  });
});

describe('ttsVoiceStore — импорт не трогает установленные голоса (TASK-93)', () => {
  const models = path.join(USER_DATA, 'models');
  const builtinId = 'ru_RU-irina-medium';

  /** Установленная встроенная Ирина: так её раскладывает downloadBuiltinVoice. */
  async function installFakeBuiltin(): Promise<string> {
    const paths = registry.getVoicePaths(models, builtinId, `${builtinId}.onnx`);
    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.modelPath, 'builtin-model', 'utf8');
    await fs.writeFile(paths.tokensPath, 'a 1\n', 'utf8');
    const manifest = { id: builtinId, label: 'Ирина', language: 'ru', source: 'builtin', modelPath: paths.modelPath, tokensPath: paths.tokensPath };
    await fs.writeFile(paths.manifestPath, JSON.stringify(manifest), 'utf8');
    return paths.modelPath;
  }

  async function ttsEntries(): Promise<string[]> {
    return (await fs.readdir(registry.getTtsRootDir(models))).sort();
  }

  beforeAll(async () => {
    await fs.rm(USER_DATA, { recursive: true, force: true });
    await writeSourceFiles();
    const espeakDir = registry.getSharedEspeakDataDir(models);
    await fs.mkdir(espeakDir, { recursive: true });
    await fs.writeFile(path.join(espeakDir, 'phontab'), 'stub', 'utf8');
  });

  it('неудачная проба: откат удаляет только файлы импорта, встроенный голос цел', async () => {
    const builtinModel = await installFakeBuiltin();
    const before = await ttsEntries();

    const staged = await store.stageVoiceImport(modelSource, configSource);
    // До переноса голос лежит во временном каталоге и в списке не виден
    expect(staged.voice.id).toBe('custom-ru_RU-irina-medium');
    expect(staged.voice.modelPath).toContain('.custom-ru_RU-irina-medium.import');
    expect(existsSync(staged.voice.modelPath)).toBe(true);
    expect(existsSync(staged.voice.tokensPath)).toBe(true);
    expect((await store.listVoices()).some((v) => v.id === staged.voice.id)).toBe(false);

    // Проба отвергла модель — откат
    await staged.discard();

    expect(await ttsEntries()).toEqual(before);
    expect(await fs.readFile(builtinModel, 'utf8')).toBe('builtin-model');
    expect((await store.getInstalledVoice(builtinId))?.source).toBe('builtin');
  });

  it('успешный импорт переносит голос на место под своим id, встроенный голос не меняется', async () => {
    const builtinModel = await installFakeBuiltin();

    const staged = await store.stageVoiceImport(modelSource, configSource);
    const installed = await staged.commit();
    await staged.discard(); // после commit — ничего не делает

    expect(installed.id).toBe('custom-ru_RU-irina-medium');
    expect(existsSync(installed.modelPath)).toBe(true);
    expect(installed.modelPath).not.toContain('.import');
    const found = await store.getInstalledVoice(installed.id);
    expect(found?.modelPath).toBe(installed.modelPath);
    expect(found?.source).toBe('imported');

    expect(await fs.readFile(builtinModel, 'utf8')).toBe('builtin-model');
    const voices = await store.listVoices();
    expect(voices.find((v) => v.id === builtinId)?.source).toBe('builtin');
    expect((await ttsEntries()).some((name) => name.endsWith('.import'))).toBe(false);
  });

  it('повторный импорт того же файла не перезаписывает прошлый импорт', async () => {
    const first = await store.getInstalledVoice('custom-ru_RU-irina-medium');
    expect(first).not.toBeNull();
    const firstBytes = await fs.readFile(first!.modelPath);

    const staged = await store.stageVoiceImport(modelSource, configSource);
    expect(staged.voice.id).toBe('custom-ru_RU-irina-medium-2');
    await staged.discard();

    // Откат второго импорта не задел первый
    expect((await fs.readFile(first!.modelPath)).equals(firstBytes)).toBe(true);
    expect(await store.getInstalledVoice('custom-ru_RU-irina-medium-2')).toBeNull();
  });

  it('параллельные импорты одного файла получают разные id', async () => {
    const [a, b] = await Promise.all([
      store.stageVoiceImport(modelSource, configSource),
      store.stageVoiceImport(modelSource, configSource)
    ]);
    try {
      expect(a.voice.id).not.toBe(b.voice.id);
      // Staging одного импорта переживает запуск другого: он не считается мусором
      expect(existsSync(a.voice.modelPath)).toBe(true);
      expect(existsSync(b.voice.modelPath)).toBe(true);
    } finally {
      await a.discard();
      await b.discard();
    }
  });

  it('ошибка разбора конфига не оставляет временных каталогов', async () => {
    const brokenConfig = path.join(sourceDir, 'broken2.onnx.json');
    await fs.writeFile(brokenConfig, '{ not json', 'utf8');
    await expect(store.stageVoiceImport(modelSource, brokenConfig)).rejects.toMatchObject({ code: 'invalid_json' });
    expect((await ttsEntries()).some((name) => name.startsWith('.'))).toBe(false);
  });
});
