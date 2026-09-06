import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// projectScanner → projectRegistry → appPaths: нужен частичный мок electron.app с userData
// во временном каталоге, чтобы тест не трогал реальный реестр проектов.
const USER_DATA = path.join(os.tmpdir(), `projecthub-scanner-test-${process.pid}`);
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? USER_DATA : os.homedir()),
    getAppPath: () => path.join(USER_DATA, 'app.asar')
  }
}));

const {
  computeInspectCacheKey,
  getInspectCacheSize,
  inspectProject,
  invalidateInspectCache,
  mapWithConcurrency
} = await import('../../electron/services/projectScanner');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function writeTask(dir: string, id: number, status: string) {
  await fs.writeFile(
    path.join(dir, 'backlog', 'tasks', `task-${id} - Test.md`),
    `---\nid: task-${id}\ntitle: Test ${id}\nstatus: ${status}\n---\n\nbody\n`,
    'utf-8'
  );
}

/** Гарантированно другой mtime: на NTFS/ext4 разрешение достаточно, но выждем чуть-чуть. */
async function touchWithNewMtime(filePath: string, content: string) {
  await sleep(20);
  await fs.writeFile(filePath, content, 'utf-8');
  const future = new Date(Date.now() + 5000);
  await fs.utimes(filePath, future, future);
}

describe('mapWithConcurrency (аудит 3.4)', () => {
  it('не превышает лимит одновременных вызовов и сохраняет порядок результатов', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 3, async (item) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(5 + (item % 3) * 5);
      active--;
      return item * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(results).toEqual(items.map((i) => i * 2));
  });

  it('ошибка одного элемента не роняет остальные', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    });
    expect(results).toEqual([1, undefined, 3]);
  });

  it('пустой список — пустой результат', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe('inspectProject: кэш по mtime (аудит 3.4)', () => {
  let projectDir: string;

  beforeAll(async () => {
    await fs.mkdir(USER_DATA, { recursive: true });
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'projecthub-scanner-proj-'));
    await fs.mkdir(path.join(projectDir, 'backlog', 'tasks'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'backlog', 'config.yml'), 'project_name: "Cache Test"\n', 'utf-8');
    await writeTask(projectDir, 1, 'To Do');
    await writeTask(projectDir, 2, 'Done');
    invalidateInspectCache();
  });

  afterAll(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(USER_DATA, { recursive: true, force: true });
  });

  it('повторный вызов с useCache без изменений отдаёт кэшированный результат', async () => {
    const first = await inspectProject(projectDir, { useCache: true });
    expect(first).not.toBeNull();
    expect(first!.name).toBe('Cache Test');
    expect(first!.taskCounts).toEqual({ total: 2, todo: 1, inProgress: 0, review: 0, done: 1 });
    expect(getInspectCacheSize()).toBe(1);

    await sleep(15);
    const second = await inspectProject(projectDir, { useCache: true });
    expect(second).not.toBeNull();
    // lastScannedAt из кэша — осмотр не повторялся
    expect(second!.lastScannedAt).toBe(first!.lastScannedAt);
  });

  it('правка статуса задачи (mtime файла, не каталога) инвалидирует кэш', async () => {
    const before = await inspectProject(projectDir, { useCache: true });
    const keyBefore = await computeInspectCacheKey(projectDir);

    await touchWithNewMtime(
      path.join(projectDir, 'backlog', 'tasks', 'task-1 - Test.md'),
      `---\nid: task-1\ntitle: Test 1\nstatus: In Progress\n---\n\nbody\n`
    );

    const keyAfter = await computeInspectCacheKey(projectDir);
    expect(keyAfter).not.toBe(keyBefore);

    const after = await inspectProject(projectDir, { useCache: true });
    expect(after!.taskCounts).toEqual({ total: 2, todo: 0, inProgress: 1, review: 0, done: 1 });
    expect(after!.lastScannedAt).not.toBe(before!.lastScannedAt);
  });

  it('добавление задачи инвалидирует кэш', async () => {
    await inspectProject(projectDir, { useCache: true });
    await sleep(20);
    await writeTask(projectDir, 3, 'Review');
    const after = await inspectProject(projectDir, { useCache: true });
    expect(after!.taskCounts.total).toBe(3);
    expect(after!.taskCounts.review).toBe(1);
  });

  it('вызов без useCache пересчитывает, но обновляет кэш; invalidateInspectCache сбрасывает', async () => {
    const cached = await inspectProject(projectDir, { useCache: true });
    await sleep(15);
    const fresh = await inspectProject(projectDir);
    expect(fresh!.lastScannedAt).not.toBe(cached!.lastScannedAt);

    const again = await inspectProject(projectDir, { useCache: true });
    expect(again!.lastScannedAt).toBe(fresh!.lastScannedAt);

    invalidateInspectCache(projectDir);
    expect(getInspectCacheSize()).toBe(0);
  });

  it('скан с skipGit не кладёт результат в кэш', async () => {
    invalidateInspectCache();
    const partial = await inspectProject(projectDir, { skipGit: true });
    expect(partial).not.toBeNull();
    expect(getInspectCacheSize()).toBe(0);
  });
});
