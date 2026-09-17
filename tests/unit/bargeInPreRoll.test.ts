import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BARGE_IN_PRE_ROLL,
  captureMutedChunk,
  createBargeInPreRoll,
  markBargeIn,
  resetBargeInPreRoll,
  takeBargeInSeed,
  type BargeInPreRollOptions
} from '../../src/services/bargeInPreRoll';
import { DEFAULT_BARGE_IN, createBargeInState, feedBargeIn } from '../../src/services/bargeInDetector';

/** Чанк захвата после ресемплинга: 85 мс при 16 кГц, как на живых замерах. */
const CHUNK_MS = 85;
const CHUNK_SAMPLES = Math.round((CHUNK_MS / 1000) * 16000);
const chunk = (marker: number) => new Float32Array(CHUNK_SAMPLES).fill(marker);
const markers = (chunks: Float32Array[]) => chunks.map((c) => c[0]);

describe('bargeInPreRoll — звук перебивания для распознавания (TASK-95)', () => {
  it('кольцо во время озвучки держит последние ~1,2 с и копирует данные', () => {
    const state = createBargeInPreRoll();
    const reused = new Float32Array(CHUNK_SAMPLES);
    for (let i = 0; i < 30; i++) {
      reused.fill(i);
      captureMutedChunk(state, reused, i * CHUNK_MS, 0.01);
    }
    const limit = (DEFAULT_BARGE_IN_PRE_ROLL.ringMs / 1000) * 16000;
    expect(state.ringSamples).toBeGreaterThanOrEqual(limit - CHUNK_SAMPLES);
    expect(state.ringSamples).toBeLessThan(limit + CHUNK_SAMPLES);
    // Буфер захвата переиспользуется: в кольце — копии, а не 30 ссылок на последний чанк
    expect(state.ring.at(-1)!.samples[0]).toBe(29);
    expect(state.ring[0].samples[0]).toBe(30 - state.ring.length);
  });

  it('семя начинается за leadMs до первого громкого чанка серии, а не со всего кольца', () => {
    const state = createBargeInPreRoll();
    // 0–9: хвост озвучки, 10+: речь пользователя; серия началась на чанке 10
    for (let i = 0; i < 14; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, i >= 10 ? 0.2 : 0.01);
    markBargeIn(state, 10 * CHUNK_MS);

    const seed = takeBargeInSeed(state);
    // leadMs 300 = три с половиной чанка по 85 мс: берутся чанки 7, 8, 9 (at ≥ 850 − 300 = 550)
    expect(markers(seed!.chunks)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(seed!.startedAt).toBe(7 * CHUNK_MS);
    expect(seed!.rms).toEqual([0.01, 0.01, 0.01, 0.2, 0.2, 0.2, 0.2]);
    expect(seed!.samples).toBe(7 * CHUNK_SAMPLES);
  });

  it('пока озвучка останавливается, чанки дописываются к семени без вытеснения', () => {
    const state = createBargeInPreRoll();
    for (let i = 0; i < 6; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, 0.2);
    markBargeIn(state, 0);
    // Остановка затянулась на 2 с — больше кольца, но начало фразы не должно вытесниться
    for (let i = 6; i < 30; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, 0.2);

    const seed = takeBargeInSeed(state)!;
    expect(markers(seed.chunks)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('потолок семени ограничивает зависшую остановку', () => {
    const options: BargeInPreRollOptions = { ...DEFAULT_BARGE_IN_PRE_ROLL, maxSeedMs: 500 };
    const state = createBargeInPreRoll();
    captureMutedChunk(state, chunk(0), 0, 0.2, options);
    markBargeIn(state, 0, options);
    for (let i = 1; i < 50; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, 0.2, options);
    expect(takeBargeInSeed(state)!.samples).toBeLessThanOrEqual(8000);
  });

  it('без перебивания семени нет; выдача и сброс очищают состояние', () => {
    const state = createBargeInPreRoll();
    for (let i = 0; i < 5; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, 0.2);
    expect(takeBargeInSeed(state)).toBeNull();
    expect(state.ring).toHaveLength(0);

    captureMutedChunk(state, chunk(1), 0, 0.2);
    markBargeIn(state, 0);
    expect(takeBargeInSeed(state)).not.toBeNull();
    expect(takeBargeInSeed(state)).toBeNull();

    captureMutedChunk(state, chunk(1), 0, 0.2);
    markBargeIn(state, 0);
    resetBargeInPreRoll(state);
    expect(takeBargeInSeed(state)).toBeNull();
  });

  it('повторный markBargeIn не теряет накопленное семя', () => {
    const state = createBargeInPreRoll();
    for (let i = 0; i < 4; i++) captureMutedChunk(state, chunk(i), i * CHUNK_MS, 0.2);
    markBargeIn(state, 0);
    captureMutedChunk(state, chunk(4), 4 * CHUNK_MS, 0.2);
    markBargeIn(state, 4 * CHUNK_MS);
    expect(markers(takeBargeInSeed(state)!.chunks)).toEqual([0, 1, 2, 3, 4]);
  });

  it('связка с детектором: «Хватит, проверь тесты» — семя содержит слова до срабатывания', () => {
    const detector = createBargeInState();
    const state = createBargeInPreRoll();
    // Ряд RMS: озвучка (эхо не слышно), затем «Хва-тит» с паузой между слогами и продолжение
    const series = [0.005, 0.006, 0.004, 0.005, 0.15, 0.02, 0.18, 0.2, 0.12, 0.17, 0.19];
    let triggeredAt = -1;
    series.forEach((rms, i) => {
      const at = 1000 + i * CHUNK_MS;
      captureMutedChunk(state, chunk(i), at, rms);
      if (feedBargeIn(detector, rms, at, { ...DEFAULT_BARGE_IN, threshold: 0.08 })) {
        triggeredAt = i;
        markBargeIn(state, detector.since);
      }
    });

    expect(triggeredAt).toBeGreaterThan(4);
    const seed = takeBargeInSeed(state)!;
    // Первый громкий чанк (4) и всё после него — в семени, вместе с запасом перед ним
    expect(markers(seed.chunks)).toContain(4);
    expect(markers(seed.chunks).at(-1)).toBe(series.length - 1);
    expect(markers(seed.chunks)[0]).toBeLessThan(4);
  });
});
