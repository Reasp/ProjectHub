import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_MAX_PARALLEL,
  MAX_PLAN_PARALLEL,
  blockDependents,
  decidePlanStep,
  graphHash,
  isReady,
  nodesById,
  planOutcome,
  planProgress
} from '../../electron/services/planDispatcher';
import type { PlanNode, PlanNodeState } from '../../electron/services/planTypes';

/** Диспетчер плана (TASK-80.1, decision-49 п. 3, 5). */

const node = (taskId: string, state: PlanNodeState = 'pending', dependsOn: string[] = []): PlanNode => ({
  key: taskId.toLowerCase(),
  taskId,
  title: `Подзадача ${taskId}`,
  state,
  dependsOn
});

const step = (nodes: PlanNode[], extra: Partial<Parameters<typeof decidePlanStep>[0]> = {}) =>
  decidePlanStep({ nodes, maxParallel: DEFAULT_PLAN_MAX_PARALLEL, approved: true, ...extra });

describe('готовность узла', () => {
  it('узел без зависимостей готов, с незавершённой зависимостью — нет', () => {
    const nodes = [node('A'), node('B', 'pending', ['A'])];
    const byId = nodesById(nodes);
    expect(isReady(nodes[0], byId)).toBe(true);
    expect(isReady(nodes[1], byId)).toBe(false);
  });

  it('зависимость удовлетворяет только merged или skipped, но не completed', () => {
    const cases: [PlanNodeState, boolean][] = [
      ['merged', true],
      ['skipped', true],
      ['completed', false],
      ['merging', false],
      ['conflict', false],
      ['failed', false],
      ['missing', false]
    ];
    for (const [state, ready] of cases) {
      const nodes = [node('A', state), node('B', 'pending', ['A'])];
      expect([state, isReady(nodes[1], nodesById(nodes))]).toEqual([state, ready]);
    }
  });

  it('зависимость вне плана (дописана человеком) не блокирует узел', () => {
    const nodes = [node('B', 'pending', ['TASK-999'])];
    expect(isReady(nodes[0], nodesById(nodes))).toBe(true);
  });

  it('узел не в состоянии pending не готов', () => {
    const nodes = [node('A', 'blocked')];
    expect(isReady(nodes[0], nodesById(nodes))).toBe(false);
  });
});

describe('решение диспетчера', () => {
  it('запускает готовые узлы в пределах лимита параллельности', () => {
    const nodes = [node('A'), node('B'), node('C'), node('D', 'pending', ['A'])];
    expect(step(nodes)).toEqual({ action: 'start', taskIds: ['A', 'B'] });
    expect(step(nodes, { maxParallel: 1 })).toEqual({ action: 'start', taskIds: ['A'] });
  });

  it('учитывает уже занятые слоты и ждёт, когда свободных нет', () => {
    const nodes = [node('A', 'running'), node('B', 'merging'), node('C')];
    expect(step(nodes)).toEqual({ action: 'wait', reason: 'running' });
    expect(step(nodes, { maxParallel: 3 })).toEqual({ action: 'start', taskIds: ['C'] });
  });

  it('не превышает жёсткий потолок параллельности', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => node(`T${i}`));
    const res = step(nodes, { maxParallel: 99 });
    expect(res.action === 'start' && res.taskIds).toHaveLength(MAX_PLAN_PARALLEL);
  });

  it('без утверждения графа не запускает ничего', () => {
    expect(step([node('A')], { approved: false })).toEqual({ action: 'wait', reason: 'not_approved' });
    expect(step([node('A')], { approved: undefined })).toEqual({ action: 'wait', reason: 'not_approved' });
  });

  it('зависимый узел стартует только после слияния предшественника', () => {
    const nodes = [node('A', 'completed'), node('B', 'pending', ['A'])];
    expect(step(nodes)).toEqual({ action: 'wait', reason: 'running' });
    nodes[0].state = 'merged';
    expect(step(nodes)).toEqual({ action: 'start', taskIds: ['B'] });
  });

  it('остановка человеком: ждёт идущие, затем завершает план', () => {
    const running = [node('A', 'running'), node('B')];
    expect(step(running, { stopped: true })).toEqual({ action: 'wait', reason: 'running' });
    const idle = [node('A', 'merged'), node('B')];
    expect(step(idle, { stopped: true })).toMatchObject({ action: 'finish', outcome: 'stopped' });
  });

  it('исчерпанный бюджет не обрывает идущие узлы, но не даёт запускать новые', () => {
    const busy = [node('A', 'running'), node('B')];
    expect(step(busy, { budgetUsd: 1, totalCostUsd: 1.2 })).toEqual({ action: 'wait', reason: 'running' });
    const idle = [node('A', 'merged'), node('B')];
    const res = step(idle, { budgetUsd: 1, totalCostUsd: 1.2 });
    expect(res).toMatchObject({ action: 'finish', outcome: 'budget_exceeded' });
    expect(res.action === 'finish' && res.reason).toContain('не запущено подзадач — 1');
  });

  it('бюджет не мешает, пока он не исчерпан', () => {
    expect(step([node('A')], { budgetUsd: 2, totalCostUsd: 0.5 })).toEqual({ action: 'start', taskIds: ['A'] });
  });

  it('конфликт слияния держит план в ожидании решения человека', () => {
    const nodes = [node('A', 'conflict'), node('B', 'pending', ['A'])];
    expect(step(nodes)).toEqual({ action: 'wait', reason: 'conflict' });
  });

  it('все узлы влиты — план успешен', () => {
    expect(step([node('A', 'merged'), node('B', 'merged')])).toEqual({ action: 'finish', outcome: 'success' });
  });

  it('пропущенные до старта узлы не мешают успеху', () => {
    expect(step([node('A', 'merged'), node('B', 'skipped')])).toEqual({ action: 'finish', outcome: 'success' });
  });
});

describe('исход плана', () => {
  it('частичный успех перечисляет, что не выполнено', () => {
    const res = planOutcome([node('A', 'merged'), node('B', 'failed'), node('C', 'blocked')]);
    expect(res.outcome).toBe('partial');
    expect(res.reason).toContain('влито — 1');
    expect(res.reason).toContain('провалено — 1');
    expect(res.reason).toContain('заблокировано — 1');
  });

  it('без единого слияния план считается проваленным', () => {
    expect(planOutcome([node('A', 'failed'), node('B', 'blocked')]).outcome).toBe('failed');
  });

  it('удалённая из Backlog подзадача попадает в итог', () => {
    const res = planOutcome([node('A', 'merged'), node('B', 'missing')]);
    expect(res.outcome).toBe('partial');
    expect(res.reason).toContain('удалено из Backlog — 1');
  });
});

describe('блокировка зависимых', () => {
  it('блокирует зависимых транзитивно и не трогает независимых', () => {
    const nodes = [node('A', 'failed'), node('B', 'pending', ['A']), node('C', 'pending', ['B']), node('D')];
    const blocked = blockDependents(nodes, 'A', 'Провалилась TASK-A');
    expect(blocked).toEqual(['B', 'C']);
    expect(nodes.map((n) => n.state)).toEqual(['failed', 'blocked', 'blocked', 'pending']);
    expect(nodes[1].reason).toBe('Провалилась TASK-A');
  });

  it('не трогает уже идущие узлы', () => {
    const nodes = [node('A', 'failed'), node('B', 'running', ['A'])];
    expect(blockDependents(nodes, 'A', 'x')).toEqual([]);
    expect(nodes[1].state).toBe('running');
  });
});

describe('хэш графа и прогресс', () => {
  it('не меняется от состояний, заголовков и порядка узлов', () => {
    const a = [node('A'), node('B', 'pending', ['A'])];
    const b = [node('B', 'merged', ['A']), { ...node('A', 'running'), title: 'другой' }];
    expect(graphHash(a)).toBe(graphHash(b));
  });

  it('меняется от новых узлов и новых зависимостей', () => {
    const base = [node('A'), node('B')];
    expect(graphHash(base)).not.toBe(graphHash([...base, node('C')]));
    expect(graphHash(base)).not.toBe(graphHash([node('A'), node('B', 'pending', ['A'])]));
  });

  it('прогресс считает узлы по группам состояний', () => {
    const nodes = [node('A', 'merged'), node('B', 'running'), node('C', 'failed'), node('D', 'conflict'), node('E')];
    expect(planProgress(nodes)).toEqual({ total: 5, merged: 1, running: 1, failed: 1, blocked: 1, pending: 1 });
  });
});
