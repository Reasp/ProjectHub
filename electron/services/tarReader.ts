/**
 * Разбор заголовков tar (TASK-87, decision-32).
 *
 * Архивы голосов sherpa-onnx приходят в `.tar.bz2`, и внешний `tar` для них оказался
 * неприменим (decision-32): системный bsdtar на Windows собран без bz2lib и зовёт отсутствующий
 * `bzip2 -d`, а GNU tar трактует `-f C:\...` как «хост:путь» и падает до распаковки. Поэтому
 * архив разбирается внутри процесса.
 *
 * Формат: последовательность блоков по 512 байт, заголовок + данные с добиванием до границы
 * блока. Поддерживаются ustar (`prefix` для длинных путей), расширения GNU (`L` — длинное имя)
 * и pax (`x` — запись `path=`), которыми пользуются реальные архивы sherpa.
 *
 * Чистый модуль: без файловой системы и Electron — покрыт unit-тестами (правило 17).
 */

export const TAR_BLOCK_SIZE = 512;

/** Что делать с записью: данные читать, каталог создать, остальное — пропустить. */
export type TarEntryKind = 'file' | 'directory' | 'longname' | 'pax' | 'skip';

export interface TarEntryHeader {
  /** Имя из заголовка: для ustar уже склеено с `prefix`. */
  name: string;
  /** Размер данных записи в байтах (данные занимают ceil(size / 512) блоков). */
  size: number;
  kind: TarEntryKind;
  /** Исходный typeflag — для диагностики. */
  typeflag: string;
}

export type TarFormatErrorCode = 'bad_checksum' | 'bad_number' | 'unsafe_entry';

export class TarFormatError extends Error {
  readonly code: TarFormatErrorCode;
  readonly detail?: string;

  constructor(code: TarFormatErrorCode, detail?: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'TarFormatError';
    this.code = code;
    this.detail = detail;
  }
}

/** Сколько блоков занимают данные записи. */
export function blocksForSize(size: number): number {
  return Math.ceil(size / TAR_BLOCK_SIZE);
}

/** Конец архива помечается нулевыми блоками. */
export function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

/** Строка из поля фиксированной длины: обрезается по первому NUL. */
function readString(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  let end = slice.indexOf(0);
  if (end === -1) end = slice.length;
  return Buffer.from(slice.subarray(0, end)).toString('utf8');
}

/**
 * Числовое поле tar: восьмеричная строка, а для больших значений — base-256 с флагом 0x80
 * в старшем бите (расширение GNU).
 */
function readNumber(block: Uint8Array, start: number, length: number): number {
  const slice = block.subarray(start, start + length);

  if ((slice[0] & 0x80) !== 0) {
    let value = 0;
    // Отрицательные размеры в архивах не встречаются — читаем как беззнаковое
    for (let i = 1; i < slice.length; i += 1) value = value * 256 + slice[i];
    if (!Number.isSafeInteger(value)) throw new TarFormatError('bad_number', 'base-256 value out of range');
    return value;
  }

  const text = Buffer.from(slice).toString('ascii').replace(/\0/g, ' ').trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarFormatError('bad_number', `not an octal field: ${JSON.stringify(text)}`);
  return parseInt(text, 8);
}

/**
 * Контрольная сумма заголовка: сумма всех байт, где поле суммы считается пробелами.
 * Исторически писалась и как знаковая, и как беззнаковая — принимаются оба варианта.
 */
function headerChecksums(block: Uint8Array): { unsigned: number; signed: number } {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i += 1) {
    // Поле chksum (148..156) при подсчёте заменяется пробелами
    const byte = i >= 148 && i < 156 ? 0x20 : block[i];
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return { unsigned, signed };
}

function kindFromTypeflag(typeflag: string, name: string): TarEntryKind {
  switch (typeflag) {
    case '0':
    case '\0':
    case '7':
      // Имя с завершающим слэшем — каталог даже при typeflag файла (старые архивы)
      return name.endsWith('/') ? 'directory' : 'file';
    case '5':
      return 'directory';
    case 'L':
      return 'longname';
    case 'x':
    case 'X':
      return 'pax';
    default:
      // ссылки (1, 2), устройства (3, 4), fifo (6), глобальный pax (g) — не распаковываем
      return 'skip';
  }
}

/**
 * Разбирает блок-заголовок tar.
 *
 * @returns заголовок или `null`, если блок нулевой (конец архива)
 * @throws {TarFormatError} если контрольная сумма или числовые поля не сходятся
 */
export function parseTarHeader(block: Uint8Array): TarEntryHeader | null {
  if (block.length < TAR_BLOCK_SIZE) {
    throw new TarFormatError('bad_checksum', `short header block: ${block.length} bytes`);
  }
  if (isZeroBlock(block)) return null;

  const expected = readNumber(block, 148, 8);
  const { unsigned, signed } = headerChecksums(block);
  if (expected !== unsigned && expected !== signed) {
    throw new TarFormatError('bad_checksum', `expected ${expected}, got ${unsigned}`);
  }

  const rawName = readString(block, 0, 100);
  const typeflag = String.fromCharCode(block[156] || 0);
  const magic = readString(block, 257, 6);
  const prefix = magic.startsWith('ustar') ? readString(block, 345, 155) : '';
  const name = prefix ? `${prefix}/${rawName}` : rawName;

  return {
    name,
    size: readNumber(block, 124, 12),
    kind: kindFromTypeflag(typeflag, name),
    typeflag
  };
}

/**
 * Имя записи pax-заголовка: записи идут как `"<длина> path=<значение>\n"`.
 *
 * @returns значение `path` или `null`, если записи нет
 */
export function parsePaxPath(body: Uint8Array): string | null {
  const text = Buffer.from(body).toString('utf8');
  // Длина записи в начале строки нужна только для смещений — ищем ключ напрямую
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match ? match[1] : null;
}

/**
 * Приводит имя записи к безопасному относительному пути.
 *
 * Архив скачивается по HTTPS и сверяется по sha256, но распаковка чужого архива — классический
 * путь к записи файла за пределы целевого каталога (`../`, абсолютный путь, буква диска),
 * поэтому имя проверяется до любого обращения к файловой системе (как в `pathGuard`).
 *
 * @returns нормализованный путь с разделителем `/` или `null`, если запись небезопасна
 */
export function sanitizeTarEntryName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  // На Windows обратный слэш — тоже разделитель: нормализуем до проверки, а не после
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.includes('\0')) return null;

  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join('/') : null;
}
