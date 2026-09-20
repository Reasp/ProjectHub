/**
 * Типы трассы, таймлайна и чекпоинтов агента (TASK-72, decision-45). Только типы: их используют
 * хранилище, экспорт, сервис флота и парсер. Зеркало для рендерера — `src/types/electron.d.ts`.
 */
import type { CostSource } from './agentCost.js';

export const AGENT_TRACE_FORMAT = 'projecthub-agent-trace';
export const AGENT_TRACE_VERSION = 1;

/** Вид чекпоинта: перед запуском движка, после инструментов хода, после запуска, перед откатом. */
export type CheckpointKind = 'start' | 'turn' | 'end' | 'pre_rewind';

export interface AgentCheckpoint {
  /** Сквозной номер чекпоинта агента (часть имени ref). */
  n: number;
  kind: CheckpointKind;
  run?: number;
  turn?: number;
  at: number;
  ref: string;
  commit: string;
  tree: string;
  /** HEAD в момент снимка; откат возвращает ветку сюда. */
  parent: string | null;
  /** Файлов изменено относительно предыдущего чекпоинта (или всего в дереве для первого). */
  filesChanged?: number;
}

export interface AgentRewindRecord {
  at: number;
  /** Номер чекпоинта, к которому откатились. */
  toCheckpoint: number;
  toTurn?: number;
  toKind: CheckpointKind;
  /** Чекпоинт с состоянием до отката («отмена отката»). */
  preRewindCheckpoint?: number;
  removedFiles: number;
  /** Коммит, которым зафиксировано откатанное состояние (decision-8). */
  commitHash?: string;
}

/** Сквозные счётчики агента: переживают итерации цикла, откат и перезапуск приложения. */
export interface AgentTraceCounters {
  runs: number;
  turns: number;
  checkpoints: number;
}

export interface TraceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number;
  costSource?: CostSource;
  model?: string;
  /** Выход частичный (события `assistant` Claude CLI) — стоимость хода является оценкой. */
  partial?: boolean;
  /** Оценка по длине текста — сервер usage не сообщил. */
  estimated?: boolean;
}

interface TraceBase {
  v: 1;
  at: number;
  run: number;
  turn?: number;
  /** Заполняется при экспорте трассы нескольких агентов. */
  agentId?: string;
}

export type AgentTraceEvent =
  | (TraceBase & {
      type: 'run_start';
      engine: string;
      model?: string;
      iteration?: number;
      continueSession?: boolean;
      /** Запуск после отката (промпт с пояснением). */
      afterRewind?: boolean;
      /** `false` — движок не исполняет инструменты (API-агент Swarm): вызовы без результата «не исполнены». */
      toolsExecuted?: boolean;
      promptChars: number;
    })
  | (TraceBase & { type: 'turn_start'; turn: number; messageId?: string; model?: string })
  | (TraceBase & { type: 'tool_call'; turn: number; toolId: string; name: string; input?: string })
  | (TraceBase & {
      type: 'tool_result';
      turn?: number;
      toolId: string;
      name?: string;
      ok: boolean;
      outputChars: number;
      durationMs?: number;
    })
  | (TraceBase & {
      type: 'hitl';
      requestId: string;
      /** Вызов инструмента, для которого принято решение (API-агент Swarm, TASK-101); у Claude CLI нет. */
      toolId?: string;
      decision: 'requested' | 'allow' | 'deny' | 'expired' | 'cancelled';
      tool?: string;
      title?: string;
      decidedBy?: string;
      rule?: string;
    })
  | (TraceBase & {
      type: 'model_switch';
      from: string;
      to: string;
      kind: string;
      reason?: string;
      waitedMs?: number;
    })
  | (TraceBase & { type: 'usage'; scope: 'turn' | 'run'; usage: TraceUsage })
  | (TraceBase & {
      type: 'checkpoint';
      n: number;
      kind: CheckpointKind;
      ref: string;
      commit: string;
      tree: string;
      parent: string | null;
      filesChanged?: number;
    })
  | (TraceBase & {
      type: 'rewind';
      toCheckpoint: number;
      toTurn?: number;
      preRewindCheckpoint?: number;
      removedFiles: number;
    })
  | (TraceBase & { type: 'error'; message: string; kind?: string })
  | (TraceBase & {
      /** Продолжение после отката или с уточнением (decision-48 п. 4) — перед `run_start` нового запуска. */
      type: 'continue';
      mode: 'agent' | 'loop' | 'handoff';
      toCheckpoint?: number;
      /** Цикл: номер первой итерации нового отрезка. */
      iteration?: number;
      /** Handoff: номер этапа (0-based). */
      stage?: number;
      instruction?: boolean;
    })
  | (TraceBase & {
      type: 'run_end';
      status: string;
      durationMs: number;
      numTurns?: number;
    });

export type AgentTraceEventType = AgentTraceEvent['type'];

/** Распределённый Omit по объединению: у каждого вида события свои поля. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Событие без общих полей (`v`, `run`, `at`) — их проставляет писатель трассы. */
export type TraceEventInput = DistributiveOmit<AgentTraceEvent, 'v' | 'run' | 'at'> & { at?: number };

// ───────────────────────────── Таймлайн ─────────────────────────────

export type TimelineToolStatus = 'ok' | 'error' | 'running' | 'no_result' | 'not_executed';

export interface TimelineHitl {
  requestId: string;
  decision: 'requested' | 'allow' | 'deny' | 'expired' | 'cancelled';
  decidedBy?: string;
  rule?: string;
  tool?: string;
  title?: string;
  at: number;
}

export interface TimelineTool {
  toolId: string;
  name: string;
  input?: string;
  run: number;
  turn: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: TimelineToolStatus;
  outputChars?: number;
  hitl: TimelineHitl[];
}

export interface TimelineTurn {
  turn: number;
  run: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  model?: string;
  tools: TimelineTool[];
  usage?: TraceUsage;
  checkpoint?: number;
}

export interface TimelineRun {
  run: number;
  engine?: string;
  model?: string;
  iteration?: number;
  afterRewind?: boolean;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status?: string;
  numTurns?: number;
  usage?: TraceUsage;
  turns: number[];
  errors: string[];
  checkpoints: number[];
}

export interface TimelineModelSwitch {
  at: number;
  run: number;
  from: string;
  to: string;
  kind: string;
  reason?: string;
  waitedMs?: number;
}

export interface AgentTimeline {
  runs: TimelineRun[];
  turns: TimelineTurn[];
  tools: TimelineTool[];
  hitl: TimelineHitl[];
  switches: TimelineModelSwitch[];
  checkpoints: Array<Extract<AgentTraceEvent, { type: 'checkpoint' }>>;
  rewinds: Array<Extract<AgentTraceEvent, { type: 'rewind' }>>;
  continuations: Array<Extract<AgentTraceEvent, { type: 'continue' }>>;
  toolNames: string[];
  startedAt?: number;
  endedAt?: number;
  totals: {
    runs: number;
    turns: number;
    tools: number;
    toolErrors: number;
    toolTimeMs: number;
    durationMs: number;
    costUsd?: number;
    costPartial: boolean;
  };
  /** Трасса усечена ротацией — начало истории недоступно. */
  truncated?: boolean;
}
