/**
 * Трасса агента (TASK-72, decision-45 п. 3, 6): разбор событий движков в события трассы и сборка
 * таймлайна «ходы → инструменты → длительность, статус, токены, стоимость». Чистый модуль без
 * Electron и git: время берётся из событий или передаётся параметром.
 */
import type {
  AgentCheckpoint,
  AgentTimeline,
  AgentTraceEvent,
  TimelineHitl,
  TimelineRun,
  TimelineTool,
  TimelineTurn,
  TraceEventInput,
  TraceUsage
} from './agentTraceTypes.js';
import { AGENT_TRACE_FORMAT, AGENT_TRACE_VERSION } from './agentTraceTypes.js';

/** Сколько символов аргументов инструмента хранится в трассе. */
export const TRACE_INPUT_PREVIEW_CHARS = 300;

/** Краткое представление аргументов инструмента: JSON без переводов строк, не длиннее лимита. */
export function previewToolInput(input: unknown, limit = TRACE_INPUT_PREVIEW_CHARS): string | undefined {
  if (input === undefined || input === null) return undefined;
  let text: string;
  try {
    text = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** Размер вывода инструмента в символах: строка, блоки `text`, прочие блоки — длина JSON. */
export function toolOutputChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
        n += ((block as { text: string }).text).length;
      } else if (block !== undefined && block !== null) {
        try {
          n += JSON.stringify(block).length;
        } catch {
          /* несериализуемый блок не считаем */
        }
      }
    }
    return n;
  }
  if (content === undefined || content === null) return 0;
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Usage сообщения Claude из события `assistant`: вход и кэш точные, выход частичный. */
export function traceUsageFromClaudeMessage(message: unknown): TraceUsage | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as { usage?: Record<string, unknown>; model?: unknown };
  const u = m.usage;
  if (!u || typeof u !== 'object') return null;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    ...(typeof m.model === 'string' && m.model ? { model: m.model } : {}),
    partial: true
  };
}

/** Точка чекпоинта словами: «после хода 3», «перед запуском 2» — для лога, промпта и коммита. */
export function describeCheckpointPoint(cp: Pick<AgentCheckpoint, 'kind' | 'turn' | 'run'>): string {
  switch (cp.kind) {
    case 'turn':
      return cp.turn !== undefined ? `после хода ${cp.turn}` : 'после хода';
    case 'start':
      return cp.run !== undefined ? `перед запуском ${cp.run}` : 'перед запуском';
    case 'end':
      return cp.run !== undefined ? `после запуска ${cp.run}` : 'после запуска';
    default:
      return 'перед откатом';
  }
}

// ───────────────────────────── Claude CLI stream-json ─────────────────────────────

interface PendingTool {
  name: string;
  turn: number;
  startedAt: number;
}

export interface ClaudeTraceState {
  /** Номер следующего хода (сквозной по агенту). */
  nextTurn: number;
  currentMessageId?: string;
  currentTurn?: number;
  /** В текущем ходе были вызовы инструментов. */
  turnHadTools: boolean;
  pending: Map<string, PendingTool>;
  seenTools: Set<string>;
  /** Граница начала следующего хода: старт запуска или последний результат инструмента. */
  boundaryAt: number;
}

export function createClaudeTraceState(turnsSoFar: number, runStartedAt: number): ClaudeTraceState {
  return {
    nextTurn: Math.max(0, turnsSoFar) + 1,
    turnHadTools: false,
    pending: new Map(),
    seenTools: new Set(),
    boundaryAt: runStartedAt
  };
}

export interface TraceStep {
  events: TraceEventInput[];
  /** Новое сообщение модели: его usage нужно учесть (один раз на `message.id`). */
  newMessageUsage?: TraceUsage;
  /** Ход, все инструменты которого вернули результат, — пора снимать чекпоинт `turn`. */
  turnCompleted?: number;
}

/**
 * Событие stream-json Claude CLI (проверено на 2.1.275) → события трассы. Одно сообщение модели
 * приходит несколькими `assistant` с общим `message.id` и повторённым `usage` — это один ход.
 * События субагентов (`parent_tool_use_id`) не создают ходов основного агента.
 */
export function consumeClaudeCliEvent(state: ClaudeTraceState, event: unknown, receivedAt: number): TraceStep {
  const step: TraceStep = { events: [] };
  if (!event || typeof event !== 'object') return step;
  const e = event as {
    type?: string;
    timestamp?: unknown;
    parent_tool_use_id?: unknown;
    message?: { id?: unknown; content?: unknown; model?: unknown };
  };
  if (typeof e.parent_tool_use_id === 'string' && e.parent_tool_use_id) return step;
  const at = parseTimestamp(e.timestamp) ?? receivedAt;

  if (e.type === 'assistant' && e.message) {
    const messageId = typeof e.message.id === 'string' && e.message.id ? e.message.id : undefined;
    const isNew = messageId ? messageId !== state.currentMessageId : state.currentTurn === undefined;
    if (isNew) {
      const turn = state.nextTurn++;
      state.currentMessageId = messageId;
      state.currentTurn = turn;
      state.turnHadTools = false;
      step.events.push({
        type: 'turn_start',
        turn,
        at: Math.min(state.boundaryAt, at),
        ...(messageId ? { messageId } : {}),
        ...(typeof e.message.model === 'string' && e.message.model ? { model: e.message.model } : {})
      });
      const usage = traceUsageFromClaudeMessage(e.message);
      if (usage) step.newMessageUsage = usage;
    }
    const turn = state.currentTurn as number;
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; id?: unknown; name?: unknown; input?: unknown };
      if (b.type !== 'tool_use' || typeof b.id !== 'string' || state.seenTools.has(b.id)) continue;
      state.seenTools.add(b.id);
      const name = typeof b.name === 'string' && b.name ? b.name : 'tool';
      state.pending.set(b.id, { name, turn, startedAt: at });
      state.turnHadTools = true;
      const input = previewToolInput(b.input);
      step.events.push({ type: 'tool_call', turn, toolId: b.id, name, at, ...(input ? { input } : {}) });
    }
    return step;
  }

  if (e.type === 'user' && e.message) {
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    let resolved = false;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
      if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
      const pending = state.pending.get(b.tool_use_id);
      if (!pending) continue;
      state.pending.delete(b.tool_use_id);
      resolved = true;
      step.events.push({
        type: 'tool_result',
        turn: pending.turn,
        toolId: b.tool_use_id,
        name: pending.name,
        ok: b.is_error !== true,
        outputChars: toolOutputChars(b.content),
        durationMs: Math.max(0, at - pending.startedAt),
        at
      });
    }
    if (resolved) {
      state.boundaryAt = at;
      const turn = state.currentTurn;
      const stillPending = turn !== undefined && Array.from(state.pending.values()).some((p) => p.turn === turn);
      if (turn !== undefined && state.turnHadTools && !stillPending) step.turnCompleted = turn;
    }
  }
  return step;
}

/** Номер последнего созданного хода (для сквозного счётчика агента). */
export function lastTurnOf(state: ClaudeTraceState): number {
  return state.nextTurn - 1;
}

// ───────────────────────────── API-движок (streamChat) ─────────────────────────────

export interface ApiTraceState {
  nextTurn: number;
  currentTurn?: number;
  pending: Map<string, PendingTool>;
  turnHadTools: boolean;
}

export function createApiTraceState(turnsSoFar: number): ApiTraceState {
  return { nextTurn: Math.max(0, turnsSoFar) + 1, pending: new Map(), turnHadTools: false };
}

/** Чанк `streamChat` (подмножество `AIStreamChunkPayload`), нужное трассе. */
export interface ApiTraceChunk {
  step?: number;
  model?: string;
  toolCall?: { id?: string; name?: string; args?: unknown };
  toolResult?: { id: string; name?: string; ok: boolean; outputChars?: number; durationMs?: number };
}

/**
 * Чанк API-движка → события трассы. Ход — запрос к модели: чанк `step` открывает его, вызовы
 * инструментов этого запроса принадлежат ему. Без `step` (старый путь) ход открывается на первом чанке.
 */
export function consumeApiChunk(state: ApiTraceState, chunk: ApiTraceChunk, now: number): TraceStep {
  const step: TraceStep = { events: [] };
  const openTurn = () => {
    const turn = state.nextTurn++;
    state.currentTurn = turn;
    state.turnHadTools = false;
    step.events.push({ type: 'turn_start', turn, at: now, ...(chunk.model ? { model: chunk.model } : {}) });
    return turn;
  };
  if (typeof chunk.step === 'number') openTurn();
  if (chunk.toolCall) {
    const turn = state.currentTurn ?? openTurn();
    const id = chunk.toolCall.id || `call-${turn}-${state.pending.size + 1}`;
    const name = chunk.toolCall.name || 'tool';
    state.pending.set(id, { name, turn, startedAt: now });
    state.turnHadTools = true;
    const input = previewToolInput(chunk.toolCall.args);
    step.events.push({ type: 'tool_call', turn, toolId: id, name, at: now, ...(input ? { input } : {}) });
  }
  if (chunk.toolResult) {
    const pending = state.pending.get(chunk.toolResult.id);
    state.pending.delete(chunk.toolResult.id);
    const turn = pending?.turn ?? state.currentTurn;
    step.events.push({
      type: 'tool_result',
      ...(turn !== undefined ? { turn } : {}),
      toolId: chunk.toolResult.id,
      name: chunk.toolResult.name ?? pending?.name,
      ok: chunk.toolResult.ok,
      outputChars: Math.max(0, chunk.toolResult.outputChars ?? 0),
      durationMs: chunk.toolResult.durationMs ?? (pending ? Math.max(0, now - pending.startedAt) : undefined),
      at: now
    });
    const stillPending = turn !== undefined && Array.from(state.pending.values()).some((p) => p.turn === turn);
    if (turn !== undefined && state.turnHadTools && !stillPending) step.turnCompleted = turn;
  }
  return step;
}

export function lastApiTurnOf(state: ApiTraceState): number {
  return state.nextTurn - 1;
}

// ───────────────────────────── Сериализация ─────────────────────────────

/** Дописывает общие поля события трассы. */
export function finalizeTraceEvent(input: TraceEventInput, run: number, now: number): AgentTraceEvent {
  return { ...input, v: 1, run, at: typeof input.at === 'number' ? input.at : now } as AgentTraceEvent;
}

const KNOWN_TYPES = new Set([
  'run_start',
  'turn_start',
  'tool_call',
  'tool_result',
  'hitl',
  'model_switch',
  'usage',
  'checkpoint',
  'rewind',
  'error',
  'run_end'
]);

/** Разбор JSONL трассы: битые и чужие строки пропускаются (файл мог оборваться при сбое). */
export function parseTraceJsonl(text: string): AgentTraceEvent[] {
  const out: AgentTraceEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Partial<AgentTraceEvent>;
      if (obj && typeof obj === 'object' && typeof obj.type === 'string' && KNOWN_TYPES.has(obj.type) && typeof obj.at === 'number') {
        out.push(obj as AgentTraceEvent);
      }
    } catch {
      /* оборванная строка */
    }
  }
  return out;
}

export function traceEventsToJsonl(events: AgentTraceEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
}

export interface TraceExportHeader {
  type: 'header';
  format: typeof AGENT_TRACE_FORMAT;
  v: typeof AGENT_TRACE_VERSION;
  exportedAt: string;
  /** Формат JSON-экспорта сессии, с которым совпадают `totals` и поля агентов. */
  sessionFormat: 'projecthub-swarm-session';
  sessionVersion: 1;
  swarmId: string;
  [key: string]: unknown;
}

/** JSONL для экспорта: строка заголовка, затем события агентов с полем `agentId`. */
export function buildTraceExport(header: TraceExportHeader, perAgent: Array<{ agentId: string; events: AgentTraceEvent[] }>): string {
  const lines = [JSON.stringify(header)];
  for (const { agentId, events } of perAgent) {
    for (const e of events) lines.push(JSON.stringify({ ...e, agentId }));
  }
  return `${lines.join('\n')}\n`;
}

// ───────────────────────────── Таймлайн ─────────────────────────────

function addTraceUsage(a: TraceUsage | undefined, b: TraceUsage): TraceUsage {
  if (!a) return { ...b };
  const cost = typeof a.costUsd === 'number' || typeof b.costUsd === 'number' ? (a.costUsd ?? 0) + (b.costUsd ?? 0) : undefined;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    ...(cost !== undefined ? { costUsd: cost } : {}),
    ...(b.costSource ?? a.costSource ? { costSource: b.costSource ?? a.costSource } : {}),
    ...(b.model ?? a.model ? { model: b.model ?? a.model } : {}),
    ...(a.partial || b.partial ? { partial: true } : {}),
    ...(a.estimated || b.estimated ? { estimated: true } : {})
  };
}

/**
 * Таймлайн из событий трассы в порядке записи. `now` — для незавершённых запусков и ходов
 * (длительность «на сейчас»); без него у открытых элементов длительности нет.
 */
export function buildAgentTimeline(
  events: AgentTraceEvent[],
  options: { now?: number; truncated?: boolean; active?: boolean } = {}
): AgentTimeline {
  const runs = new Map<number, TimelineRun & { toolsExecuted?: boolean }>();
  const turns = new Map<number, TimelineTurn>();
  const tools = new Map<string, TimelineTool>();
  const toolOrder: TimelineTool[] = [];
  const hitl: TimelineHitl[] = [];
  const timeline: AgentTimeline = {
    runs: [],
    turns: [],
    tools: [],
    hitl,
    switches: [],
    checkpoints: [],
    rewinds: [],
    toolNames: [],
    totals: { runs: 0, turns: 0, tools: 0, toolErrors: 0, toolTimeMs: 0, durationMs: 0, costPartial: false },
    ...(options.truncated ? { truncated: true } : {})
  };

  const runOf = (run: number, at: number) => {
    let r = runs.get(run);
    if (!r) {
      r = { run, startedAt: at, turns: [], errors: [], checkpoints: [] };
      runs.set(run, r);
    }
    return r;
  };
  const closeTurn = (turn: TimelineTurn, at: number) => {
    if (turn.endedAt !== undefined) return;
    const lastTool = turn.tools.reduce((m, t) => Math.max(m, t.endedAt ?? t.startedAt), turn.startedAt);
    turn.endedAt = Math.max(lastTool, at);
    turn.durationMs = Math.max(0, turn.endedAt - turn.startedAt);
  };

  const lastTurnOfRun = new Map<number, TimelineTurn>();
  for (const ev of events) {
    const run = runOf(ev.run, ev.at);
    switch (ev.type) {
      case 'run_start':
        run.startedAt = ev.at;
        run.engine = ev.engine;
        if (ev.model) run.model = ev.model;
        if (ev.iteration !== undefined) run.iteration = ev.iteration;
        if (ev.afterRewind) run.afterRewind = true;
        if (ev.toolsExecuted === false) run.toolsExecuted = false;
        break;
      case 'turn_start': {
        const prev = lastTurnOfRun.get(ev.run);
        if (prev) closeTurn(prev, ev.at);
        const turn: TimelineTurn = { turn: ev.turn, run: ev.run, startedAt: ev.at, tools: [], ...(ev.model ? { model: ev.model } : {}) };
        turns.set(ev.turn, turn);
        lastTurnOfRun.set(ev.run, turn);
        run.turns.push(ev.turn);
        break;
      }
      case 'tool_call': {
        const tool: TimelineTool = {
          toolId: ev.toolId,
          name: ev.name,
          ...(ev.input ? { input: ev.input } : {}),
          run: ev.run,
          turn: ev.turn,
          startedAt: ev.at,
          status: 'running',
          hitl: []
        };
        tools.set(ev.toolId, tool);
        toolOrder.push(tool);
        turns.get(ev.turn)?.tools.push(tool);
        break;
      }
      case 'tool_result': {
        const tool = tools.get(ev.toolId);
        if (!tool) break;
        tool.status = ev.ok ? 'ok' : 'error';
        tool.outputChars = ev.outputChars;
        tool.durationMs = ev.durationMs ?? Math.max(0, ev.at - tool.startedAt);
        tool.endedAt = tool.startedAt + tool.durationMs;
        break;
      }
      case 'hitl': {
        const item: TimelineHitl = {
          requestId: ev.requestId,
          decision: ev.decision,
          at: ev.at,
          ...(ev.decidedBy ? { decidedBy: ev.decidedBy } : {}),
          ...(ev.rule ? { rule: ev.rule } : {}),
          ...(ev.tool ? { tool: ev.tool } : {}),
          ...(ev.title ? { title: ev.title } : {})
        };
        hitl.push(item);
        // Решение относится к последнему вызову этого инструмента, начатому не позже решения.
        for (let i = toolOrder.length - 1; i >= 0; i--) {
          const t = toolOrder[i];
          if (t.run !== ev.run || t.startedAt > ev.at + 1000) continue;
          if (ev.tool && t.name !== ev.tool && !ev.tool.endsWith(t.name) && !t.name.endsWith(ev.tool)) continue;
          t.hitl.push(item);
          break;
        }
        break;
      }
      case 'model_switch':
        timeline.switches.push({
          at: ev.at,
          run: ev.run,
          from: ev.from,
          to: ev.to,
          kind: ev.kind,
          ...(ev.reason ? { reason: ev.reason } : {}),
          ...(ev.waitedMs ? { waitedMs: ev.waitedMs } : {})
        });
        break;
      case 'usage':
        if (ev.scope === 'turn' && ev.turn !== undefined) {
          const turn = turns.get(ev.turn);
          if (turn) turn.usage = addTraceUsage(turn.usage, ev.usage);
        } else if (ev.scope === 'run') {
          run.usage = ev.usage;
        }
        break;
      case 'checkpoint':
        timeline.checkpoints.push(ev);
        run.checkpoints.push(ev.n);
        if (ev.turn !== undefined) {
          const turn = turns.get(ev.turn);
          if (turn && ev.kind === 'turn') turn.checkpoint = ev.n;
        }
        break;
      case 'rewind':
        timeline.rewinds.push(ev);
        break;
      case 'error':
        run.errors.push(ev.message);
        break;
      case 'run_end': {
        run.endedAt = ev.at;
        run.durationMs = ev.durationMs;
        run.status = ev.status;
        if (ev.numTurns !== undefined) run.numTurns = ev.numTurns;
        const last = lastTurnOfRun.get(ev.run);
        if (last) closeTurn(last, ev.at);
        for (const tool of toolOrder) {
          if (tool.run === ev.run && tool.status === 'running') tool.status = run.toolsExecuted === false ? 'not_executed' : 'no_result';
        }
        break;
      }
    }
  }

  const now = options.now;
  for (const run of runs.values()) {
    if (run.endedAt === undefined && options.active === false) {
      // Запуск оборван (перезапуск приложения, сбой): результатов уже не будет.
      for (const tool of toolOrder) {
        if (tool.run === run.run && tool.status === 'running') tool.status = run.toolsExecuted === false ? 'not_executed' : 'no_result';
      }
      if (!run.status) run.status = 'interrupted';
    }
    if (run.endedAt === undefined && typeof now === 'number') run.durationMs = Math.max(0, now - run.startedAt);
    const { toolsExecuted: _toolsExecuted, ...plain } = run;
    timeline.runs.push(plain);
  }
  timeline.runs.sort((a, b) => a.run - b.run);
  for (const turn of turns.values()) {
    if (turn.endedAt === undefined && typeof now === 'number') turn.durationMs = Math.max(0, now - turn.startedAt);
  }
  timeline.turns = Array.from(turns.values()).sort((a, b) => a.turn - b.turn);
  timeline.tools = toolOrder;
  timeline.toolNames = Array.from(new Set(toolOrder.map((t) => t.name))).sort((a, b) => a.localeCompare(b));

  const starts = timeline.runs.map((r) => r.startedAt);
  const ends = timeline.runs.map((r) => r.endedAt ?? (typeof now === 'number' ? now : r.startedAt));
  if (starts.length > 0) {
    timeline.startedAt = Math.min(...starts);
    timeline.endedAt = Math.max(...ends);
  }
  let cost = 0;
  let costKnown = false;
  let partial = false;
  for (const run of timeline.runs) {
    if (typeof run.usage?.costUsd === 'number') {
      cost += run.usage.costUsd;
      costKnown = true;
    } else {
      // Итога запуска нет (прерван или движок не сообщил) — сумма оценок ходов.
      const turnCost = run.turns.reduce((s, n) => s + (turns.get(n)?.usage?.costUsd ?? 0), 0);
      if (turnCost > 0) {
        cost += turnCost;
        costKnown = true;
        partial = true;
      }
    }
  }
  timeline.totals = {
    runs: timeline.runs.length,
    turns: timeline.turns.length,
    tools: toolOrder.length,
    toolErrors: toolOrder.filter((t) => t.status === 'error').length,
    toolTimeMs: toolOrder.reduce((s, t) => s + (t.durationMs ?? 0), 0),
    durationMs: timeline.runs.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    ...(costKnown ? { costUsd: cost } : {}),
    costPartial: partial
  };
  return timeline;
}
