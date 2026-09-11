/**
 * Время жизни завершившейся PTY-сессии до автоматического удаления (TASK-50).
 *
 * Завершённая сессия остаётся в `ptyService.sessions` и держит вкладку с xterm-буфером
 * на 5000 строк, пока пользователь не закроет её руками. По истечении TTL сессия
 * удаляется, а рендерер получает событие и убирает вкладку с уведомлением.
 *
 * Чистый модуль без Electron и node-pty — чтобы разбор настройки покрывался unit-тестами.
 */

/** TTL по умолчанию — 10 минут. */
export const DEFAULT_PTY_EXIT_TTL_MS = 10 * 60 * 1000;

/** Нижняя граница: слишком маленький TTL не даст прочитать вывод завершившейся команды. */
export const MIN_PTY_EXIT_TTL_MS = 5_000;

/** Имя переменной окружения, которой настраивается TTL. */
export const PTY_EXIT_TTL_ENV = 'PROJECTHUB_PTY_EXIT_TTL_MS';

/**
 * Разбирает значение TTL.
 *
 * - пусто/не число/отрицательное → значение по умолчанию;
 * - `0` → автоочистка выключена;
 * - положительное значение → не меньше {@link MIN_PTY_EXIT_TTL_MS}.
 */
export function resolvePtyExitTtlMs(raw?: string | number | null): number {
  if (raw === null || raw === undefined) return DEFAULT_PTY_EXIT_TTL_MS;

  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_PTY_EXIT_TTL_MS;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_PTY_EXIT_TTL_MS;
  if (value === 0) return 0;
  return Math.max(MIN_PTY_EXIT_TTL_MS, Math.floor(value));
}

/** Автоочистка включена? */
export function isPtyExitCleanupEnabled(ttlMs: number): boolean {
  return ttlMs > 0;
}
