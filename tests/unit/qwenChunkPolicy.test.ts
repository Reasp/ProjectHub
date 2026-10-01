import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QWEN_CHUNK_SIZE,
  nextQwenChunkSize,
  QWEN_CHUNK_SIZES,
  QWEN_FRAME_SEC,
  qwenSynthTimeoutMs,
  steadyGenerationRate
} from '../../electron/services/qwenChunkPolicy';
import { planChunkStart, SCHEDULING_LEAD_SEC } from '../../src/services/ttsPlayer';

describe('скорость генерации Qwen3-TTS (TASK-104, замеры decision-64)', () => {
  it('считается по звуку после первого чанка: ожидание первого чанка в неё не входит', () => {
    // замер 2026-09-28, чанк 8, видеокарта занята игрой: 7.42 с на 7.12 с звука, первый звук 0.79 с
    const rate = steadyGenerationRate({ genMs: 7420, firstChunkMs: 790, audioSec: 7.12, chunks: 12 }, 8);
    expect(rate).toBeCloseTo(6.63 / 6.48, 3);
    expect(rate!).toBeGreaterThan(1);
  });

  it('тот же текст чанком 12 укладывается в реальное время', () => {
    const rate = steadyGenerationRate({ genMs: 6720, firstChunkMs: 1070, audioSec: 6.72, chunks: 7 }, 12);
    expect(rate!).toBeLessThan(1);
    expect(rate!).toBeGreaterThan(0.95);
  });

  it('короткий фрагмент скорость не показывает', () => {
    expect(steadyGenerationRate({ genMs: 1120, firstChunkMs: 770, audioSec: 0.96, chunks: 2 }, 8)).toBeNull();
    expect(steadyGenerationRate({ genMs: 1500, firstChunkMs: 770, audioSec: 1.5, chunks: 3 }, 8)).toBeNull();
    expect(steadyGenerationRate({ genMs: 900, firstChunkMs: null, audioSec: 0, chunks: 0 }, 8)).toBeNull();
  });

  it('кадр кодека — 80 мс: чанк 8 даёт 0.64 с звука', () => {
    expect(8 * QWEN_FRAME_SEC).toBeCloseTo(0.64, 6);
  });
});

describe('размер чанка следует за скоростью', () => {
  it('генерация отстаёт от воспроизведения — чанк растёт', () => {
    expect(nextQwenChunkSize(8, 1.05)).toBe(12);
    expect(nextQwenChunkSize(12, 1.02)).toBe(16);
    expect(nextQwenChunkSize(16, 1.3)).toBe(16);
  });

  it('есть запас — чанк уменьшается ради быстрого первого звука', () => {
    expect(nextQwenChunkSize(16, 0.8)).toBe(12);
    expect(nextQwenChunkSize(12, 0.85)).toBe(8);
    expect(nextQwenChunkSize(8, 0.5)).toBe(8);
  });

  it('между порогами размер не меняется', () => {
    for (const rate of [0.88, 0.9, 0.94, 0.98, 0.99]) {
      for (const size of QWEN_CHUNK_SIZES) expect(nextQwenChunkSize(size, rate)).toBe(size);
    }
  });

  it('шаг размера не вызывает переключения туда-обратно', () => {
    // увеличение чанка ускоряет генерацию примерно на 5%: после шага вверх скорость не падает ниже порога шага вниз
    const before = 1.0;
    const up = nextQwenChunkSize(8, before);
    expect(up).toBe(12);
    expect(nextQwenChunkSize(up, before * 0.95)).toBe(12);
  });

  it('без измерения и с мусором на входе размер сохраняется, неизвестный — сбрасывается', () => {
    expect(nextQwenChunkSize(12, null)).toBe(12);
    expect(nextQwenChunkSize(12, Number.NaN)).toBe(12);
    expect(nextQwenChunkSize(12, Number.POSITIVE_INFINITY)).toBe(12);
    expect(nextQwenChunkSize(7, 0.9)).toBe(DEFAULT_QWEN_CHUNK_SIZE);
  });
});

describe('таймаут синтеза фрагмента растёт с длиной (TASK-116, AC #4)', () => {
  it('фрагмент в 240 символов получает прежние 90 с, в 600 — 180 с', () => {
    expect(qwenSynthTimeoutMs(240, 30_000, 250)).toBe(90_000);
    expect(qwenSynthTimeoutMs(600, 30_000, 250)).toBe(180_000);
  });

  it('длинный фрагмент получает больше времени, чем короткий', () => {
    expect(qwenSynthTimeoutMs(500, 30_000, 250)).toBeGreaterThan(qwenSynthTimeoutMs(50, 30_000, 250));
  });

  it('мусор на входе даёт базовый запас, а не NaN', () => {
    expect(qwenSynthTimeoutMs(Number.NaN, 30_000, 250)).toBe(30_000);
    expect(qwenSynthTimeoutMs(-5, 30_000, 250)).toBe(30_000);
    expect(qwenSynthTimeoutMs(100, 30_000, -1)).toBe(30_000);
  });
});

describe('плеер: пополнение буфера при разрыве', () => {
  it('чанки ставятся встык, пока очередь не опустела', () => {
    expect(planChunkStart(1.0, 1.5, 3, 0.25)).toBe(1.5);
    expect(planChunkStart(1.0, 1.5, 3)).toBe(1.5);
  });

  it('первый чанк задания начинается сразу: пауза до первого звука и так заметна', () => {
    expect(planChunkStart(2.0, 0, 0, 0.25)).toBeCloseTo(2.0 + SCHEDULING_LEAD_SEC, 6);
  });

  it('очередь опустела посреди задания — одна пауза на пополнение вместо микропауз', () => {
    expect(planChunkStart(2.0, 1.98, 5, 0.25)).toBeCloseTo(2.25, 6);
    // после пополнения следующий чанк снова встык
    expect(planChunkStart(2.2, 2.25 + 0.64, 6, 0.25)).toBeCloseTo(2.89, 6);
  });

  it('без заданной паузы поведение прежнее — так звучит Piper', () => {
    expect(planChunkStart(2.0, 1.98, 5)).toBeCloseTo(2.0 + SCHEDULING_LEAD_SEC, 6);
    expect(planChunkStart(2.0, 1.98, 5, 0)).toBeCloseTo(2.0 + SCHEDULING_LEAD_SEC, 6);
  });

  it('запаса хватает на несколько секунд речи при отставании 4%', () => {
    // чанк 0.64 с генерируется 0.666 с: без пополнения разрыв на каждом стыке, с ним — раз в ~9 чанков
    let now = 0;
    let next = 0;
    let gaps = 0;
    for (let i = 0; i < 40; i += 1) {
      now += 0.666;
      const start = planChunkStart(now, next, i, 0.25);
      if (i > 0 && start > next + 1e-9) gaps += 1;
      next = start + 0.64;
    }
    expect(gaps).toBeLessThanOrEqual(5);

    now = 0;
    next = 0;
    let gapsWithout = 0;
    for (let i = 0; i < 40; i += 1) {
      now += 0.666;
      const start = planChunkStart(now, next, i);
      if (i > 0 && start > next + 1e-9) gapsWithout += 1;
      next = start + 0.64;
    }
    expect(gapsWithout).toBeGreaterThan(30);
  });
});
