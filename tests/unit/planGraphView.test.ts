import { describe, expect, it } from 'vitest';
import { formatPlanCost, nodeTone, planActions, planCounts, planLevels } from '../../src/lib/planGraphView';
import type { PlanNode, PlanNodeState, PlanState } from '../../src/types/electron';

/** Представление плана в UI (TASK-80.3, decision-49). */

const node = (taskId: string, state: PlanNodeState = 'pending', dependsOn: string[] = []): PlanNode => ({
  key: taskId.toLowerCase(),
  taskId,
  title: `Подзадача ${taskId}`,
  state,
  dependsOn
});

const plan = (patch: Partial<PlanState> = {}): PlanState => ({
  id: 'plan-1',
  projectPath: 'C:/p',
  taskId: 'TASK-1',
  phase: 'awaiting_approval',
  createdAt: 1,
  updatedAt: 1,
  settings: { maxParallel: 2 },
  nodes: [node('TASK-1.1')],
  architect: { attempts: 1 },
  ...patch
});

describe('раскладка графа по уровням', () => {
  it('независимые узлы — на одном уровне, зависимый — ниже', () => {
    const nodes = [node('A'), node('B'), node('C', 'pending', ['A', 'B'])];
    expect(planLevels(nodes).map((level) => level.map((n) => n.taskId))).toEqual([['A', 'B'], ['C']]);
  });

  it('цепочка даёт по уровню на узел', () => {
    const nodes = [node('A'), node('B', 'pending', ['A']), node('C', 'pending', ['B'])];
    expect(planLevels(nodes)).toHaveLength(3);
  });

  it('зависимость вне плана не влияет на уровень', () => {
    expect(planLevels([node('A', 'pending', ['TASK-999'])])).toEqual([[expect.objectContaining({ taskId: 'A' })]]);
  });

  it('цикл не зацикливает раскладку', () => {
    const nodes = [node('A', 'pending', ['B']), node('B', 'pending', ['A'])];
    expect(planLevels(nodes).flat()).toHaveLength(2);
  });

  it('пустой план даёт пустую раскладку', () => {
    expect(planLevels([])).toEqual([]);
  });
});

describe('тон узла', () => {
  it('состояния разложены по тонам', () => {
    expect(nodeTone('merged')).toBe('done');
    expect(nodeTone('running')).toBe('active');
    expect(nodeTone('conflict')).toBe('warn');
    expect(nodeTone('failed')).toBe('error');
    expect(nodeTone('skipped')).toBe('muted');
    expect(nodeTone('pending')).toBe('idle');
  });
});

describe('доступность действий', () => {
  it('без плана можно только сгенерировать', () => {
    expect(planActions(null)).toMatchObject({ canGenerate: true, canApprove: false, canStop: false });
  });

  it('план ждёт утверждения: можно утвердить и перегенерировать', () => {
    expect(planActions(plan())).toMatchObject({ canGenerate: true, canApprove: true, canStop: false, busy: false });
  });

  it('во время генерации и работы нельзя генерировать заново', () => {
    expect(planActions(plan({ phase: 'planning' }))).toMatchObject({ canGenerate: false, busy: true });
    expect(planActions(plan({ phase: 'running' }))).toMatchObject({ canGenerate: false, canStop: true, busy: true });
  });

  it('остановленный план нельзя остановить повторно', () => {
    expect(planActions(plan({ phase: 'running', stopped: true })).canStop).toBe(false);
  });

  it('план без узлов утвердить нельзя', () => {
    expect(planActions(plan({ nodes: [] })).canApprove).toBe(false);
  });

  it('изменённый после утверждения граф требует повторного подтверждения', () => {
    const running = plan({ phase: 'running', approvedGraphHash: 'aaa' });
    expect(planActions(running, 'aaa')).toMatchObject({ needsReapproval: false, canApprove: false });
    expect(planActions(running, 'bbb')).toMatchObject({ needsReapproval: true, canApprove: true });
  });
});

describe('сводка и стоимость', () => {
  it('считает узлы по группам', () => {
    const nodes = [node('A', 'merged'), node('B', 'running'), node('C', 'conflict'), node('D'), node('E', 'skipped')];
    expect(planCounts(nodes)).toEqual({ total: 5, merged: 1, running: 1, problem: 1, pending: 2 });
  });

  it('стоимость показывается с бюджетом и без', () => {
    expect(formatPlanCost(1.234)).toBe('1.23 $');
    expect(formatPlanCost(1.2, 5)).toBe('1.20 $ / 5.00 $');
    expect(formatPlanCost(undefined, 5)).toBe('— / 5.00 $');
    expect(formatPlanCost(undefined)).toBe('—');
  });
});
