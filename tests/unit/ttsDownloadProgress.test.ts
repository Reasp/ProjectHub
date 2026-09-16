import { describe, expect, it } from 'vitest';

import { parseContentLength, resolveTotalBytes } from '../../electron/services/ttsDownloadProgress';

describe('parseContentLength (TASK-87, дефект 6)', () => {
  it('читает обычный заголовок', () => {
    expect(parseContentLength('67153308')).toBe(67153308);
    expect(parseContentLength('  1024  ')).toBe(1024);
  });

  it('отсутствие заголовка и мусор дают null', () => {
    expect(parseContentLength(null)).toBeNull();
    expect(parseContentLength(undefined)).toBeNull();
    expect(parseContentLength('')).toBeNull();
    expect(parseContentLength('chunked')).toBeNull();
    expect(parseContentLength('12.5')).toBeNull();
    expect(parseContentLength('-5')).toBeNull();
    // Дублированный заголовок приходит склеенным — знаменателю доверять нельзя
    expect(parseContentLength('1024, 1024')).toBeNull();
  });

  it('нулевой и невыразимый размер не считаются известными', () => {
    expect(parseContentLength('0')).toBeNull();
    expect(parseContentLength('9'.repeat(30))).toBeNull();
  });
});

describe('resolveTotalBytes (TASK-87, дефект 6)', () => {
  it('при известном Content-Length знаменатель берётся из него', () => {
    expect(resolveTotalBytes(67153308, 1024, 'download')).toBe(67153308);
    expect(resolveTotalBytes(67153308, 67153308, 'verify')).toBe(67153308);
  });

  it('пока идёт скачивание без Content-Length, размер неизвестен (0 — проценты не показывать)', () => {
    expect(resolveTotalBytes(null, 0, 'download')).toBe(0);
    expect(resolveTotalBytes(null, 5_000_000, 'download')).toBe(0);
  });

  it('после скачивания объём известен точно и равен принятому', () => {
    // Раньше знаменателем оставался размер из реестра, и проценты расходились с фактом
    expect(resolveTotalBytes(null, 5_000_000, 'verify')).toBe(5_000_000);
    expect(resolveTotalBytes(null, 5_000_000, 'extract')).toBe(5_000_000);
    expect(resolveTotalBytes(null, 5_000_000, 'done')).toBe(5_000_000);
  });

  it('отрицательное число принятых байт не уходит в интерфейс', () => {
    expect(resolveTotalBytes(null, -1, 'done')).toBe(0);
  });
});
