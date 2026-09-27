import { describe, expect, it } from 'vitest';
import type { AppBusEvent } from '../../electron/services/hitlTypes';
import {
  AutomationRuleSchema,
  CHAIN_ATTRIBUTION_WINDOW_MS,
  MAX_CHAIN_DEPTH,
  attributeEvent,
  automationEventsFromBus,
  emptyRuleState,
  gateRun,
  isPathInside,
  localDayKey,
  matchRuleEvent,
  nextLocalMidnight,
  parseRules,
  recordRunCost,
  recordRunStart,
  renderTemplate,
  rollRuleState,
  ruleHash,
  ruleKey,
  trustStatus,
  validateRule,
  validateRuleForScope,
  wildcardMatch,
  type AutomationEvent,
  type AutomationRule,
  type AutomationRuleInput,
  type RunGateInput,
  type RunTrace
} from '../../electron/services/automationRules';

/**
 * Правила Automations (TASK-74, decision-52): схема, матчинг, лимиты, причинность, доверие.
 * Это место, где приложение решает запустить агента без человека, — каждое условие отдельно.
 */

const ROOT = 'C:/Work/app';

function rule(overrides: Partial<AutomationRuleInput> = {}): AutomationRule {
  return AutomationRuleSchema.parse({
    id: 'review-checks',
    name: 'Чеки на ревью',
    enabled: true,
    trigger: { kind: 'event', event: 'task.statusChanged' },
    action: { type: 'runChecks' },
    ...overrides
  });
}

const agentRule = (overrides: Partial<AutomationRuleInput> = {}) =>
  rule({ action: { type: 'runAgent', roleSlug: 'implementer' }, limits: { dailyBudgetUsd: 2 }, ...overrides });

function taskEvent(overrides: Partial<AutomationEvent> = {}): AutomationEvent {
  return {
    kind: 'task.statusChanged',
    projectPath: ROOT,
    subject: 'task:TASK-5',
    summary: 'TASK-5: In Progress → Review',
    taskId: 'TASK-5',
    taskTitle: 'Пятая',
    labels: ['backend'],
    statusFrom: 'In Progress',
    statusTo: 'Review',
    assignee: ['agent:dev'],
    at: 1,
    ...overrides
  };
}

describe('схема правила', () => {
  it('заполняет значения по умолчанию', () => {
    const r = AutomationRuleSchema.parse({
      id: 'nightly',
      name: 'Ночью',
      trigger: { kind: 'cron', expr: '0 3 * * *' },
      action: { type: 'reindexDocs' }
    });
    expect(r.enabled).toBe(false);
    expect(r.trigger).toEqual({ kind: 'cron', expr: '0 3 * * *', catchUp: 'skip' });
    expect(r.limits).toEqual({ cooldownMin: 10, maxRunsPerDay: 20 });
    expect(r.conditions).toEqual({});
  });

  it('запуск агента требует дневной бюджет и cooldown не меньше минуты', () => {
    const noBudget = validateRule({ id: 'a', name: 'A', trigger: { kind: 'event', event: 'task.assigned' }, action: { type: 'runAgent', roleSlug: 'dev' } });
    expect(noBudget).toMatchObject({ ok: false });
    expect(!noBudget.ok && noBudget.error).toMatch(/дневной бюджет/);
    const zeroCooldown = validateRule({
      id: 'a',
      name: 'A',
      trigger: { kind: 'event', event: 'task.assigned' },
      action: { type: 'runAgent', roleSlug: 'dev' },
      limits: { dailyBudgetUsd: 1, cooldownMin: 0 }
    });
    expect(!zeroCooldown.ok && zeroCooldown.error).toMatch(/Cooldown/);
  });

  it('агенту без задачи нужен промпт, циклу «до готовности» — задача', () => {
    const base = { id: 'a', name: 'A', trigger: { kind: 'cron', expr: '0 9 * * 1' }, limits: { dailyBudgetUsd: 1 } };
    const noPrompt = validateRule({ ...base, action: { type: 'runAgent', roleSlug: 'dev' } });
    expect(!noPrompt.ok && noPrompt.error).toMatch(/промпт/);
    const loop = validateRule({ ...base, action: { type: 'runAgent', roleSlug: 'dev', mode: 'doneLoop', prompt: 'x' } });
    expect(!loop.ok && loop.error).toMatch(/требует задачу/);
    expect(validateRule({ ...base, action: { type: 'runAgent', roleSlug: 'dev', mode: 'doneLoop', taskId: 'TASK-1' } }).ok).toBe(true);
  });

  it('отклоняет неверный cron, неизвестный триггер и действие', () => {
    const cron = validateRule({ id: 'a', name: 'A', trigger: { kind: 'cron', expr: '61 * * * *' }, action: { type: 'reindexDocs' } });
    expect(!cron.ok && cron.error).toMatch(/trigger\.expr/);
    expect(validateRule({ id: 'a', name: 'A', trigger: { kind: 'event', event: 'docs.changed' }, action: { type: 'reindexDocs' } }).ok).toBe(false);
    expect(validateRule({ id: 'a', name: 'A', trigger: { kind: 'manual' }, action: { type: 'deleteEverything' } }).ok).toBe(false);
    expect(validateRule({ id: 'плохой id', name: 'A', trigger: { kind: 'manual' }, action: { type: 'reindexDocs' } }).ok).toBe(false);
  });

  it('parseRules: неверные правила и дубликаты — ошибками, остальные разбираются', () => {
    const { rules, issues } = parseRules([
      { id: 'ok', name: 'OK', trigger: { kind: 'manual' }, action: { type: 'reindexDocs' } },
      { id: 'bad', name: '', trigger: { kind: 'manual' }, action: { type: 'reindexDocs' } },
      { id: 'ok', name: 'Снова', trigger: { kind: 'manual' }, action: { type: 'reindexDocs' } }
    ]);
    expect(rules.map((r) => r.id)).toEqual(['ok']);
    expect(issues.map((i) => i.id)).toEqual(['bad', 'ok']);
    expect(parseRules({}).issues[0].message).toMatch(/массив/);
    expect(parseRules(undefined)).toEqual({ rules: [], issues: [] });
  });

  it('проверки области: глобальному cron нужен проект, проектному projects не нужен', () => {
    const cron = rule({ trigger: { kind: 'cron', expr: '0 3 * * *' }, action: { type: 'reindexDocs' } });
    expect(validateRuleForScope(cron, { kind: 'global' })).toMatch(/список проектов/);
    expect(validateRuleForScope({ ...cron, conditions: { projects: [ROOT] } }, { kind: 'global' })).toBeNull();
    expect(validateRuleForScope({ ...cron, conditions: { projects: [ROOT] } }, { kind: 'project', projectRoot: ROOT })).toMatch(/своему проекту/);
    expect(validateRuleForScope({ ...cron, action: { type: 'notify', title: 'x' } }, { kind: 'global' })).toBeNull();
  });
});

describe('доверие к проектным правилам', () => {
  it('хэш не зависит от порядка ключей и флага enabled, но меняется с содержимым', () => {
    const a = rule();
    const reordered = AutomationRuleSchema.parse({ action: { type: 'runChecks' }, trigger: { event: 'task.statusChanged', kind: 'event' }, name: 'Чеки на ревью', id: 'review-checks' });
    expect(ruleHash(reordered)).toBe(ruleHash(a));
    expect(ruleHash({ ...a, enabled: false })).toBe(ruleHash(a));
    expect(ruleHash(rule({ action: { type: 'runChecks', checkIds: ['lint'] } }))).not.toBe(ruleHash(a));
  });

  it('статус доверия: нет подтверждения, подтверждено, изменено после подтверждения', () => {
    const a = rule();
    expect(trustStatus(a, undefined)).toBe('untrusted');
    expect(trustStatus(a, ruleHash(a))).toBe('trusted');
    expect(trustStatus(rule({ name: 'Другое' }), ruleHash(a))).toBe('changed');
  });

  it('ключ правила различает источники', () => {
    expect(ruleKey({ kind: 'global' }, 'x')).toBe('global:x');
    expect(ruleKey({ kind: 'project', projectRoot: 'C:\\Work\\App\\' }, 'x')).toBe(`project:${process.platform === 'linux' ? 'C:/Work/App' : 'c:/work/app'}:x`);
  });
});

describe('события шины → события автоматизаций', () => {
  it('изменение задачи даёт updated, statusChanged и assigned', () => {
    const event: AppBusEvent = {
      type: 'task:updated',
      projectPath: ROOT,
      taskId: 'TASK-5',
      title: 'Пятая',
      status: 'Review',
      assignee: ['@ivan', 'agent:qa@h1'],
      labels: ['backend'],
      created: false,
      changes: { status: { from: 'In Progress', to: 'Review' }, assignee: { from: ['@ivan'], to: ['@ivan', 'agent:qa@h1'] } },
      at: 5
    };
    const out = automationEventsFromBus(event);
    expect(out.map((e) => e.kind)).toEqual(['task.updated', 'task.statusChanged', 'task.assigned']);
    expect(out[1]).toMatchObject({ statusFrom: 'In Progress', statusTo: 'Review', subject: 'task:TASK-5' });
    expect(out[2].assignee).toEqual(['agent:qa@h1']);
  });

  it('рой, процесс, PR, устройство; служебные события не превращаются', () => {
    const swarm = automationEventsFromBus({
      type: 'swarm:finished', swarmId: 's1', projectPath: ROOT, name: 'x', mode: 'fan-out', outcome: 'failed', agentsTotal: 1, agentsFailed: 1, at: 1
    });
    expect(swarm[0]).toMatchObject({ kind: 'swarm.finished', outcome: 'failed', swarmId: 's1', subject: 'swarm:s1' });
    expect(automationEventsFromBus({ type: 'pr:checksFailed', projectPath: ROOT, number: 7, title: 't', url: 'u', at: 1 })[0].subject).toBe('pr:7');
    expect(automationEventsFromBus({ type: 'process:crashed', processId: 'p', name: 'dev', projectPath: ROOT, at: 1 })[0].processName).toBe('dev');
    expect(automationEventsFromBus({ type: 'remote:deviceConnected', deviceId: 'd', deviceName: 'Телефон', mode: 'full', isApproved: true, at: 1 })[0].projectPath).toBeUndefined();
    expect(automationEventsFromBus({ type: 'automation:notify', ruleId: 'r', ruleName: 'r', title: 't', at: 1 })).toEqual([]);
  });
});

describe('матчинг условий', () => {
  it('статус «в» и «из», регистр не важен', () => {
    const r = rule({ conditions: { statusTo: ['review'], statusFrom: ['In Progress'] } });
    expect(matchRuleEvent(r, { kind: 'global' }, taskEvent())).toBe(true);
    expect(matchRuleEvent(r, { kind: 'global' }, taskEvent({ statusTo: 'Done' }))).toBe(false);
    expect(matchRuleEvent(r, { kind: 'global' }, taskEvent({ statusFrom: 'To Do' }))).toBe(false);
  });

  it('другой триггер не совпадает', () => {
    expect(matchRuleEvent(rule(), { kind: 'global' }, taskEvent({ kind: 'task.assigned' }))).toBe(false);
    expect(matchRuleEvent(rule({ trigger: { kind: 'manual' } }), { kind: 'global' }, taskEvent())).toBe(false);
  });

  it('labels — любой из, исполнитель по шаблону', () => {
    expect(matchRuleEvent(rule({ conditions: { labels: ['Frontend', 'BACKEND'] } }), { kind: 'global' }, taskEvent())).toBe(true);
    expect(matchRuleEvent(rule({ conditions: { labels: ['docs'] } }), { kind: 'global' }, taskEvent())).toBe(false);
    expect(matchRuleEvent(rule({ conditions: { assignee: 'agent:*' } }), { kind: 'global' }, taskEvent())).toBe(true);
    expect(matchRuleEvent(rule({ conditions: { assignee: '@*' } }), { kind: 'global' }, taskEvent())).toBe(false);
  });

  it('проектное правило ловит события своего проекта и его worktree, но не чужого', () => {
    const scope = { kind: 'project' as const, projectRoot: ROOT };
    expect(matchRuleEvent(rule(), scope, taskEvent({ projectPath: `${ROOT}/.worktrees/swarm-1` }))).toBe(true);
    expect(matchRuleEvent(rule(), scope, taskEvent({ projectPath: 'C:/Work/app-other' }))).toBe(false);
  });

  it('глобальное правило с проектами и без', () => {
    expect(matchRuleEvent(rule(), { kind: 'global' }, taskEvent({ projectPath: 'D:/any' }))).toBe(true);
    const scoped = rule({ conditions: { projects: [ROOT] } });
    expect(matchRuleEvent(scoped, { kind: 'global' }, taskEvent())).toBe(true);
    expect(matchRuleEvent(scoped, { kind: 'global' }, taskEvent({ projectPath: 'D:/any' }))).toBe(false);
  });

  it('исход роя и имя процесса', () => {
    const swarmRule = rule({ trigger: { kind: 'event', event: 'swarm.finished' }, conditions: { outcomes: ['failed'] } });
    const ev = { kind: 'swarm.finished' as const, projectPath: ROOT, subject: 'swarm:1', summary: '', at: 1 };
    expect(matchRuleEvent(swarmRule, { kind: 'global' }, { ...ev, outcome: 'failed' })).toBe(true);
    expect(matchRuleEvent(swarmRule, { kind: 'global' }, { ...ev, outcome: 'completed' })).toBe(false);
    const procRule = rule({ trigger: { kind: 'event', event: 'process.crashed' }, conditions: { processName: 'dev*' } });
    const pev = { kind: 'process.crashed' as const, projectPath: ROOT, subject: 'process:dev-server', summary: '', at: 1 };
    expect(matchRuleEvent(procRule, { kind: 'global' }, { ...pev, processName: 'dev-server' })).toBe(true);
    expect(matchRuleEvent(procRule, { kind: 'global' }, { ...pev, processName: 'test' })).toBe(false);
  });

  it('шаблон с * экранирует спецсимволы', () => {
    expect(wildcardMatch('agent:dev@h.1', 'agent:dev@hx1')).toBe(false);
    expect(wildcardMatch('a*b', 'a-anything-b')).toBe(true);
    expect(isPathInside('C:/Work/application', ROOT)).toBe(false);
  });
});

describe('лимиты и cooldown', () => {
  const NOW = new Date(2026, 8, 27, 12, 0).getTime();

  function gate(overrides: Partial<RunGateInput> = {}) {
    const r = agentRule();
    return gateRun({
      ruleKey: 'global:review-checks',
      action: r.action,
      limits: r.limits,
      state: emptyRuleState(NOW),
      now: NOW,
      subject: 'task:TASK-5',
      activeAgentRuns: 0,
      maxConcurrentAgentRuns: 2,
      ...overrides
    });
  }

  it('разрешает с бюджетом запуска = остаток дня или бюджет действия, что меньше', () => {
    expect(gate()).toEqual({ allow: true, depth: 0, budgetUsd: 2 });
    expect(gate({ state: { ...emptyRuleState(NOW), costTodayUsd: 1.5 } })).toMatchObject({ allow: true, budgetUsd: 0.5 });
    const cheap = agentRule({ action: { type: 'runAgent', roleSlug: 'dev', budgetUsd: 0.3 } });
    expect(gate({ action: cheap.action })).toMatchObject({ allow: true, budgetUsd: 0.3 });
  });

  it('cooldown по предмету; ручной запуск его обходит', () => {
    const state = { ...emptyRuleState(NOW), lastRunBySubject: { 'task:TASK-5': NOW - 5 * 60 * 1000 } };
    expect(gate({ state })).toEqual({ allow: false, reason: 'cooldown', log: false });
    expect(gate({ state, subject: 'task:TASK-6' }).allow).toBe(true);
    expect(gate({ state, manual: true }).allow).toBe(true);
    expect(gate({ state: { ...state, lastRunBySubject: { 'task:TASK-5': NOW - 11 * 60 * 1000 } } }).allow).toBe(true);
  });

  it('исчерпанные запуски и бюджет приостанавливают правило до полуночи', () => {
    const midnight = nextLocalMidnight(NOW);
    expect(gate({ state: { ...emptyRuleState(NOW), runsToday: 20 } })).toEqual({
      allow: false, reason: 'runs-limit', log: true, suspend: { reason: 'runs', until: midnight }
    });
    expect(gate({ state: { ...emptyRuleState(NOW), costTodayUsd: 2 } })).toEqual({
      allow: false, reason: 'budget', log: true, suspend: { reason: 'budget', until: midnight }
    });
  });

  it('пауза и параллельность', () => {
    expect(gate({ state: { ...emptyRuleState(NOW), pausedUntil: NOW + 1000, pauseReason: 'budget' } })).toMatchObject({ allow: false, reason: 'paused', log: false });
    expect(gate({ activeAgentRuns: 2 })).toMatchObject({ allow: false, reason: 'concurrency', log: true });
    // Без агента бюджет и параллельность не участвуют.
    const checks = rule();
    expect(gateRun({ ...{ ruleKey: 'k', subject: 's', now: NOW, activeAgentRuns: 9, maxConcurrentAgentRuns: 1 }, action: checks.action, limits: checks.limits, state: emptyRuleState(NOW) })).toEqual({ allow: true, depth: 0 });
  });

  it('цепочки: своё событие не запускает правило, глубина ограничена', () => {
    expect(gate({ chain: { parentRunId: 'r1', parentRuleKey: 'global:review-checks', depth: 0 } })).toMatchObject({ allow: false, reason: 'chain-self', log: false });
    expect(gate({ chain: { parentRunId: 'r1', parentRuleKey: 'global:other', depth: 1 } })).toMatchObject({ allow: true, depth: 2 });
    expect(gate({ chain: { parentRunId: 'r1', parentRuleKey: 'global:other', depth: MAX_CHAIN_DEPTH } })).toMatchObject({ allow: false, reason: 'chain-depth', log: true });
  });

  it('учёт старта и стоимости ставит паузу при достижении лимитов', () => {
    const limits = agentRule({ limits: { dailyBudgetUsd: 1, maxRunsPerDay: 2 } }).limits;
    let { state, suspend } = recordRunStart(emptyRuleState(NOW), 'task:TASK-5', limits, NOW);
    expect(state).toMatchObject({ runsToday: 1, lastRunAt: NOW, lastRunBySubject: { 'task:TASK-5': NOW } });
    expect(suspend).toBeUndefined();
    ({ state, suspend } = recordRunStart(state, 'task:TASK-6', limits, NOW));
    expect(suspend).toEqual({ reason: 'runs', until: nextLocalMidnight(NOW) });
    expect(state.pausedUntil).toBe(nextLocalMidnight(NOW));

    const cost = recordRunCost(emptyRuleState(NOW), 0.6, limits, NOW);
    expect(cost.suspend).toBeUndefined();
    const over = recordRunCost(cost.state, 0.45, limits, NOW);
    expect(over.suspend).toEqual({ reason: 'budget', until: nextLocalMidnight(NOW) });
    expect(over.state.costTodayUsd).toBeCloseTo(1.05);
    // Неизвестная стоимость (локальная модель) — ноль.
    expect(recordRunCost(emptyRuleState(NOW), undefined, limits, NOW).state.costTodayUsd).toBe(0);
  });

  it('новый день сбрасывает счётчики и паузу, старые метки cooldown выбрасываются', () => {
    const yesterday = NOW - 24 * 60 * 60 * 1000;
    const state = {
      ...emptyRuleState(yesterday),
      runsToday: 20,
      costTodayUsd: 3,
      pausedUntil: nextLocalMidnight(yesterday),
      pauseReason: 'runs' as const,
      lastRunBySubject: { old: yesterday - 60_000, fresh: NOW - 60_000 }
    };
    const rolled = rollRuleState(state, NOW);
    expect(rolled).toMatchObject({ day: localDayKey(NOW), runsToday: 0, costTodayUsd: 0, lastRunBySubject: { fresh: NOW - 60_000 } });
    expect(rolled.pausedUntil).toBeUndefined();
    expect(rolled.lastRunBySubject.old).toBeUndefined();
  });
});

describe('причинность событий', () => {
  const NOW = 10_000_000;
  const run = (overrides: Partial<RunTrace> = {}): RunTrace => ({
    runId: 'r1', ruleKey: 'global:a', depth: 0, projectPath: ROOT, swarmIds: ['s1'], agentIds: ['ag1'], taskIds: ['TASK-5'], ...overrides
  });

  it('по рою, агенту и задаче активного запуска', () => {
    const swarmEvent: AutomationEvent = { kind: 'swarm.finished', projectPath: ROOT, subject: 'swarm:s1', summary: '', swarmId: 's1', at: NOW };
    expect(attributeEvent(swarmEvent, [run()], NOW)).toEqual({ parentRunId: 'r1', parentRuleKey: 'global:a', depth: 0 });
    expect(attributeEvent({ ...swarmEvent, swarmId: undefined, agentId: 'ag1' }, [run()], NOW)).not.toBeNull();
    expect(attributeEvent(taskEvent({ taskId: 'task-5' }), [run()], NOW)).not.toBeNull();
  });

  it('задача после завершения запуска — только в окне; чужой проект — нет', () => {
    expect(attributeEvent(taskEvent(), [run({ finishedAt: NOW - CHAIN_ATTRIBUTION_WINDOW_MS + 1 })], NOW)).not.toBeNull();
    expect(attributeEvent(taskEvent(), [run({ finishedAt: NOW - CHAIN_ATTRIBUTION_WINDOW_MS - 1 })], NOW)).toBeNull();
    expect(attributeEvent(taskEvent({ projectPath: 'D:/other' }), [run()], NOW)).toBeNull();
  });

  it('из нескольких кандидатов — самая глубокая цепочка', () => {
    const chain = attributeEvent(taskEvent(), [run(), run({ runId: 'r2', ruleKey: 'global:b', depth: 2, swarmIds: [] })], NOW);
    expect(chain).toEqual({ parentRunId: 'r2', parentRuleKey: 'global:b', depth: 2 });
  });
});

describe('шаблоны', () => {
  it('подставляет известные переменные, неизвестные — пустые', () => {
    expect(renderTemplate('Выполни {{ taskId }}: {{taskTitle}} {{nope}}', { taskId: 'TASK-1', taskTitle: 'Одна' })).toBe('Выполни TASK-1: Одна');
  });
});
