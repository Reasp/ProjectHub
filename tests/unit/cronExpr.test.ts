// Часовой пояс с переходами на летнее/зимнее время — до первого использования Date.
// Пул vitest — forks: смена TZ не задевает другие тестовые файлы.
process.env.TZ = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { CRON_GRACE_MS, CronParseError, cronWallKey, nextCronRun, parseCron, planCronTick, validateCron } from '../../electron/services/cronExpr';

/** cron для Automations (TASK-74, decision-52 п. 4): разбор, следующее срабатывание, DST, пропуски. */

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const on = (arr: boolean[]) => arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

describe('parseCron', () => {
  it('разбирает шаги, диапазоны и списки', () => {
    const c = parseCron('*/15 9-17 1,15 * 1-5');
    expect(on(c.minute)).toEqual([0, 15, 30, 45]);
    expect(on(c.hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(on(c.dayOfMonth)).toEqual([1, 15]);
    expect(on(c.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(c.dayOfMonthStar).toBe(false);
    expect(c.dayOfWeekStar).toBe(false);
  });

  it('понимает имена месяцев и дней, 7 — воскресенье, шаг от значения', () => {
    const c = parseCron('5/20 0 * JAN,mar sat-sun');
    expect(on(c.minute)).toEqual([5, 25, 45]);
    expect(on(c.month)).toEqual([1, 3]);
    expect(on(c.dayOfWeek)).toEqual([0, 6]);
    expect(on(parseCron('0 0 * * 7').dayOfWeek)).toEqual([0]);
  });

  it('раскрывает макросы', () => {
    expect(parseCron('@daily').source).toBe('0 0 * * *');
    expect(parseCron('@HOURLY').source).toBe('0 * * * *');
    expect(parseCron('@weekly').source).toBe('0 0 * * 0');
  });

  it('отклоняет неверные выражения с понятной причиной', () => {
    expect(() => parseCron('* * * *')).toThrow(CronParseError);
    expect(validateCron('* * * *')).toMatch(/5 полей/);
    expect(validateCron('60 * * * *')).toMatch(/минута.*вне диапазона/);
    expect(validateCron('*/0 * * * *')).toMatch(/шаг/);
    expect(validateCron('0 5-1 * * *')).toMatch(/задом наперёд/);
    expect(validateCron('@reboot')).toMatch(/макрос/);
    expect(validateCron('')).toMatch(/Пустое/);
    expect(validateCron('0 0 * foo *')).toMatch(/месяц/);
    expect(validateCron('*/5 * * * *')).toBeNull();
  });
});

describe('nextCronRun', () => {
  it('каждую минуту — следующая целая минута', () => {
    const next = nextCronRun(parseCron('* * * * *'), new Date(2026, 8, 27, 10, 0, 30));
    expect(next).toEqual(local(2026, 9, 27, 10, 1));
  });

  it('строго после текущего момента', () => {
    expect(nextCronRun(parseCron('0 9 * * *'), local(2026, 9, 27, 9, 0))).toEqual(local(2026, 9, 28, 9, 0));
  });

  it('рабочие дни: из пятницы — в понедельник', () => {
    // 2026-09-25 — пятница.
    expect(nextCronRun(parseCron('0 9 * * 1-5'), local(2026, 9, 25, 10, 0))).toEqual(local(2026, 9, 28, 9, 0));
  });

  it('день месяца ИЛИ день недели, если заданы оба', () => {
    // 13-е число или пятница: после 2026-11-01 первой будет пятница 6 ноября, потом 13-е.
    const cron = parseCron('0 0 13 * 5');
    const first = nextCronRun(cron, local(2026, 11, 1))!;
    expect(first).toEqual(local(2026, 11, 6));
    expect(nextCronRun(cron, local(2026, 11, 12, 1))).toEqual(local(2026, 11, 13));
  });

  it('29 февраля — через годы, 31 февраля — никогда', () => {
    expect(nextCronRun(parseCron('0 0 29 2 *'), local(2026, 3, 1))).toEqual(local(2028, 2, 29));
    expect(nextCronRun(parseCron('0 0 31 2 *'), local(2026, 3, 1))).toBeNull();
  });

  it('переход на летнее время: несуществующая минута пропускается', () => {
    // 2026-03-29 в Берлине 02:00 → 03:00: 02:30 в этот день нет.
    const next = nextCronRun(parseCron('30 2 * * *'), local(2026, 3, 28, 3, 0));
    expect(next).toEqual(local(2026, 3, 30, 2, 30));
  });

  it('переход на зимнее время: повторный час не даёт второго срабатывания', () => {
    // 2026-10-25 в Берлине 03:00 → 02:00: 02:30 наступает дважды, запуск — один.
    const cron = parseCron('30 2 * * *');
    const first = nextCronRun(cron, local(2026, 10, 25, 0, 0))!;
    expect(first.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    const second = nextCronRun(cron, first)!;
    expect(cronWallKey(second)).toBe('2026-10-26 02:30');

    // Поминутное правило через границу тоже не повторяет метки минут.
    const every = parseCron('* * * * *');
    const keys = new Set<string>();
    let at = new Date('2026-10-25T00:55:00.000Z');
    for (let i = 0; i < 90; i += 1) {
      at = nextCronRun(every, at)!;
      const key = cronWallKey(at);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });
});

describe('planCronTick', () => {
  const cron = parseCron('*/10 * * * *');

  it('без запланированного срабатывания только планирует', () => {
    const d = planCronTick({ cron, now: local(2026, 9, 27, 10, 3), catchUp: 'skip' });
    expect(d.fire).toBe(false);
    expect(d.nextRunAt).toBe(local(2026, 9, 27, 10, 10).getTime());
  });

  it('до срока — ждёт, в пределах допуска — запускает и планирует следующее', () => {
    const due = local(2026, 9, 27, 10, 10).getTime();
    expect(planCronTick({ cron, now: new Date(due - 1000), nextRunAt: due, catchUp: 'skip' }).fire).toBe(false);
    const d = planCronTick({ cron, now: new Date(due + 20_000), nextRunAt: due, catchUp: 'skip' });
    expect(d).toMatchObject({ fire: true, missed: false, wallKey: '2026-09-27 10:10' });
    expect(d.nextRunAt).toBe(local(2026, 9, 27, 10, 20).getTime());
  });

  it('пропущенное срабатывание: skip — не запускает, once — один запуск, следующее от «сейчас»', () => {
    const due = local(2026, 9, 27, 10, 10).getTime();
    const now = new Date(due + CRON_GRACE_MS + 3 * 60 * 60 * 1000);
    const skip = planCronTick({ cron, now, nextRunAt: due, catchUp: 'skip' });
    expect(skip).toMatchObject({ fire: false, missed: true });
    expect(skip.nextRunAt).toBe(local(2026, 9, 27, 13, 20).getTime());
    const once = planCronTick({ cron, now, nextRunAt: due, catchUp: 'once' });
    expect(once).toMatchObject({ fire: true, missed: true });
    expect(once.nextRunAt).toBe(skip.nextRunAt);
  });

  it('не запускает дважды в одну минуту', () => {
    const due = local(2026, 9, 27, 10, 10).getTime();
    const d = planCronTick({ cron, now: new Date(due + 1000), nextRunAt: due, lastWallKey: '2026-09-27 10:10', catchUp: 'skip' });
    expect(d.fire).toBe(false);
  });
});
