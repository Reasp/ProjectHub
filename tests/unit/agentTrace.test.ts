import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildAgentTimeline,
  buildTraceExport,
  consumeApiChunk,
  consumeClaudeCliEvent,
  createApiTraceState,
  createClaudeTraceState,
  finalizeTraceEvent,
  lastTurnOf,
  parseTraceJsonl,
  previewToolInput,
  toolOutputChars,
  traceEventsToJsonl
} from '../../electron/services/agentTrace';
import type { AgentTraceEvent, TraceEventInput } from '../../electron/services/agentTraceTypes';

const FIXTURE = path.join(__dirname, 'fixtures', 'claude-cli-stream-2.1.275-tools.jsonl');

/** Прогон событий Claude CLI через парсер, как это делает сервис флота. */
function runClaudeFixture(turnsSoFar = 0) {
  const events = fs
    .readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const startedAt = Date.parse('2026-09-19T11:07:35.000Z');
  const state = createClaudeTraceState(turnsSoFar, startedAt);
  const trace: AgentTraceEvent[] = [
    finalizeTraceEvent({ type: 'run_start', engine: 'claude-cli', promptChars: 100, at: startedAt }, 1, startedAt)
  ];
  const usages: Array<{ turn: number; input: number; output: number }> = [];
  const completed: number[] = [];
  for (const e of events) {
    const step = consumeClaudeCliEvent(state, e, startedAt);
    for (const ev of step.events) trace.push(finalizeTraceEvent(ev, 1, startedAt));
    if (step.newMessageUsage && state.currentTurn !== undefined) {
      usages.push({ turn: state.currentTurn, input: step.newMessageUsage.inputTokens, output: step.newMessageUsage.outputTokens });
      trace.push(finalizeTraceEvent({ type: 'usage', scope: 'turn', turn: state.currentTurn, usage: { ...step.newMessageUsage, costUsd: 0.01 } }, 1, startedAt));
    }
    if (step.turnCompleted !== undefined) completed.push(step.turnCompleted);
  }
  const endAt = Date.parse('2026-09-19T11:07:42.300Z');
  trace.push(finalizeTraceEvent({ type: 'run_end', status: 'completed', durationMs: endAt - startedAt, numTurns: 3, at: endAt }, 1, endAt));
  return { state, trace, usages, completed };
}

describe('agentTrace: парсер stream-json Claude CLI 2.1.275 (TASK-72, decision-45)', () => {
  it('склеивает события одного message.id в ход, считает длительность инструмента по timestamp', () => {
    const { state, trace, usages, completed } = runClaudeFixture();
    const turns = trace.filter((e) => e.type === 'turn_start');
    expect(turns.map((t) => t.turn)).toEqual([1, 2, 3]);
    expect(lastTurnOf(state)).toBe(3);

    const calls = trace.filter((e): e is Extract<AgentTraceEvent, { type: 'tool_call' }> => e.type === 'tool_call');
    expect(calls.map((c) => [c.turn, c.name])).toEqual([
      [1, 'Read'],
      [2, 'Write']
    ]);
    expect(calls[0].input).toContain('a.txt');

    const results = trace.filter((e): e is Extract<AgentTraceEvent, { type: 'tool_result' }> => e.type === 'tool_result');
    // Read: 11:07:38.144 → 11:07:38.229, Write: 11:07:40.657 → 11:07:40.717 (сняты вживую).
    expect(results.map((r) => [r.name, r.durationMs, r.ok])).toEqual([
      ['Read', 85, true],
      ['Write', 60, true]
    ]);
    expect(results[0].outputChars).toBe('1\thello checkpoint\n2\t'.length);

    // usage — один раз на сообщение, хотя событий assistant с ним по два
    expect(usages.map((u) => u.turn)).toEqual([1, 2, 3]);
    expect(usages[0]).toMatchObject({ input: 9, output: 4 });
    // чекпоинт после хода, когда пришли все результаты его инструментов; ход без инструментов — нет
    expect(completed).toEqual([1, 2]);
  });

  it('ход начинается с границы: старт запуска или последний результат инструмента', () => {
    const { trace } = runClaudeFixture();
    const turns = trace.filter((e) => e.type === 'turn_start');
    expect(turns[0].at).toBe(Date.parse('2026-09-19T11:07:35.000Z'));
    expect(turns[1].at).toBe(Date.parse('2026-09-19T11:07:38.229Z'));
    expect(turns[2].at).toBe(Date.parse('2026-09-19T11:07:40.717Z'));
  });

  it('нумерация ходов сквозная между запусками', () => {
    const { trace } = runClaudeFixture(7);
    expect(trace.filter((e) => e.type === 'turn_start').map((t) => t.turn)).toEqual([8, 9, 10]);
  });

  it('события субагента (parent_tool_use_id) не создают ходов, ошибка инструмента — ok: false', () => {
    const state = createClaudeTraceState(0, 0);
    const a = consumeClaudeCliEvent(
      state,
      { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } },
      0
    );
    expect(a.events.map((e) => e.type)).toEqual(['turn_start', 'tool_call']);
    const sub = consumeClaudeCliEvent(
      state,
      { type: 'assistant', parent_tool_use_id: 't1', message: { id: 'sub', content: [{ type: 'tool_use', id: 's1', name: 'Read' }] } },
      0
    );
    expect(sub.events).toEqual([]);
    const r = consumeClaudeCliEvent(
      state,
      { type: 'user', timestamp: '2026-01-01T00:00:03.500Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }] }] } },
      0
    );
    expect(r.events[0]).toMatchObject({ type: 'tool_result', ok: false, outputChars: 4, durationMs: 2500 });
    expect(r.turnCompleted).toBe(1);
  });

  it('без timestamp берётся время приёма строки', () => {
    const state = createClaudeTraceState(0, 1000);
    const a = consumeClaudeCliEvent(state, { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'x', name: 'Read' }] } }, 2000);
    expect(a.events[1].at).toBe(2000);
    const r = consumeClaudeCliEvent(state, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } }, 2600);
    expect(r.events[0]).toMatchObject({ durationMs: 600 });
  });
});

describe('agentTrace: чанки API-движка', () => {
  it('шаг открывает ход, результат инструмента закрывает его и даёт чекпоинт', () => {
    const state = createApiTraceState(2);
    const s0 = consumeApiChunk(state, { step: 0, model: 'qwen' }, 100);
    expect(s0.events[0]).toMatchObject({ type: 'turn_start', turn: 3, model: 'qwen' });
    const c = consumeApiChunk(state, { toolCall: { id: 'c1', name: 'read_file', args: { path: 'a.ts' } } }, 150);
    expect(c.events[0]).toMatchObject({ type: 'tool_call', turn: 3, name: 'read_file' });
    const r = consumeApiChunk(state, { toolResult: { id: 'c1', name: 'read_file', ok: true, outputChars: 42, durationMs: 12 } }, 170);
    expect(r.events[0]).toMatchObject({ type: 'tool_result', turn: 3, durationMs: 12, outputChars: 42 });
    expect(r.turnCompleted).toBe(3);
  });

  it('вызов без шага (старый путь) открывает ход сам', () => {
    const state = createApiTraceState(0);
    const c = consumeApiChunk(state, { toolCall: { name: 'write_file' } }, 5);
    expect(c.events.map((e) => e.type)).toEqual(['turn_start', 'tool_call']);
  });
});

describe('agentTrace: таймлайн', () => {
  it('ходы, инструменты, HITL и стоимость из трассы Claude CLI', () => {
    const { trace } = runClaudeFixture();
    const start = Date.parse('2026-09-19T11:07:35.000Z');
    const hitl = finalizeTraceEvent({ type: 'hitl', requestId: 'r1', decision: 'allow', decidedBy: 'auto', rule: 'auto-write', tool: 'Write', at: Date.parse('2026-09-19T11:07:40.680Z') }, 1, start);
    const withHitl = [...trace.slice(0, -1), hitl, trace[trace.length - 1]];
    withHitl.push(
      finalizeTraceEvent({ type: 'usage', scope: 'run', usage: { inputTokens: 25, outputTokens: 439, cacheReadTokens: 95258, cacheCreationTokens: 10255, costUsd: 0.0333, costSource: 'provider' } }, 1, start)
    );
    const tl = buildAgentTimeline(withHitl);
    expect(tl.totals).toMatchObject({ runs: 1, turns: 3, tools: 2, toolErrors: 0, toolTimeMs: 145, costPartial: false });
    expect(tl.totals.costUsd).toBeCloseTo(0.0333, 6);
    expect(tl.toolNames).toEqual(['Read', 'Write']);
    const write = tl.tools.find((t) => t.name === 'Write')!;
    expect(write.hitl.map((h) => h.decision)).toEqual(['allow']);
    expect(tl.turns[0]).toMatchObject({ turn: 1, durationMs: 3229 });
    expect(tl.turns[2].endedAt).toBe(Date.parse('2026-09-19T11:07:42.300Z'));
    expect(tl.runs[0]).toMatchObject({ status: 'completed', numTurns: 3, engine: 'claude-cli' });
  });

  it('API-агент Swarm без исполнителя: вызовы «не исполнены» после конца запуска', () => {
    const ev: AgentTraceEvent[] = [
      finalizeTraceEvent({ type: 'run_start', engine: 'api', toolsExecuted: false, promptChars: 5 }, 1, 0),
      finalizeTraceEvent({ type: 'turn_start', turn: 1 }, 1, 0),
      finalizeTraceEvent({ type: 'tool_call', turn: 1, toolId: 'c', name: 'write_file' }, 1, 10),
      finalizeTraceEvent({ type: 'run_end', status: 'completed', durationMs: 50 }, 1, 50)
    ];
    const tl = buildAgentTimeline(ev);
    expect(tl.tools[0].status).toBe('not_executed');
  });

  it('оборванный запуск неактивного агента: инструменты без результата, запуск interrupted, стоимость по ходам', () => {
    const ev: AgentTraceEvent[] = [
      finalizeTraceEvent({ type: 'run_start', engine: 'claude-cli', promptChars: 5 }, 1, 0),
      finalizeTraceEvent({ type: 'turn_start', turn: 1 }, 1, 0),
      finalizeTraceEvent({ type: 'usage', scope: 'turn', turn: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.5, partial: true } }, 1, 1),
      finalizeTraceEvent({ type: 'tool_call', turn: 1, toolId: 'c', name: 'Bash' }, 1, 10)
    ];
    const active = buildAgentTimeline(ev, { active: true, now: 1000 });
    expect(active.tools[0].status).toBe('running');
    expect(active.runs[0].durationMs).toBe(1000);
    const gone = buildAgentTimeline(ev, { active: false });
    expect(gone.tools[0].status).toBe('no_result');
    expect(gone.runs[0].status).toBe('interrupted');
    expect(gone.totals).toMatchObject({ costUsd: 0.5, costPartial: true });
  });

  it('чекпоинты, откаты и переключения модели попадают в таймлайн', () => {
    const ev: AgentTraceEvent[] = [
      finalizeTraceEvent({ type: 'run_start', engine: 'api', promptChars: 1 }, 1, 0),
      finalizeTraceEvent({ type: 'model_switch', from: 'a', to: 'b', kind: 'rate_limit', waitedMs: 1000 }, 1, 1),
      finalizeTraceEvent({ type: 'turn_start', turn: 1 }, 1, 2),
      finalizeTraceEvent({ type: 'checkpoint', n: 2, kind: 'turn', turn: 1, ref: 'r', commit: 'c', tree: 't', parent: null }, 1, 3),
      finalizeTraceEvent({ type: 'rewind', toCheckpoint: 2, toTurn: 1, preRewindCheckpoint: 3, removedFiles: 1 }, 1, 4)
    ];
    const tl = buildAgentTimeline(ev);
    expect(tl.switches[0]).toMatchObject({ from: 'a', to: 'b', waitedMs: 1000 });
    expect(tl.turns[0].checkpoint).toBe(2);
    expect(tl.rewinds[0].toCheckpoint).toBe(2);
    expect(tl.runs[0].checkpoints).toEqual([2]);
  });
});

describe('agentTrace: JSONL', () => {
  it('разбор пропускает оборванные и чужие строки', () => {
    const good = finalizeTraceEvent({ type: 'turn_start', turn: 1 } as TraceEventInput, 1, 5);
    const text = `${traceEventsToJsonl([good])}{"type":"turn_start","at":1\n{"type":"unknown","at":1}\nnot json\n`;
    expect(parseTraceJsonl(text)).toEqual([good]);
  });

  it('экспорт: первая строка — заголовок формата, дальше события с agentId', () => {
    const e = finalizeTraceEvent({ type: 'turn_start', turn: 1 } as TraceEventInput, 1, 5);
    const out = buildTraceExport(
      { type: 'header', format: 'projecthub-agent-trace', v: 1, exportedAt: 'x', sessionFormat: 'projecthub-swarm-session', sessionVersion: 1, swarmId: 's' },
      [{ agentId: 'a1', events: [e] }]
    );
    const lines = out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'header', format: 'projecthub-agent-trace', v: 1 });
    expect(lines[1]).toMatchObject({ type: 'turn_start', agentId: 'a1', v: 1, run: 1 });
  });

  it('превью аргументов и размер вывода', () => {
    expect(previewToolInput({ a: 'x'.repeat(500) })!.length).toBe(301);
    expect(previewToolInput({ cmd: 'a\n  b' })).toBe('{"cmd":"a\\n b"}');
    expect(previewToolInput('line1\nline2')).toBe('line1 line2');
    expect(toolOutputChars([{ type: 'text', text: 'abc' }, { type: 'image', source: {} }])).toBe(3 + JSON.stringify({ type: 'image', source: {} }).length);
    expect(toolOutputChars(undefined)).toBe(0);
  });
});
