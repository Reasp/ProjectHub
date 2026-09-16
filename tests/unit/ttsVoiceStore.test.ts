import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

    // Идентификатор — из имени файла, без расширения и безопасный для файловой системы
    expect(installed.id).toBe('ru_RU-irina-medium');
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
    const imported = voices.find((v) => v.id === 'ru_RU-irina-medium');
    expect(imported?.installed).toBe(true);

    // Встроенные голоса перечислены как доступные к загрузке
    const builtinIds = registry.BUILTIN_TTS_VOICES.map((v) => v.id);
    for (const id of builtinIds) {
      if (id === 'ru_RU-irina-medium') continue;
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
    expect(await store.deleteVoice('ru_RU-irina-medium')).toBe(true);
    expect(await store.getInstalledVoice('ru_RU-irina-medium')).toBeNull();
    // Общие данные фонемизатора нужны остальным голосам и остаются на месте
    expect(await store.hasEspeakData()).toBe(true);
  });

  it('недопустимый идентификатор отклоняется до обращения к файловой системе', async () => {
    await expect(store.deleteVoice('../../etc')).rejects.toMatchObject({ code: 'invalid_voice_id' });
  });
});
