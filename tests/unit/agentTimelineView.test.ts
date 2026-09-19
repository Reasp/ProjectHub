import { describe, expect, it } from 'vitest';
import { buildAgentTimeline, finalizeTraceEvent } from '../../electron/services/agentTrace';
import type { AgentTraceEvent } from '../../electron/services/agentTraceTypes';
import type { AgentTimeline } from '../../src/types/electron';
import {
  MIN_SEGMENT_PCT,
  TIMELINE_FILTER_ALL,
  checkpointPointLabel,
  checkpointsNewestFirst,
  filterTimelineTools,
  formatChars,
  formatSpan,
  layoutTimelineScale,
  timelineTableRows,
  turnUsage
} from '../../src/lib/agentTimelineView';

/** Таймлайн: запуск 0–1000 мс, ход 1 (Read 100–200, Bash 300–310), ход 2 (Read 600–900). */
function sample(): AgentTimeline {
  const ev: AgentTraceEvent[] = [
    finalizeTraceEvent({ type: 'run_start', engine: 'claude-cli', promptChars: 1 }, 1, 0),
    finalizeTraceEvent({ type: 'turn_start', turn: 1 }, 1, 0),
    finalizeTraceEvent({ type: 'tool_call', turn: 1, toolId: 'a', name: 'Read' }, 1, 100),
    finalizeTraceEvent({ type: 'tool_result', turn: 1, toolId: 'a', ok: true, outputChars: 12_345, durationMs: 100 }, 1, 200),
    finalizeTraceEvent({ type: 'tool_call', turn: 1, toolId: 'b', name: 'Bash' }, 1, 300),
    finalizeTraceEvent({ type: 'tool_result', turn: 1, toolId: 'b', ok: false, outputChars: 3, durationMs: 1 }, 1, 301),
    finalizeTraceEvent({ type: 'turn_start', turn: 2 }, 1, 500),
    finalizeTraceEvent({ type: 'tool_call', turn: 2, toolId: 'c', name: 'Read' }, 1, 600),
    finalizeTraceEvent({ type: 'tool_result', turn: 2, toolId: 'c', ok: true, outputChars: 5, durationMs: 300 }, 1, 900),
    finalizeTraceEvent(
      { type: 'usage', scope: 'run', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.2 } },
      1,
      1000
    ),
    finalizeTraceEvent({ type: 'run_end', status: 'completed', durationMs: 1000 }, 1, 1000)
  ];
  return buildAgentTimeline(ev) as unknown as AgentTimeline;
}

describe('agentTimelineView (TASK-72)', () => {
  it('фильтр по инструменту и строки таблицы', () => {
    const tl = sample();
    expect(filterTimelineTools(tl, TIMELINE_FILTER_ALL)).toHaveLength(3);
    expect(filterTimelineTools(tl, 'Bash').map((t) => t.toolId)).toEqual(['b']);
    expect(timelineTableRows(tl, TIMELINE_FILTER_ALL).map((r) => r.key)).toEqual(['turn-1', 'tool-a', 'tool-b', 'turn-2', 'tool-c']);
    // ход 2 без Bash выпадает из таблицы
    expect(timelineTableRows(tl, 'Bash').map((r) => r.key)).toEqual(['turn-1', 'tool-b']);
  });

  it('шкала: проценты от окна, минимальная ширина, фильтр оставляет ходы фоном', () => {
    const tl = sample();
    const [row] = layoutTimelineScale(tl, TIMELINE_FILTER_ALL);
    const read = row.segments.find((s) => s.key === 'tool-a')!;
    expect(read).toMatchObject({ leftPct: 10, widthPct: 10, status: 'ok' });
    const bash = row.segments.find((s) => s.key === 'tool-b')!;
    expect(bash.widthPct).toBe(MIN_SEGMENT_PCT);
    expect(bash.status).toBe('error');
    const turn2 = row.segments.find((s) => s.key === 'turn-2')!;
    expect(turn2).toMatchObject({ leftPct: 50, widthPct: 50 });
    const filtered = layoutTimelineScale(tl, 'Bash')[0].segments.map((s) => s.key);
    expect(filtered).toEqual(['turn-1', 'tool-b', 'turn-2']);
    expect(layoutTimelineScale({ ...tl, startedAt: undefined }, TIMELINE_FILTER_ALL)).toEqual([]);
  });

  it('несколько запусков: разделитель в таблице, у каждого запуска своё окно шкалы, фон ходов чередуется', () => {
    const ev: AgentTraceEvent[] = [
      finalizeTraceEvent({ type: 'run_start', engine: 'api', promptChars: 1 }, 1, 0),
      finalizeTraceEvent({ type: 'turn_start', turn: 1 }, 1, 0),
      finalizeTraceEvent({ type: 'turn_start', turn: 2 }, 1, 50),
      finalizeTraceEvent({ type: 'run_end', status: 'completed', durationMs: 100 }, 1, 100),
      finalizeTraceEvent({ type: 'run_start', engine: 'api', afterRewind: true, promptChars: 1 }, 2, 10_000),
      finalizeTraceEvent({ type: 'turn_start', turn: 3 }, 2, 10_000),
      finalizeTraceEvent({ type: 'tool_call', turn: 3, toolId: 'x', name: 'Read' }, 2, 10_500),
      finalizeTraceEvent({ type: 'tool_result', turn: 3, toolId: 'x', ok: true, outputChars: 1, durationMs: 500 }, 2, 11_000),
      finalizeTraceEvent({ type: 'run_end', status: 'completed', durationMs: 2000 }, 2, 12_000)
    ];
    const tl = buildAgentTimeline(ev) as unknown as AgentTimeline;
    expect(timelineTableRows(tl, TIMELINE_FILTER_ALL).map((r) => r.key)).toEqual(['run-1', 'turn-1', 'turn-2', 'run-2', 'turn-3', 'tool-x']);
    const [r1, r2] = layoutTimelineScale(tl, TIMELINE_FILTER_ALL);
    expect(r1.segments.map((s) => [s.key, s.leftPct, s.widthPct, s.odd])).toEqual([
      ['turn-1', 0, 50, false],
      ['turn-2', 50, 50, true]
    ]);
    expect(r2.segments.find((s) => s.key === 'tool-x')).toMatchObject({ leftPct: 25, widthPct: 25 });
  });

  it('usage хода: собственный или usage запуска с единственным ходом', () => {
    const tl = sample();
    expect(turnUsage(tl, tl.turns[0])).toBeUndefined();
    const single = { ...tl, runs: [{ ...tl.runs[0], turns: [1] }] };
    expect(turnUsage(single, tl.turns[0])?.costUsd).toBe(0.2);
  });

  it('форматирование и подписи чекпоинтов', () => {
    expect(formatChars(950)).toBe('950');
    expect(formatChars(12_345)).toBe('12K');
    expect(formatChars(2_500)).toBe('2.5K');
    expect(formatChars(2_500_000)).toBe('2.5M');
    expect(formatSpan(85)).toBe('85 ms');
    expect(formatSpan(1500)).toBe('1.5 s');
    expect(formatSpan(125_000)).toBe('2:05');
    expect(formatSpan(undefined)).toBe('—');
    expect(formatSpan(85, { ms: 'мс', s: 'с' })).toBe('85 мс');
    expect(formatSpan(26_466, { ms: 'мс', s: 'с' })).toBe('26.5 с');
    const labels = { start: 'перед запуском {run}', turn: 'после хода {turn}', end: 'после запуска {run}', pre_rewind: 'перед откатом' };
    expect(checkpointPointLabel({ kind: 'turn', turn: 3 }, labels)).toBe('после хода 3');
    expect(checkpointPointLabel({ kind: 'start', run: 2 }, labels)).toBe('перед запуском 2');
    const cps = [1, 3, 2].map((n) => ({ n, kind: 'turn' as const, at: n, ref: '', commit: '', tree: '', parent: null }));
    expect(checkpointsNewestFirst(cps).map((c) => c.n)).toEqual([3, 2, 1]);
  });
});
