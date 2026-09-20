/**
 * Представление плана подзадач в UI (TASK-80.3, decision-49): раскладка графа по уровням,
 * подписи состояний и доступность кнопок. Чистый модуль без React — покрыт unit-тестами
 * (`tests/unit/planGraphView.test.ts`), компонент `PlanPanel` только рисует его результат.
 */
import type { PlanNode, PlanNodeState, PlanState } from '../types/electron';

export type PlanNodeTone = 'idle' | 'active' | 'done' | 'warn' | 'error' | 'muted';

const TONES: Record<PlanNodeState, PlanNodeTone> = {
  pending: 'idle',
  running: 'active',
  completed: 'active',
  merging: 'active',
  merged: 'done',
  conflict: 'warn',
  failed: 'error',
  blocked: 'warn',
  skipped: 'muted',
  missing: 'error'
};

export function nodeTone(state: PlanNodeState): PlanNodeTone {
  return TONES[state] ?? 'idle';
}

/**
 * Уровень узла — длина максимального пути от узла без зависимостей. Узлы одного уровня могут
 * идти параллельно, поэтому в UI они стоят в одной колонке. Цикл (его не должно быть после
 * валидации плана) не зацикливает раскладку: такие узлы попадают на уровень 0.
 */
export function planLevels(nodes: PlanNode[]): PlanNode[][] {
  const byId = new Map(nodes.map((n) => [n.taskId, n]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const level = (taskId: string): number => {
    const known = levels.get(taskId);
    if (known !== undefined) return known;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const node = byId.get(taskId);
    const parents = (node?.dependsOn ?? []).filter((d) => byId.has(d));
    const value = parents.length === 0 ? 0 : Math.max(...parents.map(level)) + 1;
    visiting.delete(taskId);
    levels.set(taskId, value);
    return value;
  };

  const out: PlanNode[][] = [];
  for (const node of nodes) {
    const index = level(node.taskId);
    while (out.length <= index) out.push([]);
    out[index].push(node);
  }
  return out;
}

/** Какие кнопки доступны человеку при текущем состоянии плана (decision-49 п. 5). */
export interface PlanActions {
  canGenerate: boolean;
  canApprove: boolean;
  canStop: boolean;
  canDiscard: boolean;
  /** Граф изменился после утверждения — нужно подтвердить заново. */
  needsReapproval: boolean;
  busy: boolean;
}

export function planActions(plan: PlanState | null, currentGraphHash?: string): PlanActions {
  if (!plan) {
    return { canGenerate: true, canApprove: false, canStop: false, canDiscard: false, needsReapproval: false, busy: false };
  }
  const busy = plan.phase === 'planning' || plan.phase === 'running';
  const hasNodes = plan.nodes.length > 0;
  const needsReapproval =
    plan.phase === 'running' &&
    plan.approvedGraphHash !== undefined &&
    currentGraphHash !== undefined &&
    currentGraphHash !== plan.approvedGraphHash;

  return {
    canGenerate: !busy,
    canApprove: hasNodes && (plan.phase === 'awaiting_approval' || needsReapproval || plan.phase === 'finished'),
    canStop: plan.phase === 'running' && !plan.stopped,
    canDiscard: !busy,
    needsReapproval,
    busy
  };
}

/** Сводка по узлам для шапки панели. */
export function planCounts(nodes: PlanNode[]): Record<'total' | 'merged' | 'running' | 'problem' | 'pending', number> {
  const count = (states: PlanNodeState[]) => nodes.filter((n) => states.includes(n.state)).length;
  return {
    total: nodes.length,
    merged: count(['merged']),
    running: count(['running', 'completed', 'merging']),
    problem: count(['failed', 'blocked', 'conflict', 'missing']),
    pending: count(['pending', 'skipped'])
  };
}

export function formatPlanCost(costUsd: number | undefined, budgetUsd?: number): string {
  if (costUsd === undefined) return budgetUsd !== undefined ? `— / ${budgetUsd.toFixed(2)} $` : '—';
  const spent = `${costUsd.toFixed(2)} $`;
  return budgetUsd !== undefined ? `${spent} / ${budgetUsd.toFixed(2)} $` : spent;
}
