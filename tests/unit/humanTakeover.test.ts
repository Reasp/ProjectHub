import { describe, expect, it } from 'vitest';
import { HumanTakeoverDetector } from '../../electron/services/humanTakeover';

describe('HumanTakeoverDetector: «человек взял мышь» (AC #4)', () => {
  it('резкое движение больше порога за 200 мс — перехват', () => {
    const d = new HumanTakeoverDetector({ thresholdPx: 40, windowMs: 200, graceMs: 800 });
    expect(d.sample(0, 500, 500)).toBe(false);
    expect(d.sample(50, 510, 505)).toBe(false);
    expect(d.sample(100, 560, 520)).toBe(true);
  });

  it('медленный дрейф (дрожание) порог не превышает', () => {
    const d = new HumanTakeoverDetector({ thresholdPx: 40, windowMs: 200 });
    let x = 0;
    for (let t = 0; t <= 2000; t += 50) {
      x += 5;
      expect(d.sample(t, x, 0)).toBe(false);
    }
  });

  it('движение курсора агентом в grace-окне — не перехват, после окна — снова отслеживается', () => {
    const d = new HumanTakeoverDetector({ thresholdPx: 40, windowMs: 200, graceMs: 800 });
    d.sample(0, 100, 100);
    d.noteAgentInput(10);
    expect(d.sample(60, 900, 700)).toBe(false);
    expect(d.sample(700, 900, 700)).toBe(false);
    expect(d.sample(850, 905, 702)).toBe(false);
    expect(d.sample(900, 1000, 800)).toBe(true);
  });

  it('reset очищает историю; нечисловые позиции игнорируются', () => {
    const d = new HumanTakeoverDetector();
    d.sample(0, 0, 0);
    d.reset();
    expect(d.sample(50, 300, 300)).toBe(false);
    expect(d.sample(60, Number.NaN, 0)).toBe(false);
  });
});
