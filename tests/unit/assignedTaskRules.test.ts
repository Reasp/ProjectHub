import { describe, expect, it } from 'vitest';
import { decideAutoStart, AUTO_START_COOLDOWN_MS } from '../../electron/services/assignedTaskRules';

/**
 * Автозапуск задач, назначенных на хост (TASK-66, AC #3/#6, decision-11 п.5). Это единственное
 * место, где агент стартует без нажатия человека, поэтому каждое условие проверяется отдельно.
 */

const LOCAL = 'ph_host_local1';

function input(overrides: Partial<Parameters<typeof decideAutoStart>[0]> = {}) {
  return {
    enabled: true,
    assignee: `agent:implementer@${LOCAL}`,
    taskStatus: 'To Do',
    localHostId: LOCAL,
    hasActiveSwarm: false,
    lastStartedAt: 0,
    now: 1_000_000,
    ...overrides
  };
}

describe('decideAutoStart', () => {
  it('запускает агента по назначению на этот хост', () => {
    expect(decideAutoStart(input())).toEqual({ start: true, reason: 'ok', roleSlug: 'implementer' });
  });

  it('выключенная настройка блокирует всё', () => {
    expect(decideAutoStart(input({ enabled: false }))).toMatchObject({ start: false, reason: 'disabled' });
  });

  it('назначение без явного хоста НЕ запускается автоматически (иначе стартует на всех машинах)', () => {
    expect(decideAutoStart(input({ assignee: 'agent:implementer' }))).toMatchObject({
      start: false,
      reason: 'no-explicit-host'
    });
  });

  it('назначение на другой хост игнорируется', () => {
    expect(decideAutoStart(input({ assignee: 'agent:implementer@ph_host_other' }))).toMatchObject({
      start: false,
      reason: 'other-host'
    });
  });

  it('задача, назначенная человеку, не трогается', () => {
    expect(decideAutoStart(input({ assignee: '@veshiy666@gmail.com' }))).toMatchObject({
      start: false,
      reason: 'not-assigned-to-agent'
    });
    expect(decideAutoStart(input({ assignee: '' }))).toMatchObject({ start: false, reason: 'not-assigned-to-agent' });
  });

  it('запускается только в рабочих статусах', () => {
    expect(decideAutoStart(input({ taskStatus: 'In Progress' })).start).toBe(true);
    expect(decideAutoStart(input({ taskStatus: 'Review' }))).toMatchObject({ start: false, reason: 'status-not-runnable' });
    expect(decideAutoStart(input({ taskStatus: 'Done' }))).toMatchObject({ start: false, reason: 'status-not-runnable' });
    expect(decideAutoStart(input({ taskStatus: 'Draft' }))).toMatchObject({ start: false, reason: 'status-not-runnable' });
  });

  it('не запускает второго агента, если по задаче уже работает рой', () => {
    expect(decideAutoStart(input({ hasActiveSwarm: true }))).toMatchObject({ start: false, reason: 'already-running' });
  });

  it('соблюдает паузу между автозапусками одной задачи', () => {
    const now = 1_000_000;
    expect(decideAutoStart(input({ now, lastStartedAt: now - 1000 }))).toMatchObject({ start: false, reason: 'cooldown' });
    expect(decideAutoStart(input({ now, lastStartedAt: now - AUTO_START_COOLDOWN_MS - 1 })).start).toBe(true);
  });
});
