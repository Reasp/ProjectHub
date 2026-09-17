/**
 * Что показать в строке статуса локального TTS в настройках (TASK-69, AC#7).
 *
 * Причина видна пользователю в двух случаях: движок недоступен целиком (`unavailable` — нет
 * нативного модуля, воркер упал) и конкретный голос не загрузился (`error` — модели нет на диске,
 * файл не читается). Раньше второй случай отображался как «Модель не загружена», и причина
 * деградации в системный голос терялась.
 *
 * Чистый модуль без React — покрыт unit-тестами.
 */

export interface TtsStatusLike {
  status?: string;
  available?: boolean;
  loadTimeMs?: number;
  error?: string;
  errorCode?: string;
}

export type TtsStatusView =
  | { kind: 'ready'; loadTimeSec: number | null }
  | { kind: 'loading' }
  | { kind: 'unavailable'; errorCode?: string; error?: string }
  | { kind: 'error'; errorCode?: string; error?: string }
  | { kind: 'idle' };

export function describeTtsStatus(status: TtsStatusLike | null | undefined): TtsStatusView {
  if (!status) return { kind: 'idle' };
  // Недоступность движка важнее статуса последнего голоса: синтеза не будет ни с каким голосом
  if (status.available === false) {
    return { kind: 'unavailable', errorCode: status.errorCode, error: status.error };
  }
  if (status.status === 'ready') {
    return { kind: 'ready', loadTimeSec: status.loadTimeMs ? Math.round(status.loadTimeMs / 100) / 10 : null };
  }
  if (status.status === 'loading') return { kind: 'loading' };
  if (status.status === 'error' && (status.errorCode || status.error)) {
    return { kind: 'error', errorCode: status.errorCode, error: status.error };
  }
  return { kind: 'idle' };
}
