import { describe, expect, it } from 'vitest';
import { EXTERNAL_DECISION_SOURCE_KINDS, normalizeDecisionSource } from '../../electron/services/hitlPolicy';

/**
 * TASK-86: источник решения, пришедший из IPC или по сети, не должен подменяться на `local`.
 * Журнал HITL — доказательство того, кто разрешил опасное действие (decision-10 п. 4, decision-27
 * п. 4), поэтому автоматический путь обязан отличаться от человека в окне ProjectHub.
 */
describe('normalizeDecisionSource (TASK-86)', () => {
  it('источник не указан — это вызов из окна ProjectHub', () => {
    expect(normalizeDecisionSource(undefined)).toEqual({ kind: 'local' });
    expect(normalizeDecisionSource(null)).toEqual({ kind: 'local' });
    expect(normalizeDecisionSource({})).toEqual({ kind: 'local' });
  });

  it('внешние источники проходят с устройством, лишние пробелы срезаются', () => {
    expect(normalizeDecisionSource({ kind: 'remote', deviceId: 'dev-1', deviceName: 'Phone' })).toEqual({
      kind: 'remote',
      deviceId: 'dev-1',
      deviceName: 'Phone'
    });
    expect(normalizeDecisionSource({ kind: 'mcp', deviceName: '  MCP-клиент  ' })).toEqual({
      kind: 'mcp',
      deviceId: undefined,
      deviceName: 'MCP-клиент'
    });
  });

  it('автоматика не может назвать себя внешним источником — решение не применяется', () => {
    expect(normalizeDecisionSource({ kind: 'auto', rule: 'computer-allowlist' })).toBeNull();
    expect(normalizeDecisionSource({ kind: 'timeout' })).toBeNull();
    expect(normalizeDecisionSource({ kind: 'cancelled' })).toBeNull();
    expect(normalizeDecisionSource({ kind: 'shutdown' })).toBeNull();
  });

  it('мусорные значения отклоняются, а не превращаются в local', () => {
    expect(normalizeDecisionSource({ kind: 'LOCAL' })).toBeNull();
    expect(normalizeDecisionSource({ kind: '' })).toBeNull();
    expect(normalizeDecisionSource({ kind: 42 })).toBeNull();
    expect(normalizeDecisionSource('local')).toBeNull();
    expect(normalizeDecisionSource(7)).toBeNull();
  });

  it('имя авто-правила не протекает во внешний источник', () => {
    const source = normalizeDecisionSource({ kind: 'local', rule: 'auto-write' });
    expect(source).toEqual({ kind: 'local', deviceId: undefined, deviceName: undefined });
    expect(source && 'rule' in source && source.rule).toBeFalsy();
  });

  it('список внешних источников не включает источники самого сервиса', () => {
    expect([...EXTERNAL_DECISION_SOURCE_KINDS]).toEqual(['local', 'remote', 'mcp']);
  });
});
