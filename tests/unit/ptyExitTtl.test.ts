import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PTY_EXIT_TTL_MS,
  MIN_PTY_EXIT_TTL_MS,
  isPtyExitCleanupEnabled,
  resolvePtyExitTtlMs
} from '../../electron/services/ptyExitTtl';

describe('resolvePtyExitTtlMs', () => {
  it('по умолчанию — 10 минут', () => {
    expect(DEFAULT_PTY_EXIT_TTL_MS).toBe(600_000);
    expect(resolvePtyExitTtlMs(undefined)).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs(null)).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs('')).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs('   ')).toBe(DEFAULT_PTY_EXIT_TTL_MS);
  });

  it('мусор и отрицательные значения откатываются к значению по умолчанию', () => {
    expect(resolvePtyExitTtlMs('abc')).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs('-1')).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs(-5000)).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs(Number.NaN)).toBe(DEFAULT_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PTY_EXIT_TTL_MS);
  });

  it('ноль выключает автоочистку', () => {
    expect(resolvePtyExitTtlMs('0')).toBe(0);
    expect(resolvePtyExitTtlMs(0)).toBe(0);
    expect(isPtyExitCleanupEnabled(0)).toBe(false);
    expect(isPtyExitCleanupEnabled(DEFAULT_PTY_EXIT_TTL_MS)).toBe(true);
  });

  it('слишком маленький положительный TTL поднимается до нижней границы', () => {
    expect(resolvePtyExitTtlMs('1')).toBe(MIN_PTY_EXIT_TTL_MS);
    expect(resolvePtyExitTtlMs(1000)).toBe(MIN_PTY_EXIT_TTL_MS);
  });

  it('корректное значение принимается как есть и округляется вниз', () => {
    expect(resolvePtyExitTtlMs('30000')).toBe(30_000);
    expect(resolvePtyExitTtlMs(' 60000 ')).toBe(60_000);
    expect(resolvePtyExitTtlMs(45_000.9)).toBe(45_000);
  });
});
