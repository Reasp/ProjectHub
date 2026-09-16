/**
 * Подсчёт прогресса скачивания голоса (TASK-87).
 *
 * Раньше при ответе без `Content-Length` за 100 % принимался размер архива из реестра, и
 * проценты расходились с фактически скачанным. Размер в реестре — это то, что ожидалось, а не
 * то, что отдаёт сервер; при chunked-ответе честного знаменателя просто нет.
 *
 * Поэтому неизвестный размер обозначается нулём: рендерер показывает скачанные мегабайты и
 * неопределённый индикатор вместо вымышленных процентов.
 *
 * Чистый модуль: без файловой системы и Electron — покрыт unit-тестами (правило 17).
 */

export type TtsDownloadPhase = 'download' | 'verify' | 'extract' | 'done';

/** Размер в байтах из заголовка `Content-Length`, либо `null`, если его нет или он не число. */
export function parseContentLength(header: string | null | undefined): number | null {
  if (typeof header !== 'string') return null;
  const text = header.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Знаменатель для события прогресса.
 *
 * Пока идёт скачивание и размер неизвестен, возвращается `0` — «показывать проценты нельзя».
 * После скачивания объём уже известен точно: он равен принятым байтам, поэтому на проверке
 * контрольной суммы и распаковке индикатор показывает 100 %, а не пустоту.
 */
export function resolveTotalBytes(
  contentLength: number | null,
  receivedBytes: number,
  phase: TtsDownloadPhase
): number {
  if (contentLength && contentLength > 0) return contentLength;
  return phase === 'download' ? 0 : Math.max(0, receivedBytes);
}
