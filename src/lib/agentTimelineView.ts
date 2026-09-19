/**
 * Раскладка таймлайна агента для UI (TASK-72, decision-45): фильтр по инструменту, строки таблицы и
 * положение отрезков на горизонтальной шкале. Чистые функции без React; таймлайн собирает main
 * (`electron/services/agentTrace.ts::buildAgentTimeline`), рендерер его только показывает.
 */
import type {
  AgentCheckpoint,
  AgentTimeline,
  CheckpointKind,
  TimelineTool,
  TimelineToolStatus,
  TimelineTurn,
  TraceUsage
} from '../types/electron';

export const TIMELINE_FILTER_ALL = '*';

/** Инструменты с учётом фильтра по имени. */
export function filterTimelineTools(timeline: AgentTimeline, toolName: string): TimelineTool[] {
  if (!toolName || toolName === TIMELINE_FILTER_ALL) return timeline.tools;
  return timeline.tools.filter((t) => t.name === toolName);
}

/**
 * Usage хода для таблицы. У API-агента Swarm usage есть только на запуск, а ход в запуске один —
 * тогда показывается usage запуска.
 */
export function turnUsage(timeline: AgentTimeline, turn: TimelineTurn): TraceUsage | undefined {
  if (turn.usage) return turn.usage;
  const run = timeline.runs.find((r) => r.run === turn.run);
  if (run?.usage && run.turns.length === 1) return run.usage;
  return undefined;
}

export interface TimelineTableRow {
  key: string;
  kind: 'run' | 'turn' | 'tool';
  /** Номер запуска — у строки-разделителя запуска. */
  run?: number;
  turn?: TimelineTurn;
  tool?: TimelineTool;
}

/**
 * Строки таблицы: ход, под ним его инструменты; при нескольких запусках — разделитель запуска.
 * С фильтром — только ходы, где есть такой инструмент, и только эти инструменты.
 */
export function timelineTableRows(timeline: AgentTimeline, toolName: string): TimelineTableRow[] {
  const filtered = toolName && toolName !== TIMELINE_FILTER_ALL;
  const multiRun = timeline.runs.length > 1;
  const rows: TimelineTableRow[] = [];
  let lastRun: number | undefined;
  for (const turn of timeline.turns) {
    const tools = filtered ? turn.tools.filter((t) => t.name === toolName) : turn.tools;
    if (filtered && tools.length === 0) continue;
    if (multiRun && turn.run !== lastRun) {
      rows.push({ key: `run-${turn.run}`, kind: 'run', run: turn.run });
      lastRun = turn.run;
    }
    rows.push({ key: `turn-${turn.turn}`, kind: 'turn', turn });
    for (const tool of tools) rows.push({ key: `tool-${tool.toolId}`, kind: 'tool', turn, tool });
  }
  return rows;
}

export interface ScaleSegment {
  key: string;
  kind: 'turn' | 'tool';
  /** Чётность хода в запуске — для чередования фона соседних ходов. */
  odd?: boolean;
  leftPct: number;
  widthPct: number;
  status?: TimelineToolStatus;
  label: string;
  durationMs?: number;
}

export interface ScaleRow {
  run: number;
  startedAt: number;
  segments: ScaleSegment[];
}

/** Минимальная ширина отрезка на шкале, чтобы короткий инструмент был виден. */
export const MIN_SEGMENT_PCT = 0.6;

/**
 * Отрезки шкалы по запускам: ходы (фон, чередуются) и инструменты поверх, в процентах от окна
 * своего запуска — запуски разной длины читаются одинаково подробно. Фильтр оставляет на шкале
 * только выбранный инструмент (ходы остаются фоном).
 */
export function layoutTimelineScale(timeline: AgentTimeline, toolName: string, now?: number): ScaleRow[] {
  if (timeline.startedAt === undefined) return [];
  const tools = new Set(filterTimelineTools(timeline, toolName).map((t) => t.toolId));
  const rows: ScaleRow[] = [];
  for (const run of timeline.runs) {
    const runTurns = timeline.turns.filter((t) => t.run === run.run);
    const lastSeen = runTurns.reduce(
      (m, t) => Math.max(m, t.endedAt ?? t.startedAt, ...t.tools.map((x) => x.endedAt ?? x.startedAt)),
      run.startedAt
    );
    const start = run.startedAt;
    const endRaw = run.endedAt ?? (run.durationMs !== undefined ? start + run.durationMs : Math.max(lastSeen, now ?? lastSeen));
    const span = Math.max(1, endRaw - start);
    const pct = (at: number) => Math.min(100, Math.max(0, ((at - start) / span) * 100));
    const width = (from: number, to: number) => Math.max(MIN_SEGMENT_PCT, pct(to) - pct(from));
    const segments: ScaleSegment[] = [];
    runTurns.forEach((turn, index) => {
      const end = turn.endedAt ?? (turn.durationMs !== undefined ? turn.startedAt + turn.durationMs : endRaw);
      segments.push({
        key: `turn-${turn.turn}`,
        kind: 'turn',
        odd: index % 2 === 1,
        leftPct: pct(turn.startedAt),
        widthPct: width(turn.startedAt, end),
        label: String(turn.turn),
        durationMs: Math.max(0, end - turn.startedAt)
      });
      for (const tool of turn.tools) {
        if (!tools.has(tool.toolId)) continue;
        const toolEnd = tool.endedAt ?? (tool.status === 'running' ? endRaw : tool.startedAt);
        segments.push({
          key: `tool-${tool.toolId}`,
          kind: 'tool',
          leftPct: pct(tool.startedAt),
          widthPct: width(tool.startedAt, toolEnd),
          status: tool.status,
          label: tool.name,
          ...(tool.durationMs !== undefined ? { durationMs: tool.durationMs } : {})
        });
      }
    });
    rows.push({ run: run.run, startedAt: run.startedAt, segments });
  }
  return rows;
}

/** Размер вывода: 950 → «950», 12 345 → «12.3K», 2 500 000 → «2.5M». */
export function formatChars(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Длительность: мс до секунды, секунды с десятыми до минуты, дальше «м:сс». Единицы — из словаря. */
export function formatSpan(ms: number | undefined, units: { ms: string; s: string } = { ms: 'ms', s: 's' }): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ${units.ms}`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} ${units.s}`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Цвет отрезка и бейджа по статусу инструмента (классы Tailwind). */
export function toolStatusClass(status: TimelineToolStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-500/70 text-emerald-300 border-emerald-500/40';
    case 'error':
      return 'bg-rose-500/70 text-rose-300 border-rose-500/40';
    case 'running':
      return 'bg-primary/70 text-primary border-primary/40';
    case 'not_executed':
      return 'bg-muted-foreground/40 text-muted-foreground border-border';
    default:
      return 'bg-amber-500/60 text-amber-300 border-amber-500/40';
  }
}

/** Подпись точки чекпоинта из шаблонов словаря (`{run}`, `{turn}`). */
export function checkpointPointLabel(
  cp: Pick<AgentCheckpoint, 'kind' | 'turn' | 'run'>,
  labels: Record<CheckpointKind, string>
): string {
  return labels[cp.kind].replace('{turn}', String(cp.turn ?? '?')).replace('{run}', String(cp.run ?? '?'));
}

/** Чекпоинты новыми сверху — для списка отката. */
export function checkpointsNewestFirst(list: AgentCheckpoint[]): AgentCheckpoint[] {
  return [...list].sort((a, b) => b.n - a.n);
}
