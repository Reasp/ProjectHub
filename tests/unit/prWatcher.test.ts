import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppBusEvent } from '../../electron/services/hitlTypes';
import { PR_POLL_INTERVAL_MS, PrWatcher, prPollBackoffMs } from '../../electron/services/prWatcher';
import type { PrInfo } from '../../electron/services/prSnapshot';

/** Опрос PR (TASK-81, decision-53 п. 1): базовая линия, события, снимок на диске, пауза при ошибках. */

const ROOT = 'C:/Work/app';
let dir: string;
const pr = (number: number, headSha: string, draft = false): PrInfo => ({ number, title: `PR ${number}`, url: `u${number}`, headSha, headRef: `feat/${number}`, baseRef: 'main', draft });

function makeWatcher(state: { prs: PrInfo[] | Error; now: number }, events: AppBusEvent[], logs: string[]) {
  return new PrWatcher({
    listOpenPrs: async () => {
      if (state.prs instanceof Error) throw state.prs;
      return state.prs;
    },
    publish: (e) => events.push(e),
    stateDir: dir,
    now: () => state.now,
    log: (level, message) => logs.push(`${level}: ${message}`)
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-prwatch-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('PrWatcher', () => {
  it('первый опрос — базовая линия; затем opened и updated; снимок переживает перезапуск', async () => {
    const state: { prs: PrInfo[] | Error; now: number } = { prs: [pr(1, 'a')], now: 1000 };
    const events: AppBusEvent[] = [];
    const logs: string[] = [];
    const w = makeWatcher(state, events, logs);
    w.setProjects([ROOT]);
    await w.pollAll();
    expect(events).toEqual([]);

    state.prs = [pr(1, 'a2'), pr(2, 'b')];
    await w.pollAll();
    expect(events.map((e) => [e.type, 'number' in e ? e.number : 0])).toEqual([
      ['pr:updated', 1],
      ['pr:opened', 2]
    ]);
    expect(events[0]).toMatchObject({ projectPath: ROOT, headSha: 'a2', previousSha: 'a', reason: 'commits' });
    w.stop();

    // «Приложение закрыто»: пока его не было, открылся PR 3 — новый наблюдатель видит его по снимку.
    state.prs = [pr(1, 'a2'), pr(2, 'b'), pr(3, 'c')];
    const events2: AppBusEvent[] = [];
    const w2 = makeWatcher(state, events2, logs);
    w2.setProjects([ROOT]);
    await w2.pollAll();
    expect(events2.map((e) => e.type)).toEqual(['pr:opened']);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'pr-watch.json'), 'utf8')).projects).toBeTruthy();
    w2.stop();
  });

  it('ошибка gh ставит проект на паузу с одной записью в лог, восстановление — снова опрос', async () => {
    const state: { prs: PrInfo[] | Error; now: number } = { prs: new Error('gh: command not found'), now: 1000 };
    const events: AppBusEvent[] = [];
    const logs: string[] = [];
    const w = makeWatcher(state, events, logs);
    w.setProjects([ROOT]);
    await w.pollAll();
    await w.pollAll();
    expect(w.status(ROOT)).toMatchObject({ paused: true, lastError: 'gh: command not found' });
    state.now += PR_POLL_INTERVAL_MS + 1;
    await w.pollAll();
    expect(logs.filter((l) => l.startsWith('warn'))).toHaveLength(1);
    expect(prPollBackoffMs(1)).toBe(PR_POLL_INTERVAL_MS);
    expect(prPollBackoffMs(2)).toBe(PR_POLL_INTERVAL_MS * 2);
    expect(prPollBackoffMs(10)).toBe(30 * 60 * 1000);

    state.prs = [pr(1, 'a')];
    state.now += 60 * 60 * 1000;
    await w.pollAll();
    expect(w.status(ROOT)).toMatchObject({ paused: false, knownPrs: 1 });
    expect(logs.some((l) => l.includes('восстановлен'))).toBe(true);
    w.setProjects([]);
  });
});
