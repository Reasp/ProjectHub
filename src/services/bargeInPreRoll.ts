/**
 * Звук перебивания для распознавания (TASK-95).
 *
 * Barge-in (`bargeInDetector`) срабатывает внутри гейта `ttsMuted`: пока приложение говорит, фраза
 * VAD не копится, и чанки, по которым детектор признал перебивание, раньше уходили только на
 * детекцию. Остановка озвучки асинхронная (отмена генерации в main, остановка плеера), а после
 * снятия гейта VAD начинал фразу с нуля — в Whisper попадал только хвост: «…проверь тесты» вместо
 * «Хватит, проверь тесты».
 *
 * Модуль держит этот звук:
 * 1. Пока идёт озвучка — кольцо последних `ringMs` чанков (по умолчанию 1,2 с), старые вытесняются.
 * 2. В момент срабатывания из кольца берутся чанки **от начала серии речи минус `leadMs`**, а не всё
 *    кольцо: раньше серии в нём, скорее всего, хвост собственной озвучки. На микрофоне без
 *    эхоподавления эхо может попасть и в саму серию — этот риск остаётся за `echoCancellation`
 *    захвата (TASK-90).
 * 3. Пока остановка не завершилась, новые чанки дописываются к «семени» без вытеснения (с потолком
 *    `maxSeedMs` на случай зависшей остановки).
 * 4. При снятии гейта `takeBargeInSeed` отдаёт семя, и `voiceService` начинает с него фразу VAD.
 *
 * Чистый модуль без React и Electron — покрыт unit-тестами.
 */

export interface BargeInPreRollOptions {
  /** Частота чанков (после ресемплинга для Whisper). */
  sampleRate: number;
  /** Сколько звука держит кольцо во время озвучки. */
  ringMs: number;
  /** Запас до первого громкого чанка серии: тихое начало первого слова. */
  leadMs: number;
  /** Потолок семени, если остановка озвучки затянулась. */
  maxSeedMs: number;
}

export const DEFAULT_BARGE_IN_PRE_ROLL: BargeInPreRollOptions = {
  sampleRate: 16000,
  // Серия до срабатывания на замерах 2026-09-17 — 0,4–0,7 с, плюс запас `leadMs`
  ringMs: 1200,
  // Как обычный pre-roll VAD (250 мс) с небольшим запасом на округление до границы чанка
  leadMs: 300,
  maxSeedMs: 5000
};

interface TimedChunk {
  samples: Float32Array;
  /** Метка времени обработки чанка (мс). */
  at: number;
  rms: number;
}

export interface BargeInPreRollState {
  ring: TimedChunk[];
  ringSamples: number;
  /** Семя фразы после срабатывания; `null` — перебивания не было. */
  seed: TimedChunk[] | null;
  seedSamples: number;
  /** Момент начала фразы в семени: первый чанк после отсечения. */
  seedStartedAt: number;
}

export interface BargeInSeed {
  chunks: Float32Array[];
  /** RMS каждого чанка семени, в том же порядке. */
  rms: number[];
  /** Метка времени первого чанка: от неё VAD считает длительность фразы. */
  startedAt: number;
  samples: number;
}

export function createBargeInPreRoll(): BargeInPreRollState {
  return { ring: [], ringSamples: 0, seed: null, seedSamples: 0, seedStartedAt: 0 };
}

/** Сброс при старте озвучки и после выдачи семени: каждая реплика судится заново. */
export function resetBargeInPreRoll(state: BargeInPreRollState): void {
  state.ring = [];
  state.ringSamples = 0;
  state.seed = null;
  state.seedSamples = 0;
  state.seedStartedAt = 0;
}

const msToSamples = (ms: number, options: BargeInPreRollOptions) => Math.max(0, Math.round((ms / 1000) * options.sampleRate));

/**
 * Чанк во время озвучки. Данные копируются: захват переиспользует буфер ресемплера.
 * До срабатывания — в кольцо с вытеснением, после — в семя без вытеснения.
 */
export function captureMutedChunk(
  state: BargeInPreRollState,
  samples: Float32Array,
  at: number,
  rms: number,
  options: BargeInPreRollOptions = DEFAULT_BARGE_IN_PRE_ROLL
): void {
  if (samples.length === 0) return;
  const chunk: TimedChunk = { samples: new Float32Array(samples), at, rms };

  if (state.seed) {
    if (state.seedSamples + chunk.samples.length > msToSamples(options.maxSeedMs, options)) return;
    state.seed.push(chunk);
    state.seedSamples += chunk.samples.length;
    return;
  }

  state.ring.push(chunk);
  state.ringSamples += chunk.samples.length;
  const limit = msToSamples(options.ringMs, options);
  // Самый свежий чанк остаётся всегда, даже если он один длиннее кольца
  while (state.ring.length > 1 && state.ringSamples - state.ring[0].samples.length >= limit) {
    state.ringSamples -= state.ring.shift()!.samples.length;
  }
}

/**
 * Перебивание засчитано: из кольца в семя переходят чанки от `seriesStartedAt − leadMs`.
 * Повторный вызов до `takeBargeInSeed` ничего не меняет.
 */
export function markBargeIn(
  state: BargeInPreRollState,
  seriesStartedAt: number,
  options: BargeInPreRollOptions = DEFAULT_BARGE_IN_PRE_ROLL
): void {
  if (state.seed) return;
  const from = seriesStartedAt - options.leadMs;
  const kept = state.ring.filter((c) => c.at >= from);
  // Серия всегда в кольце, но если метки времени разошлись, берём хотя бы последний чанк
  state.seed = kept.length > 0 ? kept : state.ring.slice(-1);
  state.seedSamples = state.seed.reduce((sum, c) => sum + c.samples.length, 0);
  state.seedStartedAt = state.seed[0]?.at ?? seriesStartedAt;
  state.ring = [];
  state.ringSamples = 0;
}

/** Забирает семя фразы (если перебивание было) и сбрасывает состояние. */
export function takeBargeInSeed(state: BargeInPreRollState): BargeInSeed | null {
  const seed = state.seed;
  const startedAt = state.seedStartedAt;
  const samples = state.seedSamples;
  resetBargeInPreRoll(state);
  if (!seed || seed.length === 0) return null;
  return { chunks: seed.map((c) => c.samples), rms: seed.map((c) => c.rms), startedAt, samples };
}
