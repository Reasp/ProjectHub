import zlib from 'node:zlib';

/**
 * Минимальный писатель ZIP-архивов (TASK-58, «Собрать архив логов» в экране «Диагностика»).
 * Без внешней зависимости: несколько текстовых файлов логов — не повод тянуть archiver/adm-zip.
 * Формат: DEFLATE (level 6) для каждой записи + Central Directory + EOCD, без ZIP64
 * (архив логов на несколько МБ никогда не приблизится к лимиту 4 ГБ формата).
 */

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  date: Date;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

/** DOS date/time для локального заголовка ZIP (только для читаемости в архиваторах, не влияет на данные). */
function toDosDateTime(date: Date): { time: number; date: number } {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: dosTime & 0xffff, date: dosDate & 0xffff };
}

export class ZipWriter {
  private entries: ZipEntry[] = [];

  addFile(name: string, data: Buffer, date: Date = new Date()): void {
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    this.entries.push({ name, data, crc: crc32(data), compressed, date });
  }

  toBuffer(): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      const { time, date } = toDosDateTime(entry.date);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(0, 6); // flags
      localHeader.writeUInt16LE(8, 8); // method: deflate
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(date, 12);
      localHeader.writeInt32LE(entry.crc | 0, 14);
      localHeader.writeUInt32LE(entry.compressed.length, 18);
      localHeader.writeUInt32LE(entry.data.length, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra length

      localParts.push(localHeader, nameBuf, entry.compressed);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4); // version made by
      centralHeader.writeUInt16LE(20, 6); // version needed
      centralHeader.writeUInt16LE(0, 8); // flags
      centralHeader.writeUInt16LE(8, 10); // method
      centralHeader.writeUInt16LE(time, 12);
      centralHeader.writeUInt16LE(date, 14);
      centralHeader.writeInt32LE(entry.crc | 0, 16);
      centralHeader.writeUInt32LE(entry.compressed.length, 20);
      centralHeader.writeUInt32LE(entry.data.length, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30); // extra length
      centralHeader.writeUInt16LE(0, 32); // comment length
      centralHeader.writeUInt16LE(0, 34); // disk number
      centralHeader.writeUInt16LE(0, 36); // internal attrs
      centralHeader.writeUInt32LE(0, 38); // external attrs
      centralHeader.writeUInt32LE(offset, 42);

      centralParts.push(centralHeader, nameBuf);

      offset += localHeader.length + nameBuf.length + entry.compressed.length;
    }

    const centralDirStart = offset;
    const centralDir = Buffer.concat(centralParts);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with central dir
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(centralDirStart, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...localParts, centralDir, eocd]);
  }
}
