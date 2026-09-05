import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileService } from '../../electron/services/fileService';

/**
 * Регрессия TASK-32 (аудит 4.7): validateSafePath сравнивал `resolved.startsWith(root)` без
 * разделителя, поэтому корень `.../App` пропускал пути из соседней папки `.../App2`.
 */
describe('fileService: защита от выхода за корень проекта', () => {
  let base: string;
  let root: string;
  let sibling: string;

  beforeAll(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'projecthub-fileservice-'));
    root = path.join(base, 'App');
    sibling = path.join(base, 'App2');
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'inside.txt'), 'inside', 'utf-8');
    await fs.writeFile(path.join(sibling, 'secret.txt'), 'secret', 'utf-8');
  });

  afterAll(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it('читает файл внутри проекта по относительному пути', async () => {
    await expect(fileService.readFileContent(root, 'src/inside.txt')).resolves.toBe('inside');
  });

  it('не читает соседнюю папку с общим префиксом через абсолютный путь', async () => {
    await expect(fileService.readFileContent(root, path.join(sibling, 'secret.txt'))).rejects.toThrow(/вне корня проекта/);
  });

  it('не читает соседнюю папку с общим префиксом через ../', async () => {
    await expect(fileService.readFileContent(root, '../App2/secret.txt')).rejects.toThrow(/вне корня проекта/);
  });

  it('не пишет, не создаёт и не удаляет вне проекта', async () => {
    await expect(fileService.saveFileContent(root, '../App2/evil.txt', 'x')).rejects.toThrow(/вне корня проекта/);
    await expect(fileService.createFileOrFolder(root, '../App2/evil-dir', true)).rejects.toThrow(/вне корня проекта/);
    await expect(fileService.deleteFileOrFolder(root, '../App2/secret.txt')).rejects.toThrow(/вне корня проекта/);
    await expect(fs.readFile(path.join(sibling, 'secret.txt'), 'utf-8')).resolves.toBe('secret');
  });

  it('readTree не показывает содержимое соседней папки', async () => {
    await expect(fileService.readTree(root, '../App2')).resolves.toEqual([]);
    const tree = await fileService.readTree(root, 'src');
    expect(tree.map((n) => n.name)).toEqual(['inside.txt']);
  });
});
