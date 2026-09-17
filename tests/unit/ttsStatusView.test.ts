import { describe, expect, it } from 'vitest';
import { describeTtsStatus } from '../../src/services/ttsStatusView';

describe('describeTtsStatus: строка статуса локального TTS (TASK-69, AC#7)', () => {
  it('без статуса — нейтральное состояние', () => {
    expect(describeTtsStatus(null)).toEqual({ kind: 'idle' });
    expect(describeTtsStatus({ status: 'unloaded', available: true })).toEqual({ kind: 'idle' });
  });

  it('готов — с временем загрузки в секундах', () => {
    expect(describeTtsStatus({ status: 'ready', available: true, loadTimeMs: 1299 })).toEqual({ kind: 'ready', loadTimeSec: 1.3 });
    expect(describeTtsStatus({ status: 'ready', available: true })).toEqual({ kind: 'ready', loadTimeSec: null });
  });

  it('ошибка голоса показывает причину, а не «модель не загружена»', () => {
    expect(
      describeTtsStatus({ status: 'error', available: true, errorCode: 'voice_not_installed', error: 'Voice x is not installed' })
    ).toEqual({ kind: 'error', errorCode: 'voice_not_installed', error: 'Voice x is not installed' });
  });

  it('ошибка без причины не выдумывает текст', () => {
    expect(describeTtsStatus({ status: 'error', available: true })).toEqual({ kind: 'idle' });
  });

  it('недоступность движка важнее статуса голоса', () => {
    expect(
      describeTtsStatus({ status: 'ready', available: false, errorCode: 'native_module_missing', error: 'Cannot find module' })
    ).toEqual({ kind: 'unavailable', errorCode: 'native_module_missing', error: 'Cannot find module' });
  });

  it('загрузка', () => {
    expect(describeTtsStatus({ status: 'loading', available: true })).toEqual({ kind: 'loading' });
  });
});
