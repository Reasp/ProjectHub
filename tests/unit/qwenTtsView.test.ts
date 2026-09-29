import { describe, expect, it } from 'vitest';

import {
  canProbeDraft,
  canSaveDraft,
  describeQwenStatus,
  draftProbeKey,
  formatGigabytes,
  installPercent,
  isValidQwenSeed,
  MAX_QWEN_INSTRUCT_CHARS,
  MAX_QWEN_LABEL_CHARS,
  MAX_QWEN_SEED,
  MIN_DESIGN_INSTRUCT_CHARS,
  missingQwenModels,
  QWEN_MODEL_BYTES,
  QWEN_RUNTIME_BYTES,
  qwenDownloadBytes,
  randomQwenSeed
} from '../../src/services/qwenTtsView';
import * as registry from '../../electron/services/qwenTtsRegistry';

const installed = { runtimeReady: true, models: { custom: true, design: true, base: true } };

describe('строка статуса Qwen3-TTS в настройках (TASK-104, AC#5)', () => {
  it('без окружения или без единой модели — «не установлен», даже если main сообщает ошибку', () => {
    expect(describeQwenStatus({ status: 'unloaded', install: { runtimeReady: false, models: {} } })).toEqual({ kind: 'not-installed' });
    // одной модели создания голосов для реплик недостаточно
    expect(describeQwenStatus({ status: 'unloaded', install: { runtimeReady: true, models: { design: true } } })).toEqual({
      kind: 'not-installed'
    });
    expect(describeQwenStatus({ status: 'unloaded', install: { runtimeReady: true, models: { base: true } } }).kind).toBe('idle');
    expect(
      describeQwenStatus({ status: 'unavailable', errorCode: 'qwen_not_installed', install: { runtimeReady: false } })
    ).toEqual({ kind: 'not-installed' });
  });

  it('модель в памяти: вид, время загрузки и видеопамять', () => {
    expect(describeQwenStatus({ status: 'ready', modelKind: 'custom', loadTimeMs: 7822, vramMb: 4456, install: installed })).toEqual({
      kind: 'ready',
      modelKind: 'custom',
      loadTimeSec: 7.8,
      vramGb: 4.5
    });
    expect(describeQwenStatus({ status: 'ready', modelKind: 'base', install: installed })).toMatchObject({
      kind: 'ready',
      modelKind: 'base'
    });
    expect(describeQwenStatus({ status: 'ready', modelKind: 'design', install: installed })).toEqual({
      kind: 'ready',
      modelKind: 'design',
      loadTimeSec: null,
      vramGb: null
    });
  });

  it('запуск, загрузка и простой различаются', () => {
    expect(describeQwenStatus({ status: 'starting', install: installed }).kind).toBe('starting');
    expect(describeQwenStatus({ status: 'loading', install: installed }).kind).toBe('loading');
    expect(describeQwenStatus({ status: 'unloaded', install: installed }).kind).toBe('idle');
    expect(describeQwenStatus(null).kind).toBe('idle');
  });

  it('причина ошибки и недоступности видна пользователю', () => {
    expect(describeQwenStatus({ status: 'error', errorCode: 'qwen_out_of_memory', error: 'CUDA OOM', install: installed })).toEqual({
      kind: 'error',
      errorCode: 'qwen_out_of_memory',
      error: 'CUDA OOM'
    });
    expect(describeQwenStatus({ status: 'unavailable', errorCode: 'qwen_sidecar_crashed', install: installed })).toMatchObject({
      kind: 'unavailable',
      errorCode: 'qwen_sidecar_crashed'
    });
    // ошибка без причины показывать нечего
    expect(describeQwenStatus({ status: 'error', install: installed }).kind).toBe('idle');
  });
});

describe('объём установки (TASK-104, AC#5: предупреждение о размере весов)', () => {
  it('объёмы повторяют манифест main-процесса', () => {
    expect(QWEN_RUNTIME_BYTES).toBe(registry.QWEN_MANIFEST.runtime.approxBytes);
    for (const kind of registry.QWEN_MODEL_KINDS) {
      expect(Math.abs(registry.qwenModelBytes(kind) - QWEN_MODEL_BYTES) / QWEN_MODEL_BYTES).toBeLessThan(0.01);
    }
  });

  it('качается только то, чего нет', () => {
    expect(missingQwenModels(null)).toEqual(['custom', 'design', 'base']);
    expect(missingQwenModels({ runtimeReady: true, models: { custom: true } })).toEqual(['design', 'base']);
    expect(missingQwenModels(installed)).toEqual([]);

    expect(qwenDownloadBytes(null, ['custom', 'design', 'base'])).toBe(QWEN_RUNTIME_BYTES + 3 * QWEN_MODEL_BYTES);
    expect(qwenDownloadBytes({ runtimeReady: true }, ['design'])).toBe(QWEN_MODEL_BYTES);
    expect(qwenDownloadBytes(installed, [])).toBe(0);
  });

  it('гигабайты округляются по-человечески', () => {
    expect(formatGigabytes(QWEN_RUNTIME_BYTES + 3 * QWEN_MODEL_BYTES)).toBe('19');
    expect(formatGigabytes(QWEN_MODEL_BYTES)).toBe('4.5');
    expect(formatGigabytes(0)).toBe('0.0');
  });

  it('процент есть только при загрузке весов', () => {
    expect(installPercent({ state: 'running', phase: 'models', overallReceived: 4_500, overallTotal: 9_000 })).toBe(50);
    expect(installPercent({ state: 'running', phase: 'models', overallReceived: 9_000, overallTotal: 9_000 })).toBe(100);
    expect(installPercent({ state: 'running', phase: 'models', overallReceived: 8_999, overallTotal: 9_000 })).toBe(99);
    expect(installPercent({ state: 'running', phase: 'models', overallReceived: 20_000, overallTotal: 9_000 })).toBe(100);
    expect(installPercent({ state: 'running', phase: 'torch', overallReceived: 1, overallTotal: 2 })).toBeNull();
    expect(installPercent({ state: 'running', phase: 'models', overallTotal: 0 })).toBeNull();
    expect(installPercent(null)).toBeNull();
  });
});

describe('голос по описанию: проба перед сохранением (TASK-104, AC#4)', () => {
  const draft = { label: 'Диктор', instruct: 'Спокойный женский голос, тёплый тембр', seed: 1234 };

  it('ограничения рендерера совпадают с проверкой main-процесса', () => {
    expect(MAX_QWEN_INSTRUCT_CHARS).toBe(registry.MAX_INSTRUCT_CHARS);
    expect(MAX_QWEN_LABEL_CHARS).toBe(registry.MAX_LABEL_CHARS);
    expect(MAX_QWEN_SEED).toBe(registry.MAX_SEED);
    const edge = 'x'.repeat(MIN_DESIGN_INSTRUCT_CHARS);
    expect(registry.validateDesignRecipe({ label: 'a', instruct: edge, seed: 1 }).ok).toBe(true);
    expect(registry.validateDesignRecipe({ label: 'a', instruct: edge.slice(1), seed: 1 }).ok).toBe(false);
    expect(canProbeDraft({ ...draft, instruct: edge })).toBe(true);
    expect(canProbeDraft({ ...draft, instruct: edge.slice(1) })).toBe(false);
  });

  it('на пробу уходит только осмысленный рецепт', () => {
    expect(canProbeDraft(draft)).toBe(true);
    expect(canProbeDraft({ ...draft, label: '' })).toBe(true);
    expect(canProbeDraft({ ...draft, instruct: '   коротко   ' })).toBe(false);
    expect(canProbeDraft({ ...draft, seed: -1 })).toBe(false);
    expect(canProbeDraft({ ...draft, seed: 1.5 })).toBe(false);
    expect(canProbeDraft({ ...draft, seed: Number.NaN })).toBe(false);
    expect(isValidQwenSeed(MAX_QWEN_SEED)).toBe(true);
    expect(isValidQwenSeed(MAX_QWEN_SEED + 1)).toBe(false);
  });

  it('сохранить можно только прослушанный рецепт', () => {
    expect(canSaveDraft(draft, null)).toBe(false);
    const probed = draftProbeKey(draft);
    expect(canSaveDraft(draft, probed)).toBe(true);
    // название на звук не влияет — его можно менять после пробы
    expect(canSaveDraft({ ...draft, label: 'Другое имя' }, probed)).toBe(true);
    expect(canSaveDraft({ ...draft, label: '   ' }, probed)).toBe(false);
  });

  it('смена описания или варианта после пробы требует новой пробы', () => {
    const probed = draftProbeKey(draft);
    expect(canSaveDraft({ ...draft, seed: 1235 }, probed)).toBe(false);
    expect(canSaveDraft({ ...draft, instruct: `${draft.instruct}, быстрый темп` }, probed)).toBe(false);
    // пробелы на звук не влияют: main нормализует описание так же
    expect(canSaveDraft({ ...draft, instruct: `  ${draft.instruct.replace(' ', '   ')}\n` }, probed)).toBe(true);
  });

  it('случайный вариант — целое число в допустимом диапазоне', () => {
    for (const r of [0, 0.5, 0.999999]) {
      const seed = randomQwenSeed(() => r);
      expect(isValidQwenSeed(seed)).toBe(true);
    }
    expect(randomQwenSeed(() => 0.25)).toBe(250_000);
  });
});
