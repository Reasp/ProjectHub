import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppBusEvent } from '../../electron/services/hitlTypes';
import type { AutoStartDecision } from '../../electron/services/assignedTaskRules';
import { AutomationEngine, BUILTIN_ASSIGNED_KEY, type AutomationEngineDeps, type SwarmSnapshot } from '../../electron/services/automationEngine';
import { AutomationStore, type AutomationLogEntry } from '../../electron/services/automationStore';
import type { ActionDeps, StartRoleAgentRequest } from '../../electron/services/automationActions';

/**
 * Движок Automations (TASK-74, decision-52) на поддельных зависимостях: доверие к проектным
 * правилам, cron, события шины, лимиты и пауза, защита от циклов, встроенное правило назначенных
 * задач, ручной запуск и журнал. Файлы — во временном каталоге.
 */

const ROOT = path.join(os.tmpdir(), 'ph-auto-project');

interface Harness {
  engine: AutomationEngine;
  store: AutomationStore;
  published: AppBusEvent[];
  emit(event: AppBusEvent): void;
  finishSwarm(snapshot: SwarmSnapshot): void;
  started: StartRoleAgentRequest[];
  checks: string[];
  setProjectRules(rules: { raw: unknown; mtimeMs: number } | null): void;
  clock: { now: number };
  builtin: { enabled: boolean; decision: AutoStartDecision };
  activeTasks: Set<string>;
  watched: string[][];
  log(): Promise<AutomationLogEntry[]>;
}

let dir: string;
let harness: Harness;

/** Дать движку дописать запуск (id роя приходит после нескольких асинхронных шагов). */
const settle = () => new Promise((r) => setTimeout(r, 20));

async function makeHarness(options: { globalRules?: unknown[]; projectRules?: unknown[]; openProject?: string | null } = {}): Promise<Harness> {
  const store = new AutomationStore(dir);
  if (options.globalRules) await store.saveConfig({ version: 1, settings: { maxConcurrentAgentRuns: 2, builtinAssigned: { dailyBudgetUsd: 1, maxRunsPerDay: 20 } }, rules: options.globalRules, trust: {} });
  const busListeners = new Set<(e: AppBusEvent) => void>();
  const swarmListeners = new Set<(s: SwarmSnapshot) => void>();
  const swarms = new Map<string, SwarmSnapshot>();
  const h = {
    published: [] as AppBusEvent[],
    started: [] as StartRoleAgentRequest[],
    checks: [] as string[],
    projectRules: options.projectRules ? { raw: options.projectRules, mtimeMs: 1 } : null,
    clock: { now: new Date(2026, 8, 27, 12, 0, 0).getTime() },
    builtin: { enabled: false, decision: { start: false, reason: 'disabled' } as AutoStartDecision },
    activeTasks: new Set<string>(),
    watched: [] as string[][]
  };
  let swarmSeq = 0;
  const actions: ActionDeps = {
    startRoleAgent: async (req) => {
      h.started.push(req);
      const id = `swarm-${++swarmSeq}`;
      const snap: SwarmSnapshot = { id, status: 'running', agents: [{ id: `${id}-a`, status: 'running' }] };
      swarms.set(id, snap);
      return { id, agents: [{ id: `${id}-a` }] };
    },
    findTaskTitle: async () => 'Задача',
    loadChecks: async () => [
      { id: 'lint', kind: 'lint', name: 'Lint', command: 'npm run lint' },
      { id: 'test', kind: 'test', name: 'Test', command: 'npm test' }
    ],
    runCheck: async (def) => {
      h.checks.push(def.id);
      return { id: def.id, kind: def.kind, name: def.name, command: def.command, status: 'passed', blocking: true };
    },
    readProjectStack: async () => ({ scripts: { 'index-docs': 'node x' }, packageManager: 'npm' }),
    getProjectConfig: async () => ({
      run: { name: 'Run', command: 'npm run dev' },
      test: { name: 'Test', command: 'npm test' },
      deploy: { name: 'Deploy', command: 'npm run deploy', requiresConfirmation: true }
    }),
    runOnce: async (command) => ({ exitCode: 0, output: `ran ${command}`, truncated: false, timedOut: false, durationMs: 5, startedAt: 0 }),
    publish: (event) => {
      h.published.push(event);
      for (const l of busListeners) l(event);
    }
  };
  const deps: AutomationEngineDeps = {
    store,
    listProjects: async () => [ROOT],
    statProjectConfig: async () => h.projectRules?.mtimeMs ?? null,
    readProjectRules: async () => h.projectRules,
    actions,
    subscribeBus: (l) => {
      busListeners.add(l);
      return () => busListeners.delete(l);
    },
    publish: actions.publish,
    subscribeSwarms: (l) => {
      swarmListeners.add(l);
      return () => swarmListeners.delete(l);
    },
    getSwarm: (id) => swarms.get(id),
    hasActiveSwarm: (_root, taskId) => h.activeTasks.has(taskId),
    builtin: {
      isEnabled: () => h.builtin.enabled,
      setEnabled: (v) => {
        h.builtin.enabled = v;
      },
      onEnabledChange: () => () => undefined,
      decide: () => h.builtin.decision
    },
    taskEvents: { setProjects: (roots) => h.watched.push(roots) },
    getOpenProject: () => (options.openProject === undefined ? ROOT : options.openProject),
    onOpenProjectChange: () => () => undefined,
    now: () => h.clock.now
  };
  const engine = new AutomationEngine(deps);
  await engine.init();
  return {
    ...h,
    engine,
    store,
    emit: (event) => {
      for (const l of busListeners) l(event);
    },
    setProjectRules: (rules) => {
      h.projectRules = rules;
    },
    finishSwarm: (snap) => {
      swarms.set(snap.id, snap);
      for (const l of swarmListeners) l(snap);
    },
    log: async () => {
      await engine.flush();
      return store.readLog(100);
    }
  } as Harness;
}

function statusEvent(taskId = 'TASK-5', to = 'Review', extra: Partial<Extract<AppBusEvent, { type: 'task:updated' }>> = {}): AppBusEvent {
  return {
    type: 'task:updated',
    projectPath: ROOT,
    taskId,
    title: `Задача ${taskId}`,
    status: to,
    assignee: [],
    labels: [],
    created: false,
    changes: { status: { from: 'In Progress', to } },
    at: 1,
    ...extra
  };
}

const reviewChecksRule = {
  id: 'review-checks',
  name: 'Чеки на ревью',
  enabled: true,
  trigger: { kind: 'event', event: 'task.statusChanged' },
  conditions: { statusTo: ['Review'] },
  action: { type: 'runChecks' }
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-auto-engine-'));
});

afterEach(async () => {
  await harness?.engine.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('событийное правило', () => {
  it('task.statusChanged → Review запускает проверки и пишет журнал', async () => {
    harness = await makeHarness({ globalRules: [reviewChecksRule] });
    harness.emit(statusEvent());
    await vi.waitFor(async () => expect((await harness.log()).map((e) => e.status)).toEqual(['success', 'started']));
    expect(harness.checks).toEqual(['lint', 'test']);
    const [done] = await harness.log();
    expect(done).toMatchObject({ ruleId: 'review-checks', action: 'runChecks', trigger: 'task.statusChanged', projectPath: ROOT, detail: 'Lint: passed; Test: passed' });
    expect(harness.published.some((e) => e.type === 'automation:runFinished' && e.outcome === 'success')).toBe(true);
  });

  it('условие не совпало и cooldown — без запуска и без записей в журнале', async () => {
    harness = await makeHarness({ globalRules: [reviewChecksRule] });
    harness.emit(statusEvent('TASK-5', 'Done'));
    harness.emit(statusEvent('TASK-6'));
    harness.emit(statusEvent('TASK-6'));
    await vi.waitFor(async () => expect((await harness.log()).filter((e) => e.status === 'success')).toHaveLength(1));
    expect((await harness.log()).filter((e) => e.status === 'skipped')).toHaveLength(0);
  });

  it('следит за задачами открытого проекта, пока есть правило с триггером задач', async () => {
    harness = await makeHarness({ globalRules: [reviewChecksRule] });
    expect(harness.watched.at(-1)).toEqual([ROOT]);
    await harness.engine.setEnabled('global:review-checks', false);
    expect(harness.watched.at(-1)).toEqual([]);
  });
});

describe('доверие к проектным правилам', () => {
  const projectRule = { id: 'p-checks', name: 'Проектные чеки', trigger: { kind: 'event', event: 'task.statusChanged' }, action: { type: 'runChecks' } };

  it('не срабатывает без подтверждения, срабатывает после, снова требует подтверждения после изменения', async () => {
    harness = await makeHarness({ projectRules: [projectRule] });
    let view = (await harness.engine.list()).find((v) => v.scope === 'project')!;
    expect(view).toMatchObject({ trust: 'untrusted', active: false });

    harness.emit(statusEvent());
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.checks).toEqual([]);

    expect(await harness.engine.setEnabled(view.key, true, 'не-тот-хэш')).toMatchObject({ ok: false });
    expect(await harness.engine.setEnabled(view.key, true, view.hash)).toEqual({ ok: true });
    harness.emit(statusEvent('TASK-7'));
    await vi.waitFor(() => expect(harness.checks).toEqual(['lint', 'test']));

    // git pull поменял правило: доверие к старой версии не распространяется на новую.
    harness.setProjectRules({ raw: [{ ...projectRule, action: { type: 'runChecks', checkIds: ['test'] } }], mtimeMs: 2 });
    view = (await harness.engine.list()).find((v) => v.scope === 'project')!;
    expect(view).toMatchObject({ trust: 'changed', active: false });
    harness.emit(statusEvent('TASK-8'));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.checks).toEqual(['lint', 'test']);

    const config = JSON.parse(await fs.readFile(path.join(dir, 'automations.json'), 'utf8'));
    expect(Object.values(config.trust)).toHaveLength(1);
  });

  it('неверное проектное правило видно с ошибкой и не срабатывает', async () => {
    harness = await makeHarness({ projectRules: [{ id: 'bad', name: 'x', trigger: { kind: 'event', event: 'docs.changed' }, action: { type: 'reindexDocs' } }] });
    const view = (await harness.engine.list()).find((v) => v.scope === 'project')!;
    expect(view.issue).toMatch(/trigger/);
    expect(view.active).toBe(false);
  });
});

describe('cron', () => {
  it('планирует следующее срабатывание, запускает в срок и не повторяет в ту же минуту', async () => {
    harness = await makeHarness({
      globalRules: [{ id: 'minute', name: 'Каждую минуту', enabled: true, trigger: { kind: 'cron', expr: '* * * * *' }, action: { type: 'notify', title: 'Тик {{ruleName}}' } }]
    });
    const next = (await harness.engine.list()).find((v) => v.id === 'minute')!.state.nextRunAt!;
    expect(next).toBe(harness.clock.now + 60_000);
    harness.clock.now = next + 5_000;
    await harness.engine.tick();
    await harness.engine.tick();
    await vi.waitFor(() => expect(harness.published.filter((e) => e.type === 'automation:notify')).toHaveLength(1));
    const notify = harness.published.find((e) => e.type === 'automation:notify');
    expect(notify).toMatchObject({ title: 'Тик Каждую минуту' });
  });
});

describe('агент, бюджет и пауза', () => {
  const agentRule = {
    id: 'fix-failed',
    name: 'Чинить упавшие рои',
    enabled: true,
    trigger: { kind: 'event', event: 'swarm.finished' },
    conditions: { outcomes: ['failed'] },
    action: { type: 'runAgent', roleSlug: 'implementer', prompt: 'Разберись: {{event}}' },
    limits: { dailyBudgetUsd: 1, cooldownMin: 1 }
  };
  const failedSwarm = (id: string): AppBusEvent => ({
    type: 'swarm:finished', swarmId: id, projectPath: ROOT, name: id, mode: 'fan-out', outcome: 'failed', agentsTotal: 1, agentsFailed: 1, at: 1
  });

  it('запускает роль с бюджетом запуска и меткой правила; стоимость сверх бюджета ставит паузу и уведомляет', async () => {
    harness = await makeHarness({ globalRules: [agentRule] });
    harness.emit(failedSwarm('human-1'));
    await vi.waitFor(() => expect(harness.started).toHaveLength(1));
    await settle();
    expect(harness.started[0]).toMatchObject({
      projectPath: ROOT,
      roleSlug: 'implementer',
      mode: 'single',
      budgetUsd: 1,
      prompt: 'Разберись: рой «human-1» завершён: failed',
      automation: { ruleKey: 'global:fix-failed', depth: 0 }
    });

    harness.finishSwarm({ id: 'swarm-1', status: 'completed', totalCostUsd: 1.2, agents: [{ id: 'swarm-1-a', status: 'completed' }] });
    await vi.waitFor(() => expect(harness.published.some((e) => e.type === 'automation:suspended')).toBe(true));
    const suspended = harness.published.find((e) => e.type === 'automation:suspended');
    expect(suspended).toMatchObject({ reason: 'budget', ruleId: 'fix-failed', spentUsd: 1.2, limitUsd: 1 });

    // Пауза: следующее событие не запускает агента, а вручную — говорит о паузе.
    harness.clock.now += 5 * 60_000;
    harness.emit(failedSwarm('human-2'));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.started).toHaveLength(1);
    const view = (await harness.engine.list()).find((v) => v.id === 'fix-failed')!;
    expect(view.state).toMatchObject({ pauseReason: 'budget', costTodayUsd: 1.2 });

    const log = await harness.log();
    expect(log.map((e) => e.status)).toEqual(['suspended', 'success', 'started']);
    expect(log[1]).toMatchObject({ costUsd: 1.2, swarmId: 'swarm-1' });

    // Снятие паузы вручную.
    expect(harness.engine.resume('global:fix-failed')).toBe(true);
    expect((await harness.engine.list()).find((v) => v.id === 'fix-failed')!.state.pausedUntil).toBeUndefined();
  });

  it('событие собственного роя не запускает правило снова (защита от цикла)', async () => {
    harness = await makeHarness({ globalRules: [agentRule] });
    harness.emit(failedSwarm('human-1'));
    await vi.waitFor(() => expect(harness.started).toHaveLength(1));
    await settle();
    harness.clock.now += 10 * 60_000;
    // Свой рой упал — это событие порождено запуском правила.
    harness.finishSwarm({ id: 'swarm-1', status: 'failed', totalCostUsd: 0.1, agents: [{ id: 'swarm-1-a', status: 'failed', error: 'boom' }] });
    harness.emit(failedSwarm('swarm-1'));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.started).toHaveLength(1);
    const log = await harness.log();
    expect(log[0]).toMatchObject({ status: 'failed', detail: 'рой swarm-1: failed — boom' });
  });

  it('по задаче с активным роем агент не запускается', async () => {
    harness = await makeHarness({
      globalRules: [{ ...agentRule, id: 'on-assign', trigger: { kind: 'event', event: 'task.assigned' }, conditions: {}, action: { type: 'runAgent', roleSlug: 'dev' } }]
    });
    harness.activeTasks.add('TASK-9');
    harness.emit(statusEvent('TASK-9', 'To Do', { changes: { assignee: { from: [], to: ['agent:dev'] } } }));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.started).toHaveLength(0);
    harness.activeTasks.clear();
    harness.emit(statusEvent('TASK-9', 'To Do', { changes: { assignee: { from: [], to: ['agent:dev'] } } }));
    await vi.waitFor(() => expect(harness.started[0]).toMatchObject({ taskId: 'TASK-9', prompt: 'Выполни задачу TASK-9: Задача TASK-9' }));
  });
});

describe('встроенное правило назначенных задач', () => {
  it('запускает роль из назначения с лимитами встроенного правила и меткой builtin', async () => {
    harness = await makeHarness();
    harness.builtin.enabled = true;
    harness.builtin.decision = { start: true, reason: 'ok', roleSlug: 'implementer' };
    harness.emit(statusEvent('TASK-3', 'To Do', { changes: {} }));
    await vi.waitFor(() => expect(harness.started).toHaveLength(1));
    expect(harness.started[0]).toMatchObject({
      roleSlug: 'implementer',
      taskId: 'TASK-3',
      prompt: 'Выполни задачу TASK-3: Задача TASK-3',
      budgetUsd: 5,
      automation: { ruleKey: BUILTIN_ASSIGNED_KEY }
    });
    // Изменение задачи, порождённое этим же запуском, встроенное правило не перезапускает.
    harness.emit(statusEvent('TASK-3', 'In Progress', { changes: {} }));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.started).toHaveLength(1);
  });

  it('выключенное или отказавшее правило не запускает', async () => {
    harness = await makeHarness();
    harness.builtin.decision = { start: true, reason: 'ok', roleSlug: 'implementer' };
    harness.emit(statusEvent('TASK-3', 'To Do', { changes: {} }));
    harness.builtin.enabled = true;
    harness.builtin.decision = { start: false, reason: 'other-host', roleSlug: 'implementer' };
    harness.emit(statusEvent('TASK-4', 'To Do', { changes: {} }));
    await new Promise((r) => setTimeout(r, 30));
    expect(harness.started).toHaveLength(0);
    const view = (await harness.engine.list()).find((v) => v.key === BUILTIN_ASSIGNED_KEY)!;
    expect(view).toMatchObject({ enabled: true, builtinLimits: { dailyBudgetUsd: 5, maxRunsPerDay: 20 } });
  });
});

describe('ручной запуск и действия', () => {
  it('запускает сейчас в обход cooldown; deploy с подтверждением автоматизация не выполняет', async () => {
    harness = await makeHarness({
      globalRules: [
        { id: 'docs', name: 'Индекс', enabled: true, trigger: { kind: 'manual' }, conditions: { projects: [ROOT] }, action: { type: 'reindexDocs' } },
        { id: 'deploy', name: 'Деплой', enabled: true, trigger: { kind: 'manual' }, conditions: { projects: [ROOT] }, action: { type: 'projectAction', actionId: 'deploy' } }
      ]
    });
    expect(await harness.engine.runNow('global:docs', 'mcp')).toMatchObject({ ok: true });
    expect(await harness.engine.runNow('global:docs', 'ui')).toMatchObject({ ok: true });
    await harness.engine.runNow('global:deploy', 'ui');
    await vi.waitFor(async () => expect((await harness.log()).filter((e) => e.status !== 'started')).toHaveLength(3));
    const log = await harness.log();
    const deploy = log.find((e) => e.ruleId === 'deploy' && e.status !== 'started')!;
    expect(deploy).toMatchObject({ status: 'failed', trigger: 'manual:ui' });
    expect(deploy.detail).toMatch(/требует подтверждения человека/);
    expect(log.filter((e) => e.ruleId === 'docs' && e.status === 'success')).toHaveLength(2);
    expect(await harness.engine.runNow('global:nope', 'ui')).toMatchObject({ ok: false });
    expect(await harness.engine.runNow(BUILTIN_ASSIGNED_KEY, 'mcp')).toMatchObject({ ok: false });
  });

  it('сохранение глобального правила проверяет схему и область', async () => {
    harness = await makeHarness();
    expect(await harness.engine.saveGlobalRule({ id: 'x', name: 'X', trigger: { kind: 'cron', expr: '0 3 * * *' }, action: { type: 'reindexDocs' } })).toMatchObject({ ok: false });
    const saved = await harness.engine.saveGlobalRule({ id: 'x', name: 'X', enabled: true, trigger: { kind: 'cron', expr: '0 3 * * *' }, conditions: { projects: [ROOT] }, action: { type: 'reindexDocs' } });
    expect(saved.ok).toBe(true);
    expect((await harness.engine.list()).find((v) => v.id === 'x')?.state.nextRunAt).toBe(new Date(2026, 8, 28, 3, 0).getTime());
    expect(await harness.engine.deleteGlobalRule('x')).toBe(true);
    expect((await harness.engine.list()).find((v) => v.id === 'x')).toBeUndefined();
  });
});

describe('состояние и журнал на диске', () => {
  it('состояние правил переживает перезапуск движка', async () => {
    harness = await makeHarness({ globalRules: [reviewChecksRule] });
    harness.emit(statusEvent());
    await vi.waitFor(async () => expect((await harness.log()).some((e) => e.status === 'success')).toBe(true));
    await harness.engine.shutdown();
    const restored = await new AutomationStore(dir).loadState();
    expect(restored['global:review-checks']).toMatchObject({ runsToday: 1, lastRunBySubject: { 'task:TASK-5': expect.any(Number) } });
  });

  it('журнал ротируется и читается новыми записями первыми', async () => {
    const store = new AutomationStore(dir);
    const entry = (i: number): AutomationLogEntry => ({ ts: String(i), ruleKey: 'k', ruleId: 'r', ruleName: 'R', scope: 'global', status: 'success', trigger: 'cron', detail: 'x'.repeat(100) });
    // ~230 байт на запись: по четыре записи в файле.
    for (let i = 0; i < 10; i += 1) await store.appendLog(entry(i), 1000, 2);
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('automations-log')).sort();
    expect(files).toEqual(['automations-log.1.jsonl', 'automations-log.2.jsonl', 'automations-log.jsonl']);
    const read = await store.readLog(4);
    expect(read.map((e) => e.ts)).toEqual(['9', '8', '7', '6']);
  });
});
