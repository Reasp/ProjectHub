/**
 * Распаковка `.tar.bz2` внутри процесса, без внешних программ (TASK-87, decision-32).
 *
 * Причина отказа от системного `tar` — в decision-32: на Windows он ломается двумя независимыми
 * способами (bsdtar собран без bz2lib и зовёт отсутствующий `bzip2 -d`; GNU tar читает
 * `-f C:\...` как «хост:путь»), и какой сработает — зависит от порядка путей в PATH.
 *
 * Схема: bzip2 распаковывается потоком в промежуточный `.tar` на диске (а не в память: архив
 * голоса ~67 МБ сжат и ~90 МБ распакован), затем tar читается последовательно и пишется по
 * файлам. Пиковая память — один буфер копирования, а не размер архива.
 */
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import bz2 from 'unbzip2-stream';
import {
  blocksForSize,
  parsePaxPath,
  parseTarHeader,
  sanitizeTarEntryName,
  TAR_BLOCK_SIZE,
  TarFormatError,
  type TarEntryHeader
} from './tarReader';

export type ArchiveExtractErrorCode = 'bzip2_failed' | 'tar_invalid' | 'unsafe_entry';

export class ArchiveExtractError extends Error {
  readonly code: ArchiveExtractErrorCode;
  readonly detail?: string;

  constructor(code: ArchiveExtractErrorCode, detail?: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'ArchiveExtractError';
    this.code = code;
    this.detail = detail;
  }
}

/** Буфер копирования данных записи: компромисс между числом системных вызовов и памятью. */
const COPY_CHUNK_BYTES = 1024 * 1024;

/** Имя промежуточного `.tar` внутри целевого каталога — удаляется сразу после распаковки. */
const TEMP_TAR_NAME = '.archive.tar';

/**
 * Распаковывает bzip2 потоком: чистый JS, без нативной сборки и внешних программ.
 */
export async function decompressBzip2(archivePath: string, tarPath: string): Promise<void> {
  try {
    await pipeline(createReadStream(archivePath), bz2(), createWriteStream(tarPath));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ArchiveExtractError('bzip2_failed', message, { cause: err });
  }
}

/** Проверяет, что запись не уводит за пределы целевого каталога, и возвращает абсолютный путь. */
function resolveEntryPath(targetDir: string, entryName: string): string {
  const safeName = sanitizeTarEntryName(entryName);
  if (!safeName) throw new ArchiveExtractError('unsafe_entry', entryName);

  const resolved = path.resolve(targetDir, safeName);
  const root = path.resolve(targetDir);
  // Вторая линия защиты после sanitizeTarEntryName: символические конструкции и регистр путей
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ArchiveExtractError('unsafe_entry', entryName);
  }
  return resolved;
}

/** Читает ровно `length` байт с позиции `position`; возвращает null, если данные кончились. */
async function readExact(
  handle: fs.FileHandle,
  buffer: Buffer,
  position: number,
  length: number
): Promise<Buffer | null> {
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    // 0 байт — конец файла: архив кончился или обрезан, решает вызывающий
    if (bytesRead === 0) return null;
    read += bytesRead;
  }
  return buffer.subarray(0, length);
}

/** Пишет данные записи в файл, читая их из tar кусками. */
async function writeEntryFile(
  handle: fs.FileHandle,
  filePath: string,
  dataOffset: number,
  size: number,
  buffer: Buffer
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const out = await fs.open(filePath, 'w');
  try {
    let written = 0;
    while (written < size) {
      const chunkSize = Math.min(buffer.length, size - written);
      const chunk = await readExact(handle, buffer, dataOffset + written, chunkSize);
      if (!chunk) throw new ArchiveExtractError('tar_invalid', `unexpected end of archive in ${filePath}`);
      await out.write(chunk, 0, chunkSize);
      written += chunkSize;
    }
  } finally {
    await out.close();
  }
}

/**
 * Распаковывает обычный `.tar` в каталог.
 *
 * Длинные имена приходят отдельной записью до самого файла (GNU `L` или pax `path=`), поэтому
 * разобранное имя переносится на следующую запись.
 */
export async function extractTar(tarPath: string, targetDir: string): Promise<number> {
  await fs.mkdir(targetDir, { recursive: true });
  const handle = await fs.open(tarPath, 'r');
  const headerBuffer = Buffer.alloc(TAR_BLOCK_SIZE);
  const copyBuffer = Buffer.alloc(COPY_CHUNK_BYTES);

  try {
    let offset = 0;
    let extracted = 0;
    /** Имя из предшествующей записи GNU longname / pax — перекрывает имя в заголовке. */
    let pendingName: string | null = null;

    for (;;) {
      const block = await readExact(handle, headerBuffer, offset, TAR_BLOCK_SIZE);
      if (!block) break;
      offset += TAR_BLOCK_SIZE;

      let header: TarEntryHeader | null;
      try {
        header = parseTarHeader(block);
      } catch (err) {
        if (err instanceof TarFormatError) {
          throw new ArchiveExtractError('tar_invalid', err.detail ?? err.message, { cause: err });
        }
        throw err;
      }
      // Нулевой блок — конец архива
      if (!header) break;

      const dataOffset = offset;
      offset += blocksForSize(header.size) * TAR_BLOCK_SIZE;

      if (header.kind === 'longname' || header.kind === 'pax') {
        // Служебные записи малы (путь, а не содержимое файла) — читаем целиком
        const metaBuffer = Buffer.alloc(header.size);
        const meta = await readExact(handle, metaBuffer, dataOffset, header.size);
        if (!meta) throw new ArchiveExtractError('tar_invalid', 'unexpected end of archive in long name record');
        pendingName =
          header.kind === 'longname'
            ? Buffer.from(meta).toString('utf8').replace(/\0.*$/, '')
            : parsePaxPath(meta) ?? pendingName;
        continue;
      }

      const entryName = pendingName ?? header.name;
      pendingName = null;
      if (header.kind === 'skip') continue;

      const entryPath = resolveEntryPath(targetDir, entryName);
      extracted += 1;
      if (header.kind === 'directory') {
        await fs.mkdir(entryPath, { recursive: true });
        continue;
      }

      await writeEntryFile(handle, entryPath, dataOffset, header.size, copyBuffer);
    }
    return extracted;
  } finally {
    await handle.close();
  }
}

/**
 * Распаковывает `.tar.bz2` в каталог: bzip2 потоком на диск, затем tar по файлам.
 * Промежуточный `.tar` удаляется в любом случае — и на ошибке тоже.
 */
export async function extractTarBz2(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const tarPath = path.join(targetDir, TEMP_TAR_NAME);
  try {
    await decompressBzip2(archivePath, tarPath);
    const extracted = await extractTar(tarPath, targetDir);
    // Пустой результат — признак того, что «распаковалось» не то: молча возвращать успех нельзя
    if (extracted === 0) throw new ArchiveExtractError('tar_invalid', 'archive contains no entries');
  } finally {
    await fs.rm(tarPath, { force: true }).catch(() => {});
  }
}
