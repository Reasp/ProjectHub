/**
 * Диспетчер плана (TASK-80, decision-49 п. 3, 5): чистые решения без Electron и IO.
 *
 * Отвечает на один вопрос — что делать дальше при текущем состоянии графа: какие узлы можно
 * запускать, ждать ли идущие, или план закончился и с каким исходом. Побочные эффекты (запуск
 * сессий «до готовности», слияние в интеграционную ветку, HITL) — в `planService`.
 * Покрыт unit-тестами (`tests/unit/planDispatcher.test.ts`).
 */
import { createHash } from 'node:crypto';
import type { PlanNode, PlanNodeState, PlanOutcome } from './planTypes.js';

export const DEFAULT_PLAN_MAX_PARALLEL = 2;
export const MAX_PLAN_PARALLEL = 6;

/** Узел занимает слот параллельности: работает агент или идёт слияние. */
const BUSY: PlanNodeState[] = ['running', 'completed', 'merging'];
/** Узел ждёт человека и не даёт плану закончиться. */
const WAITING_HUMAN: PlanNodeState[] = ['conflict'];
/** Зависимость удовлетворена: результат в интеграционной ветке или узел сознательно исключён. */
const SATISFIED: PlanNodeState[] = ['merged', 'skipped'];
/** Узел больше не изменится сам по себе. */
const TERMINAL: PlanNodeState[] = ['merged', 'failed', 'blocked', 'skipped', 'missing'];

export function isBusy(node: PlanNode): boolean {
  return BUSY.includes(node.state);
}

export function isTerminal(node: PlanNode): boolean {
  return TERMINAL.includes(node.state);
}

/** Готов ли узел к запуску: сам ждёт очереди и все зависимости удовлетворены. */
export function isReady(node: PlanNode, byId: Map<string, PlanNode>): boolean {
  if (node.state !== 'pending') return false;
  return node.dependsOn.every((dep) => {
    const parent = byId.get(dep);
    // Зависимость вне плана (человек дописал её руками) считается удовлетворённой:
    // планировщик не отвечает за задачи, которых не создавал.
    return parent === undefined || SATISFIED.includes(parent.state);
  });
}

export function nodesById(nodes: PlanNode[]): Map<string, PlanNode> {
  return new Map(nodes.map((n) => [n.taskId, n]));
}

export interface DispatchInput {
  nodes: PlanNode[];
  maxParallel: number;
  /** Общий бюджет плана в USD. */
  budgetUsd?: number;
  /** Потрачено планом (узлы плюс ход `architect`). */
  totalCostUsd?: number;
  /** План остановлен человеком. */
  stopped?: boolean;
  /** Граф утверждён в текущем виде: без этого не стартует ни один узел. */
  approved?: boolean;
}

export type PlanStep =
  /** Запустить эти узлы (`taskId`) — они готовы и влезли в лимит параллельности. */
  | { action: 'start'; taskIds: string[] }
  /** Ждать: есть идущие узлы или узлы, ждущие решения человека. */
  | { action: 'wait'; reason: 'running' | 'conflict' | 'not_approved' }
  /** План закончился. */
  | { action: 'finish'; outcome: PlanOutcome; reason?: string };

/**
 * Решение диспетчера. Порядок важен:
 * остановка человеком → исчерпанный бюджет → неутверждённый граф → запуск готовых узлов →
 * ожидание идущих и конфликтов → исход плана.
 *
 * Бюджет не обрывает уже идущие узлы: у каждого свой бюджет цикла, а прерванная посреди
 * итерации работа всё равно оплачена (decision-49 п. 3).
 */
export function decidePlanStep(input: DispatchInput): PlanStep {
  const { nodes } = input;
  const busy = nodes.filter(isBusy);
  const waiting = nodes.filter((n) => WAITING_HUMAN.includes(n.state));

  if (input.stopped) {
    if (busy.length > 0) return { action: 'wait', reason: 'running' };
    return { action: 'finish', outcome: 'stopped', reason: 'План остановлен человеком' };
  }

  const overBudget =
    input.budgetUsd !== undefined && input.budgetUsd > 0 && (input.totalCostUsd ?? 0) >= input.budgetUsd;
  if (overBudget) {
    if (busy.length > 0) return { action: 'wait', reason: 'running' };
    const left = nodes.filter((n) => n.state === 'pending');
    if (left.length > 0) {
      return {
        action: 'finish',
        outcome: 'budget_exceeded',
        reason: `Исчерпан бюджет плана ${input.budgetUsd?.toFixed(2)} $: не запущено подзадач — ${left.length}`
      };
    }
  }

  const byId = nodesById(nodes);
  const ready = nodes.filter((n) => isReady(n, byId));

  if (!overBudget && ready.length > 0) {
    if (input.approved !== true) return { action: 'wait', reason: 'not_approved' };
    const limit = Math.min(Math.max(1, Math.floor(input.maxParallel)), MAX_PLAN_PARALLEL);
    const free = Math.max(0, limit - busy.length);
    if (free > 0) return { action: 'start', taskIds: ready.slice(0, free).map((n) => n.taskId) };
  }

  if (busy.length > 0) return { action: 'wait', reason: 'running' };
  if (waiting.length > 0) return { action: 'wait', reason: 'conflict' };

  return { action: 'finish', ...planOutcome(nodes) };
}

/** Исход плана по конечным состояниям узлов. */
export function planOutcome(nodes: PlanNode[]): { outcome: PlanOutcome; reason?: string } {
  const failed = nodes.filter((n) => n.state === 'failed');
  const blocked = nodes.filter((n) => n.state === 'blocked');
  const missing = nodes.filter((n) => n.state === 'missing');
  const merged = nodes.filter((n) => n.state === 'merged');

  if (failed.length === 0 && blocked.length === 0 && missing.length === 0) {
    return { outcome: 'success' };
  }
  if (merged.length === 0) {
    return {
      outcome: 'failed',
      reason: `Ни одна подзадача не влита: провалено — ${failed.length}, заблокировано — ${blocked.length}`
    };
  }
  const parts = [
    `влито — ${merged.length}`,
    ...(failed.length > 0 ? [`провалено — ${failed.length}`] : []),
    ...(blocked.length > 0 ? [`заблокировано — ${blocked.length}`] : []),
    ...(missing.length > 0 ? [`удалено из Backlog — ${missing.length}`] : [])
  ];
  return { outcome: 'partial', reason: `Часть плана не выполнена: ${parts.join(', ')}` };
}

/**
 * Помечает `blocked` все узлы, транзитивно зависящие от узла `taskId`. Идущие узлы не трогаются:
 * они работают в своём worktree и должны договорить, даже если их результат уже некуда слить.
 * Возвращает `taskId` заблокированных узлов.
 */
export function blockDependents(nodes: PlanNode[], taskId: string, reason: string): string[] {
  const blocked: string[] = [];
  let changed = true;
  const bad = new Set([taskId]);

  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.state !== 'pending' || bad.has(node.taskId)) continue;
      if (!node.dependsOn.some((dep) => bad.has(dep))) continue;
      node.state = 'blocked';
      node.reason = reason;
      node.finishedAt = Date.now();
      bad.add(node.taskId);
      blocked.push(node.taskId);
      changed = true;
    }
  }
  return blocked;
}

/**
 * Блокирует узлы, до которых план уже никогда не дойдёт: их зависимость провалена, удалена из
 * Backlog или сама заблокирована. Без этого такой узел навсегда остался бы `pending` и молча
 * пропал из итога. Возвращает `taskId` заблокированных узлов.
 */
export function blockUnreachable(nodes: PlanNode[]): string[] {
  const blocked: string[] = [];
  for (const node of nodes) {
    if (node.state !== 'failed' && node.state !== 'missing' && node.state !== 'blocked') continue;
    const reason =
      node.state === 'missing'
        ? `Заблокирован: ${node.taskId} удалён из Backlog`
        : `Заблокирован: ${node.taskId} не выполнен`;
    blocked.push(...blockDependents(nodes, node.taskId, reason));
  }
  return blocked;
}

/**
 * Хэш графа: состав узлов и рёбер, без состояний и заголовков. По нему видно, что человек
 * изменил план после утверждения (добавил подзадачу или зависимость) — тогда нужно
 * подтвердить заново (decision-49 п. 5).
 */
export function graphHash(nodes: PlanNode[]): string {
  const canonical = nodes
    .map((n) => `${n.taskId}:${[...n.dependsOn].sort().join(',')}`)
    .sort()
    .join('|');
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/** Сводка по узлам для UI и итогового текста в родительской задаче. */
export function planProgress(nodes: PlanNode[]): {
  total: number;
  merged: number;
  running: number;
  failed: number;
  blocked: number;
  pending: number;
} {
  const count = (states: PlanNodeState[]) => nodes.filter((n) => states.includes(n.state)).length;
  return {
    total: nodes.length,
    merged: count(['merged']),
    running: count(BUSY),
    failed: count(['failed', 'missing']),
    blocked: count(['blocked', 'conflict']),
    pending: count(['pending'])
  };
}
