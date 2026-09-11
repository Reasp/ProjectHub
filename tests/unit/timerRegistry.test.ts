import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimerRegistry } from '../../src/lib/timerRegistry';

describe('TimerRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('вызывает колбэк по истечении задержки и убирает таймер из учёта', () => {
    const registry = new TimerRegistry();
    const fn = vi.fn();

    registry.set(fn, 1000);
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('dispose снимает запланированные колбэки (нет setState после unmount)', () => {
    const registry = new TimerRegistry();
    const fn = vi.fn();

    registry.set(fn, 500);
    registry.dispose();

    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
    expect(registry.isDisposed).toBe(true);
  });

  it('после dispose новые таймеры не создаются', () => {
    const registry = new TimerRegistry();
    const fn = vi.fn();

    registry.dispose();
    const handle = registry.set(fn, 100);

    expect(handle).toBeNull();
    expect(registry.size).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clear снимает конкретный таймер, не трогая остальные', () => {
    const registry = new TimerRegistry();
    const first = vi.fn();
    const second = vi.fn();

    const firstHandle = registry.set(first, 100);
    registry.set(second, 100);

    registry.clear(firstHandle);
    expect(registry.size).toBe(1);

    vi.advanceTimersByTime(100);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('clear безопасен для null, undefined и повторного вызова', () => {
    const registry = new TimerRegistry();
    const fn = vi.fn();
    const handle = registry.set(fn, 100);

    expect(() => {
      registry.clear(null);
      registry.clear(undefined);
      registry.clear(handle);
      registry.clear(handle);
    }).not.toThrow();
    expect(registry.size).toBe(0);
  });

  it('clearAll снимает все таймеры, но реестр остаётся рабочим', () => {
    const registry = new TimerRegistry();
    const stale = vi.fn();
    const fresh = vi.fn();

    registry.set(stale, 100);
    registry.set(stale, 200);
    registry.clearAll();
    expect(registry.size).toBe(0);
    expect(registry.isDisposed).toBe(false);

    registry.set(fresh, 50);
    vi.advanceTimersByTime(500);
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('dispose во время ожидания предотвращает вызов уже сработавшего таймера', () => {
    const registry = new TimerRegistry();
    const fn = vi.fn();

    registry.set(() => {
      registry.dispose();
    }, 100);
    registry.set(fn, 100);

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
});
