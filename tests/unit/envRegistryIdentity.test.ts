import { describe, expect, it, vi } from 'vitest';
import {
  createSnapshotCache,
  entryStatus,
  IDENTITY_TOLERANCE_MS,
  resolveEntryStatuses,
  snapshotIsStaleFor,
  startTimesFor,
  type ProcessSnapshot
} from '../../electron/services/envRegistryIdentity';
import { parsePsProcessList, type ProcessEntry } from '../../electron/services/processSweep';

// TASK-111, decision-60: вкладка процессов и сканер проектов сверяют запись реестра env-tools
// с временем создания процесса (правило decision-59), а не верят голому kill(pid, 0).

const T = Date.parse('2026-09-28T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const proc = (pid: number, createdAt: number): ProcessEntry => ({ pid, ppid: 1, createdAt });

describe('entryStatus (правило decision-59)', () => {
  const times = new Map<number, number | null>([
    [100, T],
    [200, null]
  ]);

  it('pidCreatedAt совпадает с временем создания в пределах допуска — running', () => {
    expect(entryStatus({ pid: 100, pidCreatedAt: T }, times)).toBe('running');
    expect(entryStatus({ pid: 100, pidCreatedAt: T + IDENTITY_TOLERANCE_MS }, times)).toBe('running');
  });

  it('pidCreatedAt не совпадает — pid переиспользован, dead', () => {
    expect(entryStatus({ pid: 100, pidCreatedAt: T - 3_600_000 }, times)).toBe('dead');
    expect(entryStatus({ pid: 100, pidCreatedAt: T + IDENTITY_TOLERANCE_MS + 1 }, times)).toBe('dead');
  });

  it('процесса нет в снимке или pid не задан — dead', () => {
    expect(entryStatus({ pid: 300, pidCreatedAt: T }, times)).toBe('dead');
    expect(entryStatus({}, times)).toBe('dead');
  });

  it('ОС не отдала время создания — unknown', () => {
    expect(entryStatus({ pid: 200, pidCreatedAt: T }, times)).toBe('unknown');
  });

  it('старая запись без pidCreatedAt: процесс создан позже записи — dead, иначе unknown', () => {
    expect(entryStatus({ pid: 100, startedAt: iso(T - 60_000) }, times)).toBe('dead');
    expect(entryStatus({ pid: 100, startedAt: iso(T) }, times)).toBe('unknown');
    expect(entryStatus({ pid: 100, startedAt: iso(T + 60_000) }, times)).toBe('unknown');
    expect(entryStatus({ pid: 100 }, times)).toBe('unknown');
  });
});

describe('startTimesFor / snapshotIsStaleFor', () => {
  it('берёт из снимка только запрошенные pid, createdAt 0 — время неизвестно', () => {
    const map = startTimesFor([proc(1, T), proc(2, 0), proc(3, T)], [1, 2, 4]);
    expect([...map]).toEqual([
      [1, T],
      [2, null]
    ]);
  });

  it('снимок устарел, если живого pid в нём нет или запись появилась не раньше снимка', () => {
    const snap: ProcessSnapshot = { entries: [proc(10, T - 60_000)], takenAt: T };
    expect(snapshotIsStaleFor([{ pid: 10, pidCreatedAt: T - 60_000 }], snap)).toBe(false);
    expect(snapshotIsStaleFor([{ pid: 10, startedAt: iso(T - 60_000) }], snap)).toBe(false);
    expect(snapshotIsStaleFor([{ pid: 11, pidCreatedAt: T - 60_000 }], snap)).toBe(true);
    expect(snapshotIsStaleFor([{ pid: 10, pidCreatedAt: T }], snap)).toBe(true);
    expect(snapshotIsStaleFor([{ pid: 10 }], snap)).toBe(true);
  });
});

describe('resolveEntryStatuses (один снимок на вызов)', () => {
  const alive = (pids: number[]) => (pid: number | undefined) => pid !== undefined && pids.includes(pid);

  it('без живых pid снимок не снимается', async () => {
    const snapshot = vi.fn();
    const statuses = await resolveEntryStatuses([{ pid: 1 }, { pid: 2 }, {}], { snapshot, isAlive: alive([]) });
    expect(statuses).toEqual(['dead', 'dead', 'dead']);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('все записи сверяются одним снимком, мёртвые pid в него не попадают', async () => {
    const snapshot = vi.fn(async () => ({ entries: [proc(1, T), proc(2, T), proc(3, 0)], takenAt: T + 10_000 }));
    const statuses = await resolveEntryStatuses(
      [
        { pid: 1, pidCreatedAt: T },
        { pid: 2, pidCreatedAt: T - 3_600_000 },
        { pid: 3, pidCreatedAt: T },
        { pid: 4, pidCreatedAt: T }
      ],
      { snapshot, isAlive: alive([1, 2, 3]) }
    );
    expect(statuses).toEqual(['running', 'dead', 'unknown', 'dead']);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith({ fresh: false });
  });

  it('кэшированный снимок старше записи заменяется свежим', async () => {
    const snapshot = vi.fn(async ({ fresh }: { fresh: boolean }) =>
      fresh ? { entries: [proc(5, T + 5_000)], takenAt: T + 6_000 } : { entries: [proc(5, T - 60_000)], takenAt: T }
    );
    const statuses = await resolveEntryStatuses([{ pid: 5, pidCreatedAt: T + 5_000 }], { snapshot, isAlive: alive([5]) });
    expect(statuses).toEqual(['running']);
    expect(snapshot.mock.calls).toEqual([[{ fresh: false }], [{ fresh: true }]]);
  });

  it('fresh — сразу свежий снимок', async () => {
    const snapshot = vi.fn(async () => ({ entries: [proc(5, T)], takenAt: T + 1 }));
    await resolveEntryStatuses([{ pid: 5, pidCreatedAt: T }], { snapshot, fresh: true, isAlive: alive([5]) });
    expect(snapshot.mock.calls).toEqual([[{ fresh: true }]]);
  });

  it('ошибка снимка: без strict живые pid — unknown, со strict — исключение с причиной', async () => {
    const boom = new Error('powershell не запустился');
    const snapshot = async () => {
      throw boom;
    };
    const entries = [{ pid: 1, pidCreatedAt: T }, { pid: 2 }];
    expect(await resolveEntryStatuses(entries, { snapshot, isAlive: alive([1]) })).toEqual(['unknown', 'dead']);
    const err = await resolveEntryStatuses(entries, { snapshot, strict: true, isAlive: alive([1]) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Не удалось проверить время старта процессов: powershell не запустился/);
    expect(err.cause).toBe(boom);
  });
});

describe('createSnapshotCache', () => {
  it('отдаёт снимок не старше maxAge, параллельные запросы делят один вызов, 0 — всегда новый', async () => {
    let now = T;
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      return [proc(calls, T)];
    });
    const cache = createSnapshotCache(fetch, () => now);

    const [a, b] = await Promise.all([cache.get(10_000), cache.get(10_000)]);
    expect(a).toBe(b);
    expect(a.takenAt).toBe(T);
    expect(fetch).toHaveBeenCalledTimes(1);

    now = T + 5_000;
    expect(await cache.get(10_000)).toBe(a);
    const fresh = await cache.get(0);
    expect(fresh.entries[0].pid).toBe(2);
    expect(await cache.get(10_000)).toBe(fresh);

    now = T + 16_000;
    expect((await cache.get(10_000)).entries[0].pid).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('ошибка не кэшируется', async () => {
    const fetch = vi
      .fn<() => Promise<ProcessEntry[]>>()
      .mockRejectedValueOnce(new Error('тайм-аут'))
      .mockResolvedValueOnce([proc(1, T)]);
    const cache = createSnapshotCache(fetch, () => T);
    await expect(cache.get(10_000)).rejects.toThrow('тайм-аут');
    expect((await cache.get(10_000)).entries).toEqual([proc(1, T)]);
  });
});

describe('parsePsProcessList (POSIX, ps -o pid=,ppid=,lstart=)', () => {
  it('разбирает pid, ppid и время старта; нечитаемое время — 0', () => {
    const out = parsePsProcessList(
      '    1     0 Mon Sep 28 10:00:00 2026\n' + '  4242     1 Mon Sep 28 10:05:07 2026\n' + '  77 1 garbage\n' + 'junk\n'
    );
    expect(out.map((e) => [e.pid, e.ppid])).toEqual([
      [1, 0],
      [4242, 1],
      [77, 1]
    ]);
    expect(out[1].createdAt - out[0].createdAt).toBe(307_000);
    expect(out[2].createdAt).toBe(0);
  });
});
