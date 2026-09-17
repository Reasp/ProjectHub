import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BARGE_IN,
  DEFAULT_BARGE_IN_THRESHOLD,
  bargeInThresholdFor,
  createBargeInState,
  feedBargeIn,
  phraseSpeechLevel,
  resetBargeIn,
  updateSpeechLevel,
  type BargeInOptions
} from '../../src/services/bargeInDetector';

const opts: BargeInOptions = { threshold: 0.035, sustainMs: 250, maxGapMs: 300, minLoudChunks: 3 };
const LOUD = 0.2;
const QUIET = 0.005;
/** Длительность чанка захвата: 4096 кадров на 48 кГц. */
const CHUNK_MS = 85;

/**
 * RMS по чанкам 85 мс на входе упакованного приложения (фейковый микрофон, речь Piper, захват с
 * теми же ограничениями, что у voiceService), замер 2026-09-17. На этих данных первая версия
 * детектора (0.08 подряд 350 мс) не срабатывала вовсе.
 */
/** Команда «Какие задачи?» — по ней VAD узнаёт громкость пользователя. */
const USER_COMMAND = [0.082, 0.299, 0.009, 0.192, 0.264, 0.151, 0.195, 0.101, 0.129, 0.025, 0.059, 0.021];
/** «Замолчи, хватит, замолчи» той же громкости файла: фонетически заметно тише команды. */
const STOP_PHRASE = [
  0.048, 0.059, 0.112, 0.146, 0.142, 0.031, 0.043, 0.059, 0.067, 0.017, 0.004, 0.026, 0.039, 0.123, 0.086, 0.023, 0.046,
  0.004, 0.007, 0.026, 0.049, 0.065, 0.073, 0.031, 0.036, 0.048, 0.029
];
/** Короткое «Хватит.» — три громких чанка подряд. */
const STOP_WORD = [0.034, 0.076, 0.165, 0.12, 0.031];
/** Другой прогон: команда громче, «Хватит.» после паузы дало лишь два громких чанка. */
const LOUD_COMMAND = [0.014, 0.239, 0.027, 0.249, 0.258, 0.119, 0.221, 0.074, 0.154, 0.047, 0.048, 0.025];
const SHORT_STOP_WORD = [0.06, 0.134, 0.171, 0.017, 0.037];
/** Щелчок 60 мс посреди тишины. */
const CLICK = [0.004, 0.003, 0.003, 0.264, 0.009, 0.004, 0.002, 0.003];

/** Прогоняет последовательность RMS как поток чанков; возвращает момент срабатывания или null. */
function run(levels: number[], options: BargeInOptions = opts, start = 1000): number | null {
  const state = createBargeInState();
  for (let i = 0; i < levels.length; i++) {
    const now = start + i * CHUNK_MS;
    if (feedBargeIn(state, levels[i], now, options)) return now - start;
  }
  return null;
}

/** Уровень речи пользователя так, как его копит VAD: громкость фразы по звучащим чанкам. */
function learnedLevel(phrase: number[], vadThreshold = 0.012): number | null {
  return updateSpeechLevel(null, phraseSpeechLevel(phrase.filter((v) => v > vadThreshold)) ?? 0);
}

describe('bargeInThresholdFor: порог относительно громкости пользователя (TASK-83, AC #3)', () => {
  it('без услышанной речи — запасной порог', () => {
    expect(bargeInThresholdFor(null)).toBe(DEFAULT_BARGE_IN_THRESHOLD.fallbackThreshold);
  });

  it('доля уровня речи, в пределах границ', () => {
    expect(bargeInThresholdFor(0.2)).toBeCloseTo(0.06);
    expect(bargeInThresholdFor(0.01)).toBe(DEFAULT_BARGE_IN_THRESHOLD.minThreshold);
    expect(bargeInThresholdFor(0.9)).toBe(DEFAULT_BARGE_IN_THRESHOLD.maxThreshold);
  });

  it('громкость фразы — 75-й перцентиль, тихие концы слов её не занижают', () => {
    expect(phraseSpeechLevel([])).toBeNull();
    expect(phraseSpeechLevel([0.2, 0.03, 0.2, 0.04, 0.2, 0.2])).toBe(0.2);
    expect(phraseSpeechLevel([0.1, Number.NaN, 0])).toBe(0.1);
  });

  it('уровень речи сглаживается между фразами и игнорирует мусор', () => {
    expect(updateSpeechLevel(null, 0.1)).toBe(0.1);
    expect(updateSpeechLevel(0.1, 0.2)).toBeCloseTo(0.13);
    expect(updateSpeechLevel(0.1, Number.NaN)).toBe(0.1);
    expect(updateSpeechLevel(null, 0)).toBeNull();
  });
});

describe('feedBargeIn на замерах из приложения', () => {
  const threshold = bargeInThresholdFor(learnedLevel(USER_COMMAND));
  const live: BargeInOptions = { ...DEFAULT_BARGE_IN, threshold };

  it('порог, выученный по команде пользователя, выше порога VAD и ниже громкости речи', () => {
    expect(threshold).toBeGreaterThan(0.035);
    expect(threshold).toBeLessThan(0.08);
  });

  it('просьба «замолчи» обычной громкости перебивает озвучку в первые полсекунды', () => {
    const at = run(STOP_PHRASE, live);
    expect(at).not.toBeNull();
    expect(at as number).toBeLessThanOrEqual(500);
  });

  it('первая версия детектора эту же просьбу пропускала', () => {
    expect(run(STOP_PHRASE, { threshold: 0.08, sustainMs: 350, maxGapMs: 0, minLoudChunks: 1 })).toBeNull();
  });

  it('короткое «хватит» тоже перебивает', () => {
    expect(run(STOP_WORD, live)).not.toBeNull();
    const afterLoudCommand: BargeInOptions = { ...DEFAULT_BARGE_IN, threshold: bargeInThresholdFor(learnedLevel(LOUD_COMMAND)) };
    expect(run(SHORT_STOP_WORD, afterLoudCommand)).not.toBeNull();
  });

  it('щелчок посреди тишины не перебивает', () => {
    expect(run(CLICK, live)).toBeNull();
  });
});

describe('feedBargeIn: модель серии речи', () => {
  it('тихий звук не прерывает озвучку никогда', () => {
    expect(run(Array.from({ length: 100 }, () => QUIET))).toBeNull();
  });

  it('одиночный щелчок и редкие щелчки не становятся серией', () => {
    expect(run([LOUD])).toBeNull();
    const sparse = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? LOUD : QUIET));
    expect(run(sparse)).toBeNull();
  });

  it('при требовании трёх чанков два громких подряд — слишком коротко', () => {
    expect(run([LOUD, LOUD, QUIET, QUIET, QUIET, QUIET, QUIET])).toBeNull();
  });

  it('пауза длиннее maxGapMs начинает серию заново', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, LOUD, 0, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 100, opts)).toBe(false);
    expect(feedBargeIn(state, QUIET, 200, opts)).toBe(false);
    // 350 мс без громкого чанка — серия оборвана, отсчёт с 450
    expect(feedBargeIn(state, LOUD, 450, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 550, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 650, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 700, opts)).toBe(true);
  });

  it('пауза короче maxGapMs серию не обрывает', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, LOUD, 0, opts)).toBe(false);
    expect(feedBargeIn(state, QUIET, 100, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 200, opts)).toBe(false);
    expect(feedBargeIn(state, QUIET, 300, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 400, opts)).toBe(true);
  });

  it('срабатывает ровно один раз до сброса', () => {
    const state = createBargeInState();
    feedBargeIn(state, LOUD, 0, opts);
    feedBargeIn(state, LOUD, 150, opts);
    expect(feedBargeIn(state, LOUD, 300, opts)).toBe(true);
    expect(feedBargeIn(state, LOUD, 400, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 5000, opts)).toBe(false);

    resetBargeIn(state);
    expect(feedBargeIn(state, LOUD, 6000, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 6150, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 6300, opts)).toBe(true);
  });

  it('ровно на пороге громкости не срабатывает: нужен звук выше порога', () => {
    expect(run(Array.from({ length: 20 }, () => opts.threshold))).toBeNull();
  });

  it('мусорные значения громкости не ломают детектор', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, Number.NaN, 0, opts)).toBe(false);
    expect(feedBargeIn(state, Number.POSITIVE_INFINITY, 100, opts)).toBe(false);
    expect(state.active).toBe(false);
  });

  it('значения по умолчанию осмысленны', () => {
    expect(DEFAULT_BARGE_IN.threshold).toBeGreaterThan(0.012);
    expect(DEFAULT_BARGE_IN.sustainMs).toBe(80);
    expect(DEFAULT_BARGE_IN.maxGapMs).toBe(300);
    expect(DEFAULT_BARGE_IN.minLoudChunks).toBe(2);
  });
});
