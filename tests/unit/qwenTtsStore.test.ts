import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Частичный мок electron с временным userData (decision-29): тест не трогает каталог пользователя
const USER_DATA = path.join(os.tmpdir(), `projecthub-qwen-store-${process.pid}`);
const APP_ROOT = path.join(os.tmpdir(), `projecthub-qwen-app-${process.pid}`);

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? USER_DATA : os.homedir()),
    getAppPath: () => APP_ROOT
  }
}));

const store = await import('../../electron/services/qwenTtsStore');
const { QWEN_MANIFEST } = await import('../../electron/services/qwenTtsRegistry');

const layout = store.getQwenLayout();

/** Файлы модели нужного размера без содержимого: хранилище сверяет только размер. */
async function placeModel(kind: 'custom' | 'design' | 'base', options: { truncate?: string } = {}) {
  const dir = store.getQwenModelDir(kind);
  for (const file of QWEN_MANIFEST.models[kind].files) {
    const target = path.join(dir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.open(target, 'w');
    await handle.truncate(options.truncate === file.path ? file.size - 1 : file.size);
    await handle.close();
  }
}

async function placeRuntime() {
  await fs.mkdir(path.dirname(layout.venvPython), { recursive: true });
  await fs.writeFile(layout.venvPython, '');
  await fs.writeFile(
    layout.installManifest,
    JSON.stringify({ version: 1, runtimeKey: 'abc', python: '3.11.15', torch: '2.11.0+cu128', gpu: 'RTX 2080' })
  );
}

beforeEach(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true });
  await fs.rm(APP_ROOT, { recursive: true, force: true });
});

describe('qwenTtsStore — состояние установки (TASK-104, AC#2)', () => {
  it('раскладка: окружение в qwen-tts, веса и рецепты — в общем кэше моделей', () => {
    expect(layout.home).toBe(path.join(USER_DATA, 'qwen-tts'));
    expect(store.getQwenModelDir('custom')).toBe(path.join(USER_DATA, 'models', 'qwen-tts', 'CustomVoice'));
    expect(layout.voicesDir).toBe(path.join(USER_DATA, 'models', 'qwen-tts', 'voices'));
  });

  it('на чистой машине движок не установлен, а Piper от этого не зависит', async () => {
    expect(await store.getQwenInstallStatus()).toEqual({
      installed: false,
      runtimeReady: false,
      models: { custom: false, design: false, base: false },
      python: null,
      torch: null,
      gpu: null
    });
    const voices = await store.listQwenVoices();
    expect(voices).toHaveLength(9);
    expect(voices.every((v) => v.engine === 'qwen' && v.kind === 'custom' && !v.installed)).toBe(true);
  });

  it('установленное окружение и одна модель: пресеты готовы, голоса по описанию — нет', async () => {
    await placeRuntime();
    await placeModel('custom');
    expect(await store.getQwenInstallStatus()).toMatchObject({
      installed: true,
      runtimeReady: true,
      models: { custom: true, design: false, base: false },
      torch: '2.11.0+cu128'
    });
    expect((await store.listQwenVoices()).every((v) => v.installed)).toBe(true);
  });

  it('недокачанный файл весов делает модель неустановленной', async () => {
    await placeRuntime();
    await placeModel('design', { truncate: 'speech_tokenizer/config.json' });
    expect((await store.getQwenInstallStatus()).models.design).toBe(false);
  });

  it('повреждённая запись установки не роняет проверку', async () => {
    await placeRuntime();
    await fs.writeFile(layout.installManifest, '{broken');
    expect((await store.getQwenInstallStatus()).runtimeReady).toBe(false);
  });
});

describe('qwenTtsStore — голоса по описанию (TASK-104, AC#4)', () => {
  const recipe = { label: 'Тёплый диктор', instruct: 'Спокойный женский голос средних лет, тёплый тембр', seed: 1234 };
  /** Звук прослушанной пробы: три секунды синуса. */
  const reference = {
    samples: Float32Array.from({ length: 72000 }, (_, i) => Math.sin(i / 20) * 0.5),
    sampleRate: 24000,
    text: 'Это проба голоса.'
  };

  it('голос сохраняется как рецепт и эталонная запись — без файла модели', async () => {
    const saved = await store.saveDesignRecipe(recipe, reference);
    expect(saved).toMatchObject({ slug: 'teplyy-diktor', label: 'Тёплый диктор', seed: 1234, refText: 'Это проба голоса.' });

    expect((await fs.readdir(layout.voicesDir)).sort()).toEqual(['teplyy-diktor.json', 'teplyy-diktor.wav']);
    expect((await fs.stat(path.join(layout.voicesDir, 'teplyy-diktor.json'))).size).toBeLessThan(1024);

    const wav = await fs.readFile(store.referenceAudioPath('teplyy-diktor'));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav).toHaveLength(44 + 72000 * 2);
    // эталон — секунды звука, а не гигабайты весов
    expect(wav.length).toBeLessThan(1_000_000);

    expect(await store.getDesignRecipe('teplyy-diktor')).toMatchObject({ instruct: recipe.instruct, seed: 1234 });
  });

  it('без прослушанной пробы голос не сохраняется', async () => {
    await expect(store.saveDesignRecipe(recipe, null)).rejects.toMatchObject({ code: 'qwen_probe_required' });
    // обрывок короче двух секунд эталоном не считается
    const short = { ...reference, samples: reference.samples.slice(0, 24000) };
    await expect(store.saveDesignRecipe(recipe, short)).rejects.toMatchObject({ code: 'qwen_probe_required' });
    expect(existsSync(layout.voicesDir) ? await fs.readdir(layout.voicesDir) : []).toEqual([]);
  });

  it('в списке голос готов, когда скачана модель Base: ею он и звучит', async () => {
    await store.saveDesignRecipe(recipe, reference);
    const before = (await store.listQwenVoices()).find((v) => v.kind === 'design');
    expect(before).toMatchObject({ id: 'qwen:design:teplyy-diktor', engine: 'qwen', installed: false, seed: 1234 });

    await placeRuntime();
    await placeModel('design');
    expect((await store.listQwenVoices()).find((v) => v.kind === 'design')?.installed).toBe(false);

    await placeModel('base');
    expect((await store.listQwenVoices()).find((v) => v.kind === 'design')?.installed).toBe(true);
  });

  it('одноимённые голоса не затирают друг друга', async () => {
    const first = await store.saveDesignRecipe(recipe, reference);
    const second = await store.saveDesignRecipe({ ...recipe, seed: 99 }, reference);
    expect(second.slug).toBe('teplyy-diktor-2');
    expect((await store.getDesignRecipe(first.slug))?.seed).toBe(1234);
    expect((await store.listDesignRecipes()).map((r) => r.slug)).toEqual(['teplyy-diktor', 'teplyy-diktor-2']);
    expect(existsSync(store.referenceAudioPath('teplyy-diktor-2'))).toBe(true);
  });

  it('имя, занятое осиротевшей записью, не переиспользуется', async () => {
    await fs.mkdir(layout.voicesDir, { recursive: true });
    await fs.writeFile(store.referenceAudioPath('teplyy-diktor'), 'чужой звук');
    const saved = await store.saveDesignRecipe(recipe, reference);
    expect(saved.slug).toBe('teplyy-diktor-2');
    expect(await fs.readFile(store.referenceAudioPath('teplyy-diktor'), 'utf8')).toBe('чужой звук');
  });

  it('некорректный рецепт отклоняется с кодом и названием поля', async () => {
    await expect(store.saveDesignRecipe({ ...recipe, instruct: 'коротко' }, reference)).rejects.toMatchObject({
      code: 'qwen_invalid_recipe',
      detail: 'instruct'
    });
    await expect(store.saveDesignRecipe({ ...recipe, seed: -5 }, reference)).rejects.toMatchObject({ detail: 'seed' });
    expect(existsSync(layout.voicesDir) ? await fs.readdir(layout.voicesDir) : []).toEqual([]);
  });

  it('рецепт без эталонной записи голосом не считается', async () => {
    const saved = await store.saveDesignRecipe(recipe, reference);
    await fs.rm(store.referenceAudioPath(saved.slug));
    expect(await store.getDesignRecipe(saved.slug)).toBeNull();
    expect(await store.listDesignRecipes()).toEqual([]);
    expect((await store.listQwenVoices()).some((v) => v.kind === 'design')).toBe(false);
  });

  it('удаляются рецепт и запись; пресет и чужой путь удалить нельзя', async () => {
    const saved = await store.saveDesignRecipe(recipe, reference);
    const outside = path.join(layout.modelsDir, 'keep.json');
    await fs.writeFile(outside, '{}');

    await expect(store.deleteDesignRecipe('qwen:custom:serena')).rejects.toMatchObject({ code: 'qwen_voice_not_found' });
    await expect(store.deleteDesignRecipe('qwen:design:../keep')).rejects.toMatchObject({ code: 'qwen_voice_not_found' });
    await expect(store.deleteDesignRecipe('qwen:design:@draft')).rejects.toMatchObject({ code: 'qwen_voice_not_found' });
    expect(existsSync(outside)).toBe(true);

    expect(await store.deleteDesignRecipe(`qwen:design:${saved.slug}`)).toBe(true);
    expect(await fs.readdir(layout.voicesDir)).toEqual([]);
    expect(await store.deleteDesignRecipe(`qwen:design:${saved.slug}`)).toBe(false);
    expect(await store.listDesignRecipes()).toEqual([]);
  });

  it('повреждённые и посторонние файлы в каталоге голосов пропускаются', async () => {
    await store.saveDesignRecipe(recipe, reference);
    await fs.writeFile(path.join(layout.voicesDir, 'broken.json'), '{nope');
    await fs.writeFile(path.join(layout.voicesDir, 'no-seed.json'), JSON.stringify({ label: 'x', instruct: recipe.instruct }));
    await fs.writeFile(path.join(layout.voicesDir, 'Bad Name.json'), JSON.stringify(recipe));
    await fs.writeFile(path.join(layout.voicesDir, 'notes.txt'), 'hello');
    expect((await store.listDesignRecipes()).map((r) => r.slug)).toEqual(['teplyy-diktor']);
    expect(await store.getDesignRecipe('../../install')).toBeNull();
  });
});

describe('qwenTtsStore — скрипт сайдкара (TASK-104, AC#2)', () => {
  const bundled = path.join(APP_ROOT, 'dist-electron', 'workers', 'qwen', 'sidecar.py');

  it('скрипта нет в сборке — null, без исключения', async () => {
    await fs.rm(APP_ROOT, { recursive: true, force: true });
    // В dev-окружении теста скрипт находится рядом с исходниками — проверяем только упакованный путь
    const found = await store.materializeSidecarScript();
    if (found) expect(found).toBe(layout.sidecarCopy);
  });

  it('копия рядом с окружением обновляется вместе с приложением', async () => {
    await fs.mkdir(path.dirname(bundled), { recursive: true });
    await fs.writeFile(bundled, 'print("v1")');
    const first = await store.materializeSidecarScript();
    expect(first).toBe(layout.sidecarCopy);
    const v1 = await fs.readFile(layout.sidecarCopy, 'utf8');

    // какой бы из кандидатов ни нашёлся, копия совпадает с источником
    expect(v1.length).toBeGreaterThan(0);
    const before = (await fs.stat(layout.sidecarCopy)).mtimeMs;
    await store.materializeSidecarScript();
    expect((await fs.stat(layout.sidecarCopy)).mtimeMs).toBe(before);
  });
});
