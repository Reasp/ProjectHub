import { describe, expect, it, vi } from 'vitest';
import { automationToolList, automationToolRun, type AutomationToolEngine } from '../../electron/services/automationTools';
import type { AutomationRuleView } from '../../electron/services/automationEngine';

/** MCP-инструменты automation_list / automation_run (TASK-74, decision-52 п. 8). */

const state = { runsToday: 0, costTodayUsd: 0 };
const views: AutomationRuleView[] = [
  { key: 'builtin:assigned-tasks', scope: 'builtin', id: 'assigned-tasks', name: 'Назначенные', active: false, enabled: false, state, builtinLimits: { dailyBudgetUsd: 5, maxRunsPerDay: 20 } },
  {
    key: 'global:docs',
    scope: 'global',
    id: 'docs',
    name: 'Доки',
    active: true,
    enabled: true,
    state,
    rule: { id: 'docs', name: 'Доки', enabled: true, trigger: { kind: 'cron', expr: '0 3 * * *', catchUp: 'skip' }, conditions: {}, action: { type: 'reindexDocs' }, limits: { cooldownMin: 10, maxRunsPerDay: 20 } }
  },
  { key: 'project:c:/a:x', scope: 'project', id: 'x', name: 'A', projectRoot: 'C:/a', active: false, enabled: false, trust: 'untrusted', state },
  { key: 'project:c:/b:y', scope: 'project', id: 'y', name: 'B', projectRoot: 'C:/b', active: false, enabled: false, trust: 'changed', state }
];

function engine(overrides: Partial<AutomationToolEngine> = {}): AutomationToolEngine {
  return {
    list: async () => views,
    readLog: async (n) => Array.from({ length: n }, (_, i) => ({ ts: String(i), ruleKey: 'k', ruleId: 'r', ruleName: 'R', scope: 'global' as const, status: 'success' as const, trigger: 'cron' })),
    runNow: async () => ({ ok: true, runIds: ['run-1'] }),
    ...overrides
  };
}

describe('automation_list', () => {
  it('отдаёт правила с состоянием и доверием; фильтр по проекту оставляет глобальные и свои', async () => {
    const all = JSON.parse(await automationToolList(engine(), {}));
    expect(all.rules.map((r: { key: string }) => r.key)).toEqual(views.map((v) => v.key));
    expect(all.rules[1]).toMatchObject({ trigger: { kind: 'cron' }, action: { type: 'reindexDocs' }, active: true });
    expect(all.recentRuns).toHaveLength(20);
    const own = JSON.parse(await automationToolList(engine(), { projectPath: 'C:/a/sub', recentRuns: 0 }));
    expect(own.rules.map((r: { key: string }) => r.key)).toEqual(['builtin:assigned-tasks', 'global:docs', 'project:c:/a:x']);
    expect(own.recentRuns).toEqual([]);
  });
});

describe('automation_run', () => {
  it('запускает правило для внешнего клиента', async () => {
    const runNow = vi.fn(async () => ({ ok: true as const, runIds: ['run-7'] }));
    const res = await automationToolRun(engine({ runNow }), { ruleKey: 'global:docs', fromAgentSession: false });
    expect(res).toEqual({ isError: false, text: JSON.stringify({ started: true, runIds: ['run-7'] }) });
    expect(runNow).toHaveBeenCalledWith('global:docs', 'mcp');
  });

  it('отклоняется из сессии агента ProjectHub и без ключа; причину отказа движка передаёт', async () => {
    const runNow = vi.fn(async () => ({ ok: false as const, reason: 'Проектное правило не подтверждено на этой машине' }));
    expect((await automationToolRun(engine({ runNow }), { ruleKey: 'global:docs', fromAgentSession: true })).isError).toBe(true);
    expect(runNow).not.toHaveBeenCalled();
    expect((await automationToolRun(engine({ runNow }), { ruleKey: ' ', fromAgentSession: false })).text).toMatch(/ruleKey/);
    const refused = await automationToolRun(engine({ runNow }), { ruleKey: 'project:c:/a:x', fromAgentSession: false });
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toMatch(/не подтверждено/);
  });
});
