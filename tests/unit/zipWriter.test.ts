import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { ZipWriter } from '../../electron/services/zipWriter';

/** Разбирает ровно то, что пишет ZipWriter: последовательные local file entries + EOCD в хвосте. */
function parseLocalEntries(buf: Buffer): Array<{ name: string; content: Buffer }> {
  const entries: Array<{ name: string; content: Buffer }> = [];
  let offset = 0;
  while (offset < buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const nameLength = buf.readUInt16LE(offset + 26);
    const extraLength = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buf.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const content = zlib.inflateRawSync(compressed);
    expect(content.length).toBe(uncompressedSize);
    entries.push({ name, content });
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe('ZipWriter', () => {
  it('пишет валидный набор local file entries, читаемых обратно через inflateRaw', () => {
    const zip = new ZipWriter();
    zip.addFile('main.log', Buffer.from('2026-09-10T00:00:00.000Z [INFO] hello\n', 'utf8'));
    zip.addFile('sub/info.json', Buffer.from(JSON.stringify({ version: '0.1.0' }), 'utf8'));

    const buf = zip.toBuffer();
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);

    const entries = parseLocalEntries(buf);
    expect(entries.map((e) => e.name)).toEqual(['main.log', 'sub/info.json']);
    expect(entries[0].content.toString('utf8')).toContain('hello');
    expect(JSON.parse(entries[1].content.toString('utf8'))).toEqual({ version: '0.1.0' });
  });

  it('нормализует обратные слэши в путях записей (Windows -> ZIP-стиль)', () => {
    const zip = new ZipWriter();
    zip.addFile('logs\\main.log', Buffer.from('x'));
    const entries = parseLocalEntries(zip.toBuffer());
    expect(entries[0].name).toBe('logs/main.log');
  });

  it('записывает central directory с правильным числом записей и находит EOCD в хвосте', () => {
    const zip = new ZipWriter();
    zip.addFile('a.txt', Buffer.from('a'));
    zip.addFile('b.txt', Buffer.from('b'));
    zip.addFile('c.txt', Buffer.from('c'));

    const buf = zip.toBuffer();
    const eocdSignature = 0x06054b50;
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === eocdSignature) {
        eocdOffset = i;
        break;
      }
    }
    expect(eocdOffset).toBeGreaterThan(-1);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    expect(totalEntries).toBe(3);
  });

  it('пустой архив не бросает исключение и содержит только EOCD', () => {
    const zip = new ZipWriter();
    const buf = zip.toBuffer();
    expect(buf.length).toBe(22);
    expect(buf.readUInt32LE(0)).toBe(0x06054b50);
  });
});
