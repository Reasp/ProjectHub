import { describe, expect, it } from 'vitest';
import { AGENT_LOG_LIMITS, appendLiveOutput, pushAgentLog, resetLiveOutput } from '../../electron/services/swarmLogBuffer';

describe('swarmLogBuffer (TASK-56): кольцевые буферы агента', () => {
  it('pushAgentLog вытесняет старые строки по числу строк и считает вытесненные', () => {
    const target = { logs: [] as string[] };
    const limits = { ...AGENT_LOG_LIMITS, maxLines: 3 };
    for (let i = 1; i <= 5; i++) pushAgentLog(target, `line-${i}`, limits);
    expect(target.logs).toEqual(['line-3', 'line-4', 'line-5']);
    expect(target.logsDropped).toBe(2);
  });

  it('pushAgentLog вытесняет по байтам и усекает одну гигантскую строку', () => {
    const target = { logs: [] as string[] };
    const limits = { ...AGENT_LOG_LIMITS, maxLines: 1000, maxBytes: 100 };
    pushAgentLog(target, 'a'.repeat(60), limits);
    pushAgentLog(target, 'b'.repeat(60), limits);
    expect(target.logs).toEqual(['b'.repeat(60)]);
    expect(target.logsDropped).toBe(1);

    pushAgentLog(target, 'c'.repeat(1000), limits);
    expect(target.logs).toHaveLength(1);
    expect(target.logs[0].startsWith('…[усечено]')).toBe(true);
    expect(Buffer.byteLength(target.logs[0])).toBeLessThanOrEqual(limits.maxBytes);
  });

  it('pushAgentLog корректно учитывает байты массива, заполненного до первого вызова (восстановленная сессия)', () => {
    const target = { logs: ['x'.repeat(80)] };
    const limits = { ...AGENT_LOG_LIMITS, maxLines: 1000, maxBytes: 100 };
    pushAgentLog(target, 'y'.repeat(50), limits);
    expect(target.logs).toEqual(['y'.repeat(50)]);
  });

  it('appendLiveOutput хранит только хвост и ставит флаг усечения; resetLiveOutput сбрасывает', () => {
    const target = { liveOutput: '' };
    const limits = { ...AGENT_LOG_LIMITS, maxLiveOutputChars: 10 };
    appendLiveOutput(target, '12345', limits);
    expect(target.liveOutput).toBe('12345');
    expect(target.liveOutputTruncated).toBeUndefined();
    appendLiveOutput(target, '67890ABCDEF', limits);
    expect(target.liveOutput).toBe('7890ABCDEF');
    expect(target.liveOutputTruncated).toBe(true);
    appendLiveOutput(target, '', limits);
    expect(target.liveOutput).toBe('7890ABCDEF');
    resetLiveOutput(target);
    expect(target.liveOutput).toBe('');
    expect(target.liveOutputTruncated).toBe(false);
  });
});
