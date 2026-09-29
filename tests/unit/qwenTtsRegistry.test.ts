import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QWEN_VOICE_ID,
  draftKey,
  evaluateQwenInstall,
  isValidDesignSlug,
  makeDesignSlug,
  makeQwenDesignVoiceId,
  makeQwenPresetVoiceId,
  MAX_INSTRUCT_CHARS,
  modelForVoice,
  normalizeInstruct,
  parseQwenVoiceId,
  QWEN_DRAFT_VOICE_ID,
  QWEN_MANIFEST,
  QWEN_MODEL_KINDS,
  QWEN_REFERENCE_TEXT,
  QWEN_SPEAKERS,
  qwenModelBytes,
  resolveVoiceEngine,
  validateDesignRecipe
} from '../../electron/services/qwenTtsRegistry';
import { BUILTIN_TTS_VOICES, isValidVoiceId, resolveImportedVoiceId } from '../../electron/services/ttsVoiceRegistry';

describe('голос знает свой движок (TASK-104, AC#1)', () => {
  it('идентификаторы Qwen уходят в сайдкар, остальные — в Piper', () => {
    expect(resolveVoiceEngine('qwen:custom:serena')).toBe('qwen');
    expect(resolveVoiceEngine('qwen:design:warm')).toBe('qwen');
    expect(resolveVoiceEngine('ru_RU-irina-medium')).toBe('piper');
    expect(resolveVoiceEngine('')).toBe('piper');
    expect(resolveVoiceEngine(undefined as unknown as string)).toBe('piper');
  });

  it('все встроенные голоса Piper остаются голосами Piper', () => {
    for (const voice of BUILTIN_TTS_VOICES) expect(resolveVoiceEngine(voice.id)).toBe('piper');
  });

  it('импортированный голос Piper не может получить идентификатор Qwen', () => {
    // двоеточие запрещено в идентификаторах Piper, поэтому пространства имён не пересекаются
    expect(isValidVoiceId('qwen:custom:serena')).toBe(false);
    expect(isValidVoiceId(DEFAULT_QWEN_VOICE_ID)).toBe(false);
    const imported = resolveImportedVoiceId('qwen:custom:serena.onnx');
    expect(resolveVoiceEngine(imported)).toBe('piper');
    expect(resolveVoiceEngine(resolveImportedVoiceId('qwen-voice.onnx'))).toBe('piper');
  });
});

describe('идентификаторы голосов Qwen', () => {
  it('пресеты — девять дикторов модели CustomVoice, русского среди них нет', () => {
    expect(QWEN_SPEAKERS).toHaveLength(9);
    expect(new Set(QWEN_SPEAKERS.map((s) => s.id)).size).toBe(9);
    expect(QWEN_SPEAKERS.some((s) => s.native === 'ru')).toBe(false);
    expect(parseQwenVoiceId(DEFAULT_QWEN_VOICE_ID)).toEqual({ kind: 'custom', speaker: 'serena' });
  });

  it('разбирает пресет, сохранённый голос и черновик', () => {
    expect(parseQwenVoiceId(makeQwenPresetVoiceId('uncle_fu'))).toEqual({ kind: 'custom', speaker: 'uncle_fu' });
    expect(parseQwenVoiceId(makeQwenDesignVoiceId('teplyy-golos'))).toEqual({ kind: 'design', slug: 'teplyy-golos' });
    expect(parseQwenVoiceId(QWEN_DRAFT_VOICE_ID)).toEqual({ kind: 'design', draft: true });
  });

  it('пресет звучит своей моделью, сохранённый голос — клоном эталона, черновик создаёт эталон', () => {
    const model = (id: string) => modelForVoice(parseQwenVoiceId(id)!);
    expect(model('qwen:custom:serena')).toBe('custom');
    expect(model('qwen:design:warm')).toBe('base');
    expect(model(QWEN_DRAFT_VOICE_ID)).toBe('design');
  });

  it('отвергает неизвестного диктора, чужой движок и попытку выйти из каталога рецептов', () => {
    expect(parseQwenVoiceId('qwen:custom:nobody')).toBeNull();
    expect(parseQwenVoiceId('ru_RU-irina-medium')).toBeNull();
    expect(parseQwenVoiceId('qwen:clone:x')).toBeNull();
    expect(parseQwenVoiceId('qwen:design:')).toBeNull();
    expect(parseQwenVoiceId('qwen:design:../../secrets')).toBeNull();
    expect(parseQwenVoiceId('qwen:design:a:b')).toBeNull();
    expect(parseQwenVoiceId('qwen:design:UPPER')).toBeNull();
    expect(isValidDesignSlug('..')).toBe(false);
    expect(isValidDesignSlug('a/b')).toBe(false);
    expect(isValidDesignSlug('@draft')).toBe(false);
  });
});

describe('рецепт «сконструированного» голоса (TASK-104, AC#4)', () => {
  it('имя файла строится из названия, кириллица транслитерируется', () => {
    expect(makeDesignSlug('Тёплый диктор')).toBe('teplyy-diktor');
    expect(makeDesignSlug('  Narrator #1  ')).toBe('narrator-1');
    expect(isValidDesignSlug(makeDesignSlug('Щука и ёж'))).toBe(true);
  });

  it('пустое или целиком недопустимое название получает запасное имя', () => {
    expect(makeDesignSlug('')).toBe('voice');
    expect(makeDesignSlug('★☆★')).toBe('voice');
    expect(makeDesignSlug('../..')).toBe('voice');
  });

  it('занятое имя получает числовой суффикс', () => {
    expect(makeDesignSlug('Диктор', ['diktor'])).toBe('diktor-2');
    expect(makeDesignSlug('Диктор', ['diktor', 'DIKTOR-2'])).toBe('diktor-3');
  });

  it('длинное название обрезается до допустимого имени файла', () => {
    const slug = makeDesignSlug('очень длинное название голоса '.repeat(5));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(isValidDesignSlug(slug)).toBe(true);
    expect(isValidDesignSlug(makeDesignSlug('x'.repeat(100), ['x'.repeat(40)]))).toBe(true);
  });

  it('принимает корректный рецепт и нормализует текст', () => {
    expect(
      validateDesignRecipe({ label: '  Диктор  ', instruct: 'Спокойный\nженский   голос, тёплый тембр', seed: 1234 })
    ).toEqual({ ok: true, label: 'Диктор', instruct: 'Спокойный женский голос, тёплый тембр', seed: 1234 });
  });

  it('называет поле, которое не прошло проверку', () => {
    const instruct = 'Спокойный женский голос';
    expect(validateDesignRecipe({ label: '', instruct, seed: 1 })).toEqual({ ok: false, field: 'label' });
    expect(validateDesignRecipe({ label: 'Голос', instruct: 'коротко', seed: 1 })).toEqual({ ok: false, field: 'instruct' });
    expect(validateDesignRecipe({ label: 'Голос', instruct, seed: -1 })).toEqual({ ok: false, field: 'seed' });
    expect(validateDesignRecipe({ label: 'Голос', instruct, seed: 1.5 })).toEqual({ ok: false, field: 'seed' });
    expect(validateDesignRecipe({ label: 'Голос', instruct, seed: '7' })).toEqual({ ok: false, field: 'seed' });
    expect(validateDesignRecipe({ label: 'Голос', instruct, seed: 2 ** 31 })).toEqual({ ok: false, field: 'seed' });
    expect(validateDesignRecipe({ label: 42, instruct, seed: 1 })).toEqual({ ok: false, field: 'label' });
  });

  it('ключ черновика не зависит от пробелов в описании, но различает описание и зерно', () => {
    const key = draftKey('Спокойный женский голос', 7);
    expect(draftKey('  Спокойный   женский\nголос ', 7)).toBe(key);
    expect(draftKey('Спокойный женский голос', 8)).not.toBe(key);
    expect(draftKey('Спокойный мужской голос', 7)).not.toBe(key);
  });

  it('текст эталона рассчитан на 7–10 секунд звука', () => {
    for (const text of Object.values(QWEN_REFERENCE_TEXT)) {
      expect(text.length).toBeGreaterThan(80);
      expect(text.length).toBeLessThan(240);
    }
  });

  it('инструкция ограничена по длине и очищена от управляющих символов', () => {
    expect(normalizeInstruct('a\u0000b\tc\u007fd')).toBe('a b c d');
    expect(normalizeInstruct('x'.repeat(1000))).toHaveLength(MAX_INSTRUCT_CHARS);
    expect(normalizeInstruct(undefined)).toBe('');
    expect(normalizeInstruct({})).toBe('');
  });
});

describe('состояние установки', () => {
  const record = { runtimeKey: 'abc', python: '3.11.15', torch: '2.11.0+cu128', gpu: 'RTX 2080' };
  const all = { custom: true, design: true, base: true };
  const none = { custom: false, design: false, base: false };

  it('установлено: окружение и модель, которой можно озвучивать', () => {
    expect(
      evaluateQwenInstall({ venvPythonExists: true, record, models: { custom: true, design: false, base: false } })
    ).toEqual({
      installed: true,
      runtimeReady: true,
      models: { custom: true, design: false, base: false },
      python: '3.11.15',
      torch: '2.11.0+cu128',
      gpu: 'RTX 2080'
    });
  });

  it('веса без окружения и окружение без весов установкой не считаются', () => {
    expect(evaluateQwenInstall({ venvPythonExists: false, record: null, models: all })).toMatchObject({
      installed: false,
      runtimeReady: false
    });
    expect(evaluateQwenInstall({ venvPythonExists: true, record, models: none })).toMatchObject({
      installed: false,
      runtimeReady: true
    });
  });

  it('одной модели создания голосов для реплик недостаточно', () => {
    expect(
      evaluateQwenInstall({ venvPythonExists: true, record, models: { ...none, design: true } }).installed
    ).toBe(false);
    expect(evaluateQwenInstall({ venvPythonExists: true, record, models: { ...none, base: true } }).installed).toBe(true);
  });

  it('окружение без записи установки или удалённое после установки не готово', () => {
    expect(evaluateQwenInstall({ venvPythonExists: true, record: null, models: all }).runtimeReady).toBe(false);
    expect(evaluateQwenInstall({ venvPythonExists: true, record: { runtimeKey: null }, models: all }).runtimeReady).toBe(false);
    expect(evaluateQwenInstall({ venvPythonExists: false, record, models: all }).runtimeReady).toBe(false);
  });
});

describe('манифест весов', () => {
  it('ревизии закреплены, у каждого файла есть размер и sha256', () => {
    expect(Object.keys(QWEN_MANIFEST.models).sort()).toEqual([...QWEN_MODEL_KINDS].sort());
    for (const kind of QWEN_MODEL_KINDS) {
      const model = QWEN_MANIFEST.models[kind];
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(model.files.length).toBeGreaterThan(5);
      for (const file of model.files) {
        expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
        expect(file.size, file.path).toBeGreaterThan(0);
      }
      expect(model.files.some((f) => f.path === 'config.json')).toBe(true);
      expect(qwenModelBytes(kind)).toBeGreaterThan(4_000_000_000);
    }
  });

  it('модели различаются весами, но делят кодек', () => {
    const weight = (kind: 'custom' | 'design' | 'base', path: string) =>
      QWEN_MANIFEST.models[kind].files.find((f) => f.path === path)!.sha256;
    expect(weight('custom', 'model.safetensors')).not.toBe(weight('design', 'model.safetensors'));
    expect(weight('base', 'model.safetensors')).not.toBe(weight('design', 'model.safetensors'));
    expect(weight('custom', 'speech_tokenizer/model.safetensors')).toBe(weight('design', 'speech_tokenizer/model.safetensors'));
    expect(weight('base', 'speech_tokenizer/model.safetensors')).toBe(weight('design', 'speech_tokenizer/model.safetensors'));
  });
});
