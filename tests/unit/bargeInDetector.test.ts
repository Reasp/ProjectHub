import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BARGE_IN,
  createBargeInState,
  feedBargeIn,
  resetBargeIn,
  type BargeInOptions
} from '../../src/services/bargeInDetector';

const opts: BargeInOptions = { threshold: 0.08, sustainMs: 300 };
const LOUD = 0.2;
const QUIET = 0.01;

describe('feedBargeIn: перебивание озвучки голосом (TASK-83, AC #3)', () => {
  it('тихий звук не прерывает озвучку никогда', () => {
    const state = createBargeInState();
    for (let t = 0; t < 5000; t += 50) {
      expect(feedBargeIn(state, QUIET, t, opts), `t=${t}`).toBe(false);
    }
  });

  it('громкая речь дольше порога длительности прерывает озвучку', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, LOUD, 1000, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 1200, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 1300, opts)).toBe(true);
  });

  it('срабатывает ровно один раз до сброса', () => {
    const state = createBargeInState();
    feedBargeIn(state, LOUD, 0, opts);
    expect(feedBargeIn(state, LOUD, 400, opts)).toBe(true);
    expect(feedBargeIn(state, LOUD, 500, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 5000, opts)).toBe(false);

    resetBargeIn(state);
    expect(feedBargeIn(state, LOUD, 6000, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 6400, opts)).toBe(true);
  });

  it('короткий всплеск не считается перебиванием: серия рвётся тишиной', () => {
    const state = createBargeInState();
    feedBargeIn(state, LOUD, 0, opts);
    feedBargeIn(state, LOUD, 100, opts);
    expect(feedBargeIn(state, QUIET, 200, opts)).toBe(false);
    // Отсчёт начинается заново, прежние 200 мс не засчитываются.
    expect(feedBargeIn(state, LOUD, 250, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 400, opts)).toBe(false);
    expect(feedBargeIn(state, LOUD, 560, opts)).toBe(true);
  });

  it('ровно на пороге громкости не срабатывает: нужен звук выше порога', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, opts.threshold, 0, opts)).toBe(false);
    expect(feedBargeIn(state, opts.threshold, 1000, opts)).toBe(false);
    expect(state.since).toBe(0);
  });

  it('мусорные значения громкости не ломают детектор', () => {
    const state = createBargeInState();
    expect(feedBargeIn(state, Number.NaN, 0, opts)).toBe(false);
    expect(feedBargeIn(state, Number.POSITIVE_INFINITY, 100, opts)).toBe(false);
    expect(state.since).toBe(0);
  });

  it('значения по умолчанию заданы и осмысленны', () => {
    expect(DEFAULT_BARGE_IN.threshold).toBeGreaterThan(0.012);
    expect(DEFAULT_BARGE_IN.sustainMs).toBeGreaterThanOrEqual(200);
  });
});
