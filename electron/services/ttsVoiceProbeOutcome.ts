/**
 * Разбор исхода пробной загрузки голоса Piper в отдельном процессе (TASK-69, [[decision-34]]).
 *
 * Пользовательская модель проверяется не в воркере main-процесса, а в `utilityProcess`: sherpa-onnx
 * на битой модели не бросает исключение, а аварийно завершает процесс, и `worker_threads` от этого
 * не защищают — поток делит процесс с main, падает всё приложение. Отдельный процесс может умереть
 * как угодно, поэтому исход складывается из трёх источников: сообщение пробы, код выхода и таймаут.
 *
 * Чистый модуль без Electron — покрыт unit-тестами.
 */

import { isNativeModuleMissingError, type PiperVoiceProbeErrorCode } from './ttsErrorCodes';

/** Сообщение, которое проба отправляет родителю перед выходом. */
export type VoiceProbeMessage =
  | { type: 'ok'; sampleRate: number; loadTimeMs: number; audioSec: number }
  | { type: 'error'; error: string };

export interface VoiceProbeObservation {
  /** Последнее сообщение от пробы; `null`, если процесс умер молча. */
  message: VoiceProbeMessage | null;
  /** Код выхода процесса; `null`, если процесс ещё не вышел (таймаут). */
  exitCode: number | null;
  timedOut: boolean;
}

export type VoiceProbeResult =
  | { ok: true; sampleRate: number; loadTimeMs: number; audioSec: number }
  | { ok: false; errorCode: PiperVoiceProbeErrorCode | 'native_module_missing'; detail: string };

export function isVoiceProbeMessage(value: unknown): value is VoiceProbeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  if (msg.type === 'ok') {
    return typeof msg.sampleRate === 'number' && typeof msg.loadTimeMs === 'number' && typeof msg.audioSec === 'number';
  }
  return msg.type === 'error' && typeof msg.error === 'string';
}

export function interpretVoiceProbe(observation: VoiceProbeObservation): VoiceProbeResult {
  const { message, exitCode, timedOut } = observation;

  // Успех засчитывается только при реально синтезированном звуке: модель, которая загрузилась,
  // но выдала пустоту, голосом не является.
  if (message?.type === 'ok') {
    if (message.sampleRate > 0 && message.audioSec > 0) {
      return { ok: true, sampleRate: message.sampleRate, loadTimeMs: message.loadTimeMs, audioSec: message.audioSec };
    }
    return { ok: false, errorCode: 'model_rejected', detail: 'model produced no audio' };
  }

  if (message?.type === 'error') {
    if (isNativeModuleMissingError(message.error)) {
      return { ok: false, errorCode: 'native_module_missing', detail: message.error };
    }
    return { ok: false, errorCode: 'model_rejected', detail: message.error };
  }

  if (timedOut) {
    return { ok: false, errorCode: 'probe_timeout', detail: 'voice probe did not finish in time' };
  }

  // Процесс умер, не успев ничего сообщить, — ровно то, что sherpa делает на битой модели.
  return {
    ok: false,
    errorCode: 'model_rejected',
    detail: `voice probe process exited with code ${exitCode ?? 'unknown'} without a result`
  };
}
