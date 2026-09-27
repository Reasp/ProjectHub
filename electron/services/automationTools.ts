import { isPathInside } from './automationRules.js';
import type { AutomationRuleView, RunNowResult } from './automationEngine.js';
import type { AutomationLogEntry } from './automationStore.js';

/**
 * MCP-инструменты Automations (TASK-74, decision-52 п. 8) без привязки к MCP SDK: встроенный
 * сервер только передаёт аргументы и признак «вызов из сессии агента ProjectHub».
 */

export interface AutomationToolEngine {
  list(): Promise<AutomationRuleView[]>;
  readLog(limit: number): Promise<AutomationLogEntry[]>;
  runNow(key: string, source: 'ui' | 'mcp'): Promise<RunNowResult>;
}

function compactRule(view: AutomationRuleView) {
  return {
    key: view.key,
    scope: view.scope,
    name: view.name,
    ...(view.projectRoot ? { projectRoot: view.projectRoot } : {}),
    active: view.active,
    ...(view.trust ? { trust: view.trust } : {}),
    ...(view.rule ? { trigger: view.rule.trigger, action: view.rule.action, limits: view.rule.limits } : {}),
    ...(view.builtinLimits ? { limits: view.builtinLimits } : {}),
    ...(view.issue ? { issue: view.issue } : {}),
    state: view.state
  };
}

export async function automationToolList(
  engine: AutomationToolEngine,
  args: { projectPath?: string; recentRuns?: number }
): Promise<string> {
  const views = await engine.list();
  const filtered = args.projectPath ? views.filter((v) => v.scope !== 'project' || isPathInside(args.projectPath, v.projectRoot)) : views;
  const limit = typeof args.recentRuns === 'number' && Number.isFinite(args.recentRuns) ? Math.max(0, Math.min(100, Math.round(args.recentRuns))) : 20;
  const log = limit ? await engine.readLog(limit) : [];
  return JSON.stringify({ rules: filtered.map(compactRule), recentRuns: log }, null, 2);
}

/**
 * Ручной запуск. Из сессии агента ProjectHub отклоняется: агент, запускающий автоматизации, обходил
 * бы учёт цепочек «запуск → событие → запуск» (decision-52 п. 5, 8).
 */
export async function automationToolRun(
  engine: AutomationToolEngine,
  args: { ruleKey: string; fromAgentSession: boolean }
): Promise<{ isError: boolean; text: string }> {
  if (args.fromAgentSession) {
    return { isError: true, text: 'ProjectHub: automation_run недоступен агентам ProjectHub — автоматизации запускает человек или внешний клиент.' };
  }
  const key = String(args.ruleKey || '').trim();
  if (!key) return { isError: true, text: 'ProjectHub: не указан ruleKey — возьмите ключ из automation_list.' };
  const res = await engine.runNow(key, 'mcp');
  return res.ok
    ? { isError: false, text: JSON.stringify({ started: true, runIds: res.runIds }) }
    : { isError: true, text: `ProjectHub: правило не запущено — ${res.reason}` };
}
