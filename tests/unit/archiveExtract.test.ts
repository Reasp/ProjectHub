import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ArchiveExtractError,
  extractTar,
  extractTarBz2
} from '../../electron/services/archiveExtract';
import { TAR_BLOCK_SIZE } from '../../electron/services/tarReader';

/**
 * Настоящий `.tar.bz2`, собранный GNU tar + bzip2 (2026-09-16) из трёх файлов той же раскладки,
 * что у архивов голосов sherpa: `vits-piper-test/{test.onnx,tokens.txt,espeak-ng-data/phontab}`.
 *
 * Фикстура именно бинарная и настоящая: смысл TASK-87 в том, что на машине владельца ни системный
 * tar, ни внешний bzip2 распаковать её не могут — значит, проверять надо на честном архиве.
 */
const SAMPLE_TAR_BZ2_BASE64 =
  'QlpoOTFBWSZTWeL9BlUAAWzfgcKRQAP/kCGAQAB3799gAMAgCDABOADAyDIADEaDIZAYYGQZAAYjQZDIDBFEU2po01' +
  'MUz0pob1T9SNqMYp6nfz2e/SdzxP2ln41yA4bEVMvLKL/FJSEhk3xhNJSycUgBJTytSqfCS54yb+On6OZ4pa9MqbJY' +
  'g2uGIrn6fnTTilksnJKBCRECcqJCbPxQaJNUohXVqTVA6W5fZKVqnmxZrcmsm4pFkolEuG1Sb1JnY0qlEoRCvbgH1P' +
  'b3SiczLppPD2PnPoa5lL+ZgkjjZNxcZpCdU3OqE340TEgpBrOvqmHVPm/qYlU4b9yYpinqkbUxvSiOSW/tR1lxKdtt' +
  'yRglfDb2Tt4HfvgXdM1A/4u5IpwoSHF+gyqA';

const TMP_ROOT = path.join(os.tmpdir(), `projecthub-archive-extract-${process.pid}`);

/** Заголовочный блок ustar — тот же помощник, что в tarReader.test.ts. */
function tarHeader(name: string, size: number, typeflag = '0'): Buffer {
  const block = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  block.write(name, 0, 100, 'utf8');
  block.write('0000644\0', 100, 8, 'ascii');
  block.write('0000000\0', 108, 8, 'ascii');
  block.write('0000000\0', 116, 8, 'ascii');
  block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  block.write('00000000000\0', 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');
  block.write(typeflag, 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/** Данные записи добиваются нулями до границы блока. */
function tarEntry(name: string, content: string, typeflag = '0'): Buffer {
  const data = Buffer.from(content, 'utf8');
  const padded = Buffer.alloc(Math.ceil(data.length / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE, 0);
  data.copy(padded);
  return Buffer.concat([tarHeader(name, data.length, typeflag), padded]);
}

/** Завершающие нулевые блоки архива. */
const TAR_END = Buffer.alloc(TAR_BLOCK_SIZE * 2, 0);

beforeAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

describe('archiveExtract — .tar.bz2 без внешних программ (TASK-87, decision-32)', () => {
  it('распаковывает настоящий архив bzip2 целиком, не вызывая tar и bzip2', async () => {
    const archivePath = path.join(TMP_ROOT, 'sample.tar.bz2');
    const targetDir = path.join(TMP_ROOT, 'out');
    await fs.writeFile(archivePath, Buffer.from(SAMPLE_TAR_BZ2_BASE64, 'base64'));

    await extractTarBz2(archivePath, targetDir);

    const root = path.join(targetDir, 'vits-piper-test');
    expect(await fs.readFile(path.join(root, 'test.onnx'), 'utf8')).toBe('fake onnx model bytes');
    expect(await fs.readFile(path.join(root, 'tokens.txt'), 'utf8')).toBe('a 1\nb 2\n');
    // Вложенный каталог из архива создаётся вместе с содержимым
    expect(await fs.readFile(path.join(root, 'espeak-ng-data', 'phontab'), 'utf8')).toBe('phontab-stub');
  });

  it('промежуточный .tar не остаётся в целевом каталоге', async () => {
    const entries = await fs.readdir(path.join(TMP_ROOT, 'out'));
    expect(entries).toEqual(['vits-piper-test']);
  });

  it('повреждённый архив даёт понятную ошибку, а не пустую «успешную» установку', async () => {
    const archivePath = path.join(TMP_ROOT, 'broken.tar.bz2');
    const targetDir = path.join(TMP_ROOT, 'broken-out');
    await fs.writeFile(archivePath, Buffer.from('this is not a bzip2 archive at all', 'utf8'));

    await expect(extractTarBz2(archivePath, targetDir)).rejects.toBeInstanceOf(ArchiveExtractError);
  });
});

describe('archiveExtract — распаковка tar (TASK-87)', () => {
  it('создаёт файлы и каталоги и возвращает число записей', async () => {
    const tarPath = path.join(TMP_ROOT, 'plain.tar');
    const targetDir = path.join(TMP_ROOT, 'plain-out');
    await fs.writeFile(
      tarPath,
      Buffer.concat([
        tarEntry('voice/', '', '5'),
        tarEntry('voice/tokens.txt', 'a 1\n'),
        tarEntry('voice/nested/model.bin', 'binary-ish'),
        TAR_END
      ])
    );

    const extracted = await extractTar(tarPath, targetDir);

    expect(extracted).toBe(3);
    expect(await fs.readFile(path.join(targetDir, 'voice', 'tokens.txt'), 'utf8')).toBe('a 1\n');
    expect(await fs.readFile(path.join(targetDir, 'voice', 'nested', 'model.bin'), 'utf8')).toBe('binary-ish');
  });

  it('длинное имя из записи GNU longname применяется к следующему файлу', async () => {
    const longName = `voice/${'d'.repeat(120)}/model.onnx`;
    const tarPath = path.join(TMP_ROOT, 'longname.tar');
    const targetDir = path.join(TMP_ROOT, 'longname-out');
    await fs.writeFile(
      tarPath,
      Buffer.concat([
        tarEntry('././@LongLink', `${longName}\0`, 'L'),
        // В самом заголовке имя обрезано до 100 байт — распаковаться должно длинное
        tarEntry(longName.slice(0, 100), 'long-name-payload'),
        TAR_END
      ])
    );

    await extractTar(tarPath, targetDir);

    expect(await fs.readFile(path.join(targetDir, longName), 'utf8')).toBe('long-name-payload');
  });

  it('запись, уводящая за пределы каталога, прерывает распаковку и ничего не пишет наружу', async () => {
    const tarPath = path.join(TMP_ROOT, 'evil.tar');
    const targetDir = path.join(TMP_ROOT, 'evil-out');
    await fs.writeFile(tarPath, Buffer.concat([tarEntry('../escaped.txt', 'pwned'), TAR_END]));

    await expect(extractTar(tarPath, targetDir)).rejects.toMatchObject({ code: 'unsafe_entry' });
    // Файл не должен появиться рядом с целевым каталогом
    await expect(fs.readFile(path.join(TMP_ROOT, 'escaped.txt'), 'utf8')).rejects.toThrow();
  });

  it('битый заголовок распознаётся как повреждённый архив', async () => {
    const tarPath = path.join(TMP_ROOT, 'corrupt.tar');
    const targetDir = path.join(TMP_ROOT, 'corrupt-out');
    const block = tarEntry('voice/model.onnx', 'payload');
    block.write('Z', 0, 1, 'ascii');
    await fs.writeFile(tarPath, Buffer.concat([block, TAR_END]));

    await expect(extractTar(tarPath, targetDir)).rejects.toMatchObject({ code: 'tar_invalid' });
  });
});
