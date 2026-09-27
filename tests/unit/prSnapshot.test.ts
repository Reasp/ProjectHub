import { describe, expect, it } from 'vitest';
import { diffPrSnapshot, parseGhPrList, type PrInfo } from '../../electron/services/prSnapshot';

/** Снимок PR для событий pr:opened / pr:updated (TASK-81, decision-53 п. 1). */

const pr = (number: number, headSha: string, draft = false): PrInfo => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  headSha,
  headRef: `feat/${number}`,
  baseRef: 'main',
  draft
});

describe('parseGhPrList', () => {
  it('разбирает вывод gh и пропускает записи без номера или головы', () => {
    const raw = JSON.stringify([
      { number: 7, title: 'Фича', url: 'u', headRefOid: 'abc', headRefName: 'feat/task-3', baseRefName: 'main', isDraft: true, author: { login: 'ivan' } },
      { number: 'x', headRefOid: 'def' },
      { number: 8, title: '', headRefOid: '' }
    ]);
    expect(parseGhPrList(raw)).toEqual([
      { number: 7, title: 'Фича', url: 'u', headSha: 'abc', headRef: 'feat/task-3', baseRef: 'main', draft: true, author: 'ivan' }
    ]);
    expect(parseGhPrList('не json')).toEqual([]);
    expect(parseGhPrList('{}')).toEqual([]);
  });
});

describe('diffPrSnapshot', () => {
  it('первый опрос — базовая линия без событий', () => {
    const { changes, next } = diffPrSnapshot(undefined, [pr(1, 'a'), pr(2, 'b')], 100);
    expect(changes).toEqual([]);
    expect(next).toEqual({ prs: { '1': { headSha: 'a', draft: false }, '2': { headSha: 'b', draft: false } }, baselineAt: 100, updatedAt: 100 });
  });

  it('новый номер — opened, другой SHA — updated, черновик стал готовым — updated', () => {
    const prev = diffPrSnapshot(undefined, [pr(1, 'a'), pr(2, 'b', true)], 100).next;
    const { changes, next } = diffPrSnapshot(prev, [pr(1, 'a2'), pr(2, 'b'), pr(3, 'c')], 200);
    expect(changes.map((c) => [c.kind, c.reason, c.pr.number, c.previousSha])).toEqual([
      ['updated', 'commits', 1, 'a'],
      ['updated', 'ready', 2, 'b'],
      ['opened', 'new', 3, undefined]
    ]);
    expect(next.baselineAt).toBe(100);
  });

  it('без изменений и закрытые PR — без событий; снова открытый — opened', () => {
    const prev = diffPrSnapshot(undefined, [pr(1, 'a'), pr(2, 'b')], 100).next;
    const closed = diffPrSnapshot(prev, [pr(1, 'a')], 200);
    expect(closed.changes).toEqual([]);
    expect(closed.next.prs['2']).toBeUndefined();
    expect(diffPrSnapshot(closed.next, [pr(1, 'a'), pr(2, 'b')], 300).changes.map((c) => c.kind)).toEqual(['opened']);
  });
});
