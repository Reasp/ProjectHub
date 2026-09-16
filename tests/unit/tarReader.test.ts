import { describe, expect, it } from 'vitest';

import {
  blocksForSize,
  isZeroBlock,
  parsePaxPath,
  parseTarHeader,
  sanitizeTarEntryName,
  TAR_BLOCK_SIZE,
  TarFormatError
} from '../../electron/services/tarReader';

/**
 * Собирает заголовочный блок tar в формате ustar — тот же, что пишут GNU tar и bsdtar.
 * Контрольная сумма считается по готовому блоку, где её поле заполнено пробелами.
 */
function tarHeader(
  name: string,
  size: number,
  options: { typeflag?: string; prefix?: string; ustar?: boolean } = {}
): Buffer {
  const { typeflag = '0', prefix = '', ustar = true } = options;
  const block = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100, 8, 'ascii');
  block.write('0000000\0', 108, 8, 'ascii');
  block.write('0000000\0', 116, 8, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  block.write('00000000000\0', 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');
  block.write(typeflag, 156, 1, 'ascii');
  if (ustar) {
    block.write('ustar\0', 257, 6, 'ascii');
    block.write('00', 263, 2, 'ascii');
  }
  if (prefix) block.write(prefix, 345, 155, 'utf8');

  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

describe('tarReader — разбор заголовков (TASK-87)', () => {
  it('читает имя, размер и тип обычного файла', () => {
    const header = parseTarHeader(tarHeader('vits-piper-ru/model.onnx', 1234));
    expect(header).not.toBeNull();
    expect(header!.name).toBe('vits-piper-ru/model.onnx');
    expect(header!.size).toBe(1234);
    expect(header!.kind).toBe('file');
  });

  it('склеивает длинный путь из поля prefix (ustar)', () => {
    const header = parseTarHeader(tarHeader('tokens.txt', 0, { prefix: 'vits-piper-ru_RU-irina-medium' }));
    expect(header!.name).toBe('vits-piper-ru_RU-irina-medium/tokens.txt');
  });

  it('различает каталоги: и по typeflag, и по слэшу в конце имени', () => {
    expect(parseTarHeader(tarHeader('espeak-ng-data', 0, { typeflag: '5' }))!.kind).toBe('directory');
    // Старые архивы помечают каталог только слэшем, оставляя typeflag файла
    expect(parseTarHeader(tarHeader('espeak-ng-data/', 0, { typeflag: '0' }))!.kind).toBe('directory');
  });

  it('служебные записи распознаются, а ссылки и устройства пропускаются', () => {
    expect(parseTarHeader(tarHeader('././@LongLink', 120, { typeflag: 'L' }))!.kind).toBe('longname');
    expect(parseTarHeader(tarHeader('pax_global', 52, { typeflag: 'x' }))!.kind).toBe('pax');
    expect(parseTarHeader(tarHeader('link', 0, { typeflag: '2' }))!.kind).toBe('skip');
  });

  it('нулевой блок означает конец архива', () => {
    const zero = Buffer.alloc(TAR_BLOCK_SIZE, 0);
    expect(isZeroBlock(zero)).toBe(true);
    expect(parseTarHeader(zero)).toBeNull();
  });

  it('несовпадение контрольной суммы — ошибка, а не молчаливый разбор мусора', () => {
    const block = tarHeader('model.onnx', 10);
    // Портим имя после подсчёта суммы: ровно так выглядит повреждённый архив
    block.write('X', 0, 1, 'ascii');
    expect(() => parseTarHeader(block)).toThrow(TarFormatError);
    try {
      parseTarHeader(block);
    } catch (err) {
      expect((err as TarFormatError).code).toBe('bad_checksum');
    }
  });

  it('читает размер в кодировке base-256 (расширение GNU для больших файлов)', () => {
    const block = Buffer.alloc(TAR_BLOCK_SIZE, 0);
    block.write('big.onnx', 0, 100, 'utf8');
    block.write('0000644\0', 100, 8, 'ascii');
    block.write('        ', 148, 8, 'ascii');
    block.write('0', 156, 1, 'ascii');
    block.write('ustar\0', 257, 6, 'ascii');
    // Признак base-256 — старший бит первого байта поля размера
    block[124] = 0x80;
    block[134] = 0x12;
    block[135] = 0x34;
    let sum = 0;
    for (const byte of block) sum += byte;
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');

    expect(parseTarHeader(block)!.size).toBe(0x1234);
  });

  it('нечисловое поле размера отвергается', () => {
    const block = tarHeader('model.onnx', 0);
    block.write('99xx99999999', 124, 12, 'ascii');
    let sum = 0;
    block.write('        ', 148, 8, 'ascii');
    for (const byte of block) sum += byte;
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    expect(() => parseTarHeader(block)).toThrow(TarFormatError);
  });

  it('данные записи занимают целое число блоков', () => {
    expect(blocksForSize(0)).toBe(0);
    expect(blocksForSize(1)).toBe(1);
    expect(blocksForSize(512)).toBe(1);
    expect(blocksForSize(513)).toBe(2);
  });
});

describe('tarReader — безопасность имён записей (TASK-87)', () => {
  it('нормализует обычные относительные пути', () => {
    expect(sanitizeTarEntryName('vits-piper-ru/model.onnx')).toBe('vits-piper-ru/model.onnx');
    expect(sanitizeTarEntryName('./vits/./model.onnx')).toBe('vits/model.onnx');
    expect(sanitizeTarEntryName('vits//model.onnx')).toBe('vits/model.onnx');
    expect(sanitizeTarEntryName('espeak-ng-data/')).toBe('espeak-ng-data');
  });

  it('обратный слэш считается разделителем: на Windows он тоже уводит из каталога', () => {
    expect(sanitizeTarEntryName('vits\\model.onnx')).toBe('vits/model.onnx');
    expect(sanitizeTarEntryName('..\\..\\evil.exe')).toBeNull();
  });

  it('отвергает выход за пределы целевого каталога и абсолютные пути', () => {
    expect(sanitizeTarEntryName('../evil.txt')).toBeNull();
    expect(sanitizeTarEntryName('vits/../../evil.txt')).toBeNull();
    expect(sanitizeTarEntryName('/etc/passwd')).toBeNull();
    expect(sanitizeTarEntryName('C:/Windows/system32/evil.dll')).toBeNull();
    expect(sanitizeTarEntryName('')).toBeNull();
    expect(sanitizeTarEntryName('.')).toBeNull();
    expect(sanitizeTarEntryName('evil\0.txt')).toBeNull();
  });
});

describe('tarReader — pax-заголовки (TASK-87)', () => {
  it('извлекает путь из записи path=', () => {
    const record = '30 path=vits-piper/tokens.txt\n';
    expect(parsePaxPath(Buffer.from(record, 'utf8'))).toBe('vits-piper/tokens.txt');
  });

  it('находит path среди других записей', () => {
    const body = Buffer.from('20 mtime=1700000000\n25 path=deep/name.onnx\n', 'utf8');
    expect(parsePaxPath(body)).toBe('deep/name.onnx');
  });

  it('возвращает null, если записи path нет', () => {
    expect(parsePaxPath(Buffer.from('20 mtime=1700000000\n', 'utf8'))).toBeNull();
  });
});
