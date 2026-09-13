import { describe, it, expect } from 'vitest';
import {
  matchStatus,
  isKnownStatus,
  normalizeStatusKey,
  fallbackColumnStatus,
  resolveDoneStatus,
  countStatuses,
  toLegacyTaskCounts,
  statusVisual,
  statusLabel,
  statusOptions,
  DEFAULT_TASK_STATUSES
} from '../../src/utils/taskStatus';

const LABELS = { todo: 'К выполнению', inProgress: 'В работе', review: 'На проверке', done: 'Готово' };
const CUSTOM = ['To Do', 'In Progress', 'Blocked', 'Review', 'Done'];

describe('matchStatus', () => {
  it('сопоставляет без учёта регистра и лишних пробелов, возвращая написание конфига', () => {
    expect(matchStatus(CUSTOM, 'in progress')).toBe('In Progress');
    expect(matchStatus(CUSTOM, '  Done ')).toBe('Done');
    expect(matchStatus(CUSTOM, 'To   Do')).toBe('To Do');
  });

  it('неизвестный и пустой статус не сопоставляется', () => {
    expect(matchStatus(CUSTOM, 'Testing')).toBeUndefined();
    expect(matchStatus(CUSTOM, '')).toBeUndefined();
    expect(matchStatus(CUSTOM, undefined)).toBeUndefined();
    expect(isKnownStatus(CUSTOM, 'Testing')).toBe(false);
  });

  it('normalizeStatusKey схлопывает пробелы и регистр', () => {
    expect(normalizeStatusKey('  In    Progress ')).toBe('in progress');
    expect(normalizeStatusKey(null)).toBe('');
  });
});

describe('fallbackColumnStatus / resolveDoneStatus', () => {
  it('колонка по умолчанию — default_status проекта', () => {
    expect(fallbackColumnStatus({ statuses: CUSTOM, defaultStatus: 'Blocked', fromConfig: true })).toBe('Blocked');
  });

  it('если default_status не из набора, берётся первый статус', () => {
    expect(fallbackColumnStatus({ statuses: ['Idea', 'Done'], defaultStatus: 'To Do', fromConfig: true })).toBe('Idea');
  });

  it('завершающий статус — Done, иначе последний в списке', () => {
    expect(resolveDoneStatus(CUSTOM)).toBe('Done');
    expect(resolveDoneStatus(['Idea', 'Building', 'Shipped'])).toBe('Shipped');
    expect(resolveDoneStatus([])).toBeUndefined();
  });
});

describe('countStatuses', () => {
  it('считает по набору конфига, неизвестные — в other, total включает всех', () => {
    const counts = countStatuses(CUSTOM, ['To Do', 'blocked', 'Done', 'Testing', undefined]);
    expect(counts.total).toBe(5);
    // undefined трактуется как статус по умолчанию To Do
    expect(counts.byStatus['To Do']).toBe(2);
    expect(counts.byStatus['Blocked']).toBe(1);
    expect(counts.byStatus['Done']).toBe(1);
    expect(counts.other).toBe(1);
  });

  it('все статусы набора присутствуют в byStatus даже при нулевом количестве', () => {
    const counts = countStatuses(CUSTOM, []);
    expect(Object.keys(counts.byStatus)).toEqual(CUSTOM);
    expect(counts.total).toBe(0);
  });
});

describe('toLegacyTaskCounts', () => {
  it('раскладывает по четырём историческим полям и агрегату прочих', () => {
    const counts = toLegacyTaskCounts(
      countStatuses(CUSTOM, ['To Do', 'In Progress', 'Review', 'Done', 'Blocked', 'Testing']),
      CUSTOM
    );
    expect(counts).toEqual({ total: 6, todo: 1, inProgress: 1, review: 1, done: 1, other: 2 });
  });

  it('сумма полей всегда равна total даже без стандартных статусов в конфиге', () => {
    const statuses = ['Idea', 'Shipped'];
    const counts = toLegacyTaskCounts(countStatuses(statuses, ['Idea', 'Shipped', 'Shipped']), statuses);
    expect(counts).toEqual({ total: 3, todo: 0, inProgress: 0, review: 0, done: 0, other: 3 });
  });
});

describe('statusVisual', () => {
  it('четыре стандартных статуса сохраняют прежние цвета', () => {
    expect(statusVisual('To Do').dot).toBe('bg-slate-400');
    expect(statusVisual('In Progress').dot).toBe('bg-amber-400');
    expect(statusVisual('Review').dot).toBe('bg-indigo-400');
    expect(statusVisual('Done').dot).toBe('bg-emerald-400');
    expect(statusVisual('done').badge).toBe(statusVisual('Done').badge);
  });

  it('кастомный статус получает стабильный цвет, не зависящий от позиции в наборе', () => {
    const first = statusVisual('Blocked');
    expect(statusVisual('blocked')).toEqual(first);
    expect(statusVisual('Blocked')).toEqual(first);
    expect(first.dot).toBeTruthy();
  });
});

describe('statusLabel / statusOptions', () => {
  it('стандартные статусы переводятся, кастомные выводятся как есть', () => {
    expect(statusLabel('To Do', LABELS)).toBe('К выполнению');
    expect(statusLabel('done', LABELS)).toBe('Готово');
    expect(statusLabel('Blocked', LABELS)).toBe('Blocked');
  });

  it('в варианты select добавляется текущий кастомный статус, чтобы он не потерялся', () => {
    expect(statusOptions(CUSTOM, 'Testing')).toEqual(['Testing', ...CUSTOM]);
    expect(statusOptions(CUSTOM, 'done')).toEqual(CUSTOM);
    expect(statusOptions(CUSTOM, undefined)).toEqual(CUSTOM);
  });

  it('набор по умолчанию — четыре статуса Backlog.md', () => {
    expect([...DEFAULT_TASK_STATUSES]).toEqual(['To Do', 'In Progress', 'Review', 'Done']);
  });
});
