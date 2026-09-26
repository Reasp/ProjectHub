import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MemoryError,
  deleteMemoryFact,
  memoryDirOf,
  readMemory,
  searchMemory,
  writeMemoryFact
} from '../../electron/services/memoryStore';
import type { MemoryDraft } from '../../electron/services/memoryFormat';

/** Хранилище памяти проекта на диске (TASK-76.2, decision-51 п. 1–5). */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memory-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const draft = (over: Partial<MemoryDraft> = {}): MemoryDraft => ({
  title: 'Сборка pack:win падает при открытом exe',
  description: 'Перед pack:win закрыть собранный ProjectHub.exe',
  type: 'project',
  body: 'electron-builder не перезапишет занятый файл.',
  source: 'task-76',
  ...over
});

const NOW = new Date(Date.UTC(2026, 8, 26, 13, 40));
const LATER = new Date(Date.UTC(2026, 8, 27, 9, 10));

async function files(): Promise<string[]> {
  return (await fs.readdir(memoryDirOf(root))).sort();
}

async function expectMemoryError(p: Promise<unknown>, code: string): Promise<MemoryError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(MemoryError);
    expect((err as MemoryError).code).toBe(code);
    return err as MemoryError;
  }
  throw new Error(`ожидалась MemoryError ${code}`);
}

describe('memoryStore', () => {
  it('без каталога памяти — пустой снимок', async () => {
    expect(await readMemory(root)).toEqual({ facts: [], invalid: [] });
  });

  it('пишет факт и индекс, повторное чтение возвращает тот же факт', async () => {
    const res = await writeMemoryFact(root, draft(), { now: NOW });
    expect(res.fact.id).toBe('mem-1');
    expect(res.replaced).toBe(false);
    expect(res.relativePath).toBe('backlog/memory/mem-1 - Сборка-packwin-падает-при-открытом-exe.md');
    expect(await files()).toEqual(['MEMORY.md', 'mem-1 - Сборка-packwin-падает-при-открытом-exe.md']);
    const index = await fs.readFile(path.join(memoryDirOf(root), 'MEMORY.md'), 'utf-8');
    expect(index).toContain('- [Сборка pack:win падает при открытом exe](mem-1%20-%20Сборка-packwin-падает-при-открытом-exe.md) — Перед pack:win');
    const { facts } = await readMemory(root);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: 'mem-1', created: '2026-09-26 13:40', source: 'task-76' });
  });

  it('отклоняет секрет, неверный черновик и дубликат, не создавая файлов', async () => {
    const secret = await expectMemoryError(
      writeMemoryFact(root, draft({ body: 'ключ sk-ant-api03-AbCdEf0123456789xyzXYZ' }), { now: NOW }),
      'secret_detected'
    );
    expect(secret.details.secretKinds).toEqual(['provider_key']);
    expect(secret.message).not.toContain('AbCdEf');
    await expectMemoryError(writeMemoryFact(root, draft({ title: '' }), { now: NOW }), 'invalid_draft');
    await expect(fs.readdir(memoryDirOf(root))).rejects.toThrow();

    await writeMemoryFact(root, draft(), { now: NOW });
    const dup = await expectMemoryError(
      writeMemoryFact(root, draft({ description: 'Закрыть ProjectHub.exe перед pack:win' }), { now: NOW }),
      'duplicate'
    );
    expect(dup.details.duplicateOf).toBe('mem-1');
    expect((await readMemory(root)).facts).toHaveLength(1);
  });

  it('replace обновляет факт, сохраняет created и переименовывает файл', async () => {
    await writeMemoryFact(root, draft(), { now: NOW });
    const res = await writeMemoryFact(root, draft({ title: 'Закрывать exe перед сборкой' }), { replace: 'MEM-1', now: LATER });
    expect(res.replaced).toBe(true);
    expect(res.fact).toMatchObject({ id: 'mem-1', created: '2026-09-26 13:40', updated: '2026-09-27 09:10' });
    expect(await files()).toEqual(['MEMORY.md', 'mem-1 - Закрывать-exe-перед-сборкой.md']);
    await expectMemoryError(writeMemoryFact(root, draft({ title: 'другое' }), { replace: 'mem-9' }), 'not_found');
    await expectMemoryError(writeMemoryFact(root, draft({ title: 'другое' }), { replace: 'doc-1' }), 'invalid_id');
  });

  it('удаляет факт и обновляет индекс', async () => {
    await writeMemoryFact(root, draft(), { now: NOW });
    await writeMemoryFact(root, draft({ title: 'Ollama виснет под нагрузкой', description: 'Перезапустить ollama' }), { now: NOW });
    await deleteMemoryFact(root, 'mem-1');
    const { facts } = await readMemory(root);
    expect(facts.map((f) => f.id)).toEqual(['mem-2']);
    const index = await fs.readFile(path.join(memoryDirOf(root), 'MEMORY.md'), 'utf-8');
    expect(index).not.toContain('mem-1');
    await expectMemoryError(deleteMemoryFact(root, 'mem-1'), 'not_found');
  });

  it('битый файл виден в invalid, его номер занят', async () => {
    await fs.mkdir(memoryDirOf(root), { recursive: true });
    await fs.writeFile(path.join(memoryDirOf(root), 'mem-5 - Битый.md'), '---\nid: "mem-5"\ncreated: 2026-09-26\n---\n', 'utf-8');
    await fs.writeFile(path.join(memoryDirOf(root), 'заметка.md'), 'просто текст', 'utf-8');
    const snap = await readMemory(root);
    expect(snap.facts).toEqual([]);
    expect(snap.invalid.map((i) => i.fileName).sort()).toEqual(['mem-5 - Битый.md', 'заметка.md']);
    const res = await writeMemoryFact(root, draft(), { now: NOW });
    expect(res.fact.id).toBe('mem-6');
  });

  it('параллельные записи получают разные номера', async () => {
    const titles = ['Первый факт о сборке', 'Второй факт про ollama', 'Третий факт про зеркало hf', 'Четвёртый факт про git'];
    const results = await Promise.all(
      titles.map((title, i) => writeMemoryFact(root, draft({ title, description: `описание номер ${i} уникальное ${title}` }), { now: NOW }))
    );
    expect(results.map((r) => r.fact.id).sort()).toEqual(['mem-1', 'mem-2', 'mem-3', 'mem-4']);
    const index = await fs.readFile(path.join(memoryDirOf(root), 'MEMORY.md'), 'utf-8');
    expect(index.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(4);
  });

  it('поиск по словам', async () => {
    await writeMemoryFact(root, draft(), { now: NOW });
    await writeMemoryFact(root, draft({ title: 'Ollama виснет под нагрузкой', description: 'Перезапустить ollama' }), { now: NOW });
    expect((await searchMemory(root, 'ollama')).map((f) => f.id)).toEqual(['mem-2']);
    expect(await searchMemory(root, 'несуществующее слово')).toEqual([]);
  });
});
