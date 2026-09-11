import { describe, expect, it } from 'vitest';
import {
  parseAssignee,
  formatAgentAssignee,
  isAgentAssignee,
  resolveAssigneeTarget
} from '../../src/utils/assignee';

/**
 * Разбор `assignee` задачи (TASK-66, AC #6): `agent:<role>[@<hostId>]` против имени человека.
 * Ключевой случай — у человека `@` часть имени (`veshiy666@gmail.com`), и хвост после `@`
 * НЕ является `hostId`.
 */
describe('parseAssignee', () => {
  it('пустое значение — null', () => {
    expect(parseAssignee('')).toBeNull();
    expect(parseAssignee('   ')).toBeNull();
    expect(parseAssignee(null)).toBeNull();
    expect(parseAssignee(undefined)).toBeNull();
  });

  it('агент без хоста', () => {
    expect(parseAssignee('agent:implementer')).toEqual({
      kind: 'agent',
      roleSlug: 'implementer',
      raw: 'agent:implementer'
    });
  });

  it('агент с хостом федерации', () => {
    expect(parseAssignee('agent:reviewer@ph_host_a1b2c3d4e5f6')).toEqual({
      kind: 'agent',
      roleSlug: 'reviewer',
      hostId: 'ph_host_a1b2c3d4e5f6',
      raw: 'agent:reviewer@ph_host_a1b2c3d4e5f6'
    });
  });

  it('обрезает пробелы вокруг значения и частей', () => {
    const parsed = parseAssignee('  agent: tester @ ph_host_x1  ');
    expect(parsed).toMatchObject({ kind: 'agent', roleSlug: 'tester', hostId: 'ph_host_x1' });
  });

  it('человек с почтой не превращается в агента и не отдаёт домен как hostId', () => {
    expect(parseAssignee('@veshiy666@gmail.com')).toEqual({
      kind: 'human',
      name: 'veshiy666@gmail.com',
      raw: '@veshiy666@gmail.com'
    });
  });

  it('человек без собаки', () => {
    expect(parseAssignee('Иван')).toEqual({ kind: 'human', name: 'Иван', raw: 'Иван' });
  });

  it('agent: без роли — невалидно', () => {
    expect(parseAssignee('agent:')).toMatchObject({ kind: 'invalid', reason: 'empty-role' });
  });

  it('роль не по формату slug — невалидно, а не «человек»', () => {
    expect(parseAssignee('agent:Implementer')).toMatchObject({ kind: 'invalid', reason: 'bad-role' });
    expect(parseAssignee('agent:my role')).toMatchObject({ kind: 'invalid', reason: 'bad-role' });
  });

  it('пустой или мусорный хост после @ — невалидно', () => {
    expect(parseAssignee('agent:tester@')).toMatchObject({ kind: 'invalid', reason: 'bad-host' });
    expect(parseAssignee('agent:tester@host id')).toMatchObject({ kind: 'invalid', reason: 'bad-host' });
  });
});

describe('formatAgentAssignee / isAgentAssignee', () => {
  it('собирает каноничное значение', () => {
    expect(formatAgentAssignee('implementer')).toBe('agent:implementer');
    expect(formatAgentAssignee('implementer', 'ph_host_1')).toBe('agent:implementer@ph_host_1');
  });

  it('round-trip разбора и сборки', () => {
    const raw = formatAgentAssignee('doc-writer', 'ph_host_deadbeef');
    expect(parseAssignee(raw)).toMatchObject({ kind: 'agent', roleSlug: 'doc-writer', hostId: 'ph_host_deadbeef' });
  });

  it('isAgentAssignee отличает агента от человека и мусора', () => {
    expect(isAgentAssignee('agent:tester')).toBe(true);
    expect(isAgentAssignee('@veshiy666@gmail.com')).toBe(false);
    expect(isAgentAssignee('agent:')).toBe(false);
  });
});

describe('resolveAssigneeTarget', () => {
  const local = 'ph_host_local1';

  it('без хоста — локальный запуск', () => {
    expect(resolveAssigneeTarget('agent:implementer', local)).toEqual({
      target: 'local',
      roleSlug: 'implementer',
      hostId: undefined
    });
  });

  it('свой hostId — локальный запуск', () => {
    expect(resolveAssigneeTarget(`agent:implementer@${local}`, local)).toMatchObject({
      target: 'local',
      hostId: local
    });
  });

  it('чужой hostId — удалённый запуск', () => {
    expect(resolveAssigneeTarget('agent:implementer@ph_host_other', local)).toEqual({
      target: 'remote',
      roleSlug: 'implementer',
      hostId: 'ph_host_other'
    });
  });

  it('человек или мусор — никого не запускаем', () => {
    expect(resolveAssigneeTarget('@ivan', local)).toEqual({ target: 'none' });
    expect(resolveAssigneeTarget('agent:', local)).toEqual({ target: 'none' });
    expect(resolveAssigneeTarget('', local)).toEqual({ target: 'none' });
  });
});
