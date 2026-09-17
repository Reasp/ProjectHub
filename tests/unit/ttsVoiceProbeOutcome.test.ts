import { describe, expect, it } from 'vitest';
import { interpretVoiceProbe, isVoiceProbeMessage } from '../../electron/services/ttsVoiceProbeOutcome';

describe('interpretVoiceProbe: исход пробы голоса в отдельном процессе (TASK-69, decision-34)', () => {
  it('успех — только при синтезированном звуке', () => {
    expect(
      interpretVoiceProbe({ message: { type: 'ok', sampleRate: 22050, loadTimeMs: 850, audioSec: 1.2 }, exitCode: 0, timedOut: false })
    ).toEqual({ ok: true, sampleRate: 22050, loadTimeMs: 850, audioSec: 1.2 });
  });

  it('загрузилась, но звука нет — модель отвергнута', () => {
    const result = interpretVoiceProbe({ message: { type: 'ok', sampleRate: 22050, loadTimeMs: 850, audioSec: 0 }, exitCode: 0, timedOut: false });
    expect(result).toMatchObject({ ok: false, errorCode: 'model_rejected' });
  });

  it('процесс умер молча (аварийное завершение sherpa) — модель отвергнута с кодом выхода в detail', () => {
    const result = interpretVoiceProbe({ message: null, exitCode: -1073740791, timedOut: false });
    expect(result).toMatchObject({ ok: false, errorCode: 'model_rejected' });
    expect(result.ok ? '' : result.detail).toContain('-1073740791');
  });

  it('исключение при загрузке — модель отвергнута с текстом ошибки', () => {
    const result = interpretVoiceProbe({
      message: { type: 'error', error: "'sample_rate' does not exist in the metadata" },
      exitCode: 1,
      timedOut: false
    });
    expect(result).toEqual({ ok: false, errorCode: 'model_rejected', detail: "'sample_rate' does not exist in the metadata" });
  });

  it('нет нативного модуля — отдельный код, это не вина модели', () => {
    const result = interpretVoiceProbe({
      message: { type: 'error', error: "Cannot find module 'sherpa-onnx-node'" },
      exitCode: 1,
      timedOut: false
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'native_module_missing' });
  });

  it('таймаут без сообщения — probe_timeout', () => {
    expect(interpretVoiceProbe({ message: null, exitCode: null, timedOut: true })).toMatchObject({
      ok: false,
      errorCode: 'probe_timeout'
    });
  });

  it('сообщение важнее таймаута: итог успел прийти', () => {
    expect(
      interpretVoiceProbe({ message: { type: 'ok', sampleRate: 16000, loadTimeMs: 10, audioSec: 0.5 }, exitCode: null, timedOut: true })
    ).toMatchObject({ ok: true });
  });
});

describe('isVoiceProbeMessage: проверка формы сообщения от процесса', () => {
  it('принимает корректные сообщения', () => {
    expect(isVoiceProbeMessage({ type: 'ok', sampleRate: 22050, loadTimeMs: 1, audioSec: 1 })).toBe(true);
    expect(isVoiceProbeMessage({ type: 'error', error: 'x' })).toBe(true);
  });

  it('отвергает мусор', () => {
    for (const value of [null, undefined, 'ok', {}, { type: 'ok' }, { type: 'ok', sampleRate: '22050', loadTimeMs: 1, audioSec: 1 }, { type: 'error' }]) {
      expect(isVoiceProbeMessage(value)).toBe(false);
    }
  });
});
