import { randomUUID } from 'node:crypto';
import type { AppBusEvent } from './hitlTypes.js';
import type { AutoStartDecision } from './assignedTaskRules.js';
import { cronWallKey, parseCron, planCronTick } from './cronExpr.js';
import {
  attributeEvent,
  automationEventsFromBus,
  gateRun,
  isPathInside,
  matchRuleEvent,
  normalizePathKey,
  parseRules,
  recordRunCost,
  recordRunStart,
  rollRuleState,
  ruleHash,
  ruleKey,
  trustStatus,
  validateRule,
  validateRuleForScope,
  type AutomationAction,
  type AutomationEvent,
  type AutomationLimits,
  type AutomationRule,
  type RuleRuntimeState,
  type RuleScope,
  type RunChain,
  type RunTrace,
  type SkipReason,
  type Suspension,
  type TrustStatus
} from './automationRules.js';
import { executeAutomationAction, type ActionDeps, type ActionResult } from './automationActions.js';
import { normalizeAutomationsSettings, type AutomationLogEntry, type AutomationStore, type AutomationsConfig, type AutomationsSettings } from './automationStore.js';

/**
 * Оркестратор Automations (TASK-74, decision-52): правила из трёх источников (глобальные,
 * проектные с доверием, встроенное правило назначенных задач), планировщик cron, реакция на
 * шину, лимиты, причинность, журнал. Все внешние сервисы приходят зависимостями — движок
 * проверяется тестами без Electron; связывание с настоящими сервисами — в `automationService`.
 */

export const TICK_INTERVAL_MS = 30_000;
export const BUILTIN_ASSIGNED_ID = 'assigned-tasks';
export const BUILTIN_ASSIGNED_KEY = `builtin:${BUILTIN_ASSIGNED_ID}`;
const TRACE_RETENTION_MS = 10 * 60 * 1000;
const STATE_SAVE_DELAY_MS = 500;

export interface SwarmSnapshot {
  id: string;
  status: string;
  totalCostUsd?: number;
  error?: string;
  agents: { id: string; status: string; error?: string }[];
}

export interface AutomationEngineDeps {
  store: AutomationStore;
  /** Корни зарегистрированных проектов. */
  listProjects(): Promise<string[]>;
  /** Секция `automations` из `.projecthub.json` и время изменения файла; `null` — файла нет. */
  readProjectRules(root: string): Promise<{ raw: unknown; mtimeMs: number } | null>;
  statProjectConfig(root: string): Promise<number | null>;
  actions: ActionDeps;
  subscribeBus(listener: (event: AppBusEvent) => void): () => void;
  publish(event: AppBusEvent): void;
  subscribeSwarms(listener: (session: SwarmSnapshot) => void): () => void;
  getSwarm(id: string): SwarmSnapshot | undefined;
  hasActiveSwarm(projectRoot: string, taskId: string): boolean;
  builtin: {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void> | void;
    onEnabledChange(listener: (enabled: boolean) => void): () => void;
    decide(event: AutomationEvent, lastStartedAt: number | undefined, now: number): AutoStartDecision;
  };
  taskEvents: { setProjects(roots: string[]): void };
  getOpenProject(): string | null;
  onOpenProjectChange(listener: () => void): () => void;
  now(): number;
  log?: (level: 'info' | 'warn', message: string) => void;
}

export interface AutomationRuleStateView {
  runsToday: number;
  costTodayUsd: number;
  lastRunAt?: number;
  pausedUntil?: number;
  pauseReason?: 'budget' | 'runs';
  nextRunAt?: number;
}

export interface AutomationRuleView {
  key: string;
  scope: 'global' | 'project' | 'builtin';
  id: string;
  name: string;
  projectRoot?: string;
  /** Правило действительно срабатывает: включено, верно и (для проектного) подтверждено. */
  active: boolean;
  enabled: boolean;
  trust?: TrustStatus;
  /** Текущий хэш проектного правила — UI возвращает его при подтверждении. */
  hash?: string;
  rule?: AutomationRule;
  raw?: unknown;
  issue?: string;
  state: AutomationRuleStateView;
  /** Лимиты встроенного правила. */
  builtinLimits?: AutomationsSettings['builtinAssigned'];
}

export type RunNowResult = { ok: true; runIds: string[] } | { ok: false; reason: string };

interface RuleEntry {
  key: string;
  scope: RuleScope;
  rule: AutomationRule;
}

interface ActiveRun extends RunTrace {
  entryKey: string;
  ruleId: string;
  ruleName: string;
  scope: RuleScope['kind'];
  action: AutomationAction;
  limits: AutomationLimits;
  trigger: string;
  subject: string;
  eventSummary?: string;
  startedAt: number;
  isAgent: boolean;
}

interface ProjectRulesCache {
  root: string;
  mtimeMs: number | null;
  rules: AutomationRule[];
  issues: { id?: string; index: number; message: string; raw?: unknown }[];
}

interface FireContext {
  trigger: string;
  event?: AutomationEvent;
  manual: boolean;
  projectRoot?: string;
  chain: RunChain | null;
  /** Для встроенного правила действие вычисляется из назначения. */
  actionOverride?: AutomationAction;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const TERMINAL_SWARM = new Set(['completed', 'failed', 'stopped', 'interrupted']);

export class AutomationEngine {
  private config: AutomationsConfig = { version: 1, settings: { maxConcurrentAgentRuns: 2, builtinAssigned: { dailyBudgetUsd: 5, maxRunsPerDay: 20 } }, rules: [], trust: {} };
  private state: Record<string, RuleRuntimeState> = {};
  private projectRules = new Map<string, ProjectRulesCache>();
  private runs: ActiveRun[] = [];
  private pendingSwarms = new Map<string, string>();
  private unsubscribers: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private changeListeners = new Set<() => void>();
  private ticking: Promise<void> | null = null;
  private started = false;

  constructor(private readonly deps: AutomationEngineDeps) {}

  // ─────────────────────────── Жизненный цикл ───────────────────────────

  public async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.config = await this.deps.store.loadConfig();
    this.state = await this.deps.store.loadState();
    await this.refreshProjectRules();
    this.unsubscribers.push(
      this.deps.subscribeBus((event) => this.handleBusEvent(event)),
      this.deps.subscribeSwarms((session) => this.handleSwarm(session)),
      this.deps.builtin.onEnabledChange(() => {
        this.refreshTaskWatchers();
        this.emitChange();
      }),
      this.deps.onOpenProjectChange(() => this.refreshTaskWatchers())
    );
    await this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  public async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.deps.taskEvents.setProjects([]);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.deps.store.saveState(this.state).catch(() => undefined);
    }
    await this.deps.store.flush();
    this.started = false;
  }

  public onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // подписчик UI не должен ронять движок
      }
    }
  }

  private log(level: 'info' | 'warn', message: string): void {
    this.deps.log?.(level, `[Automations] ${message}`);
  }

  // ─────────────────────────── Источники правил ───────────────────────────

  private globalEntries(): { entries: RuleEntry[]; invalid: { raw: unknown; id?: string; message: string }[] } {
    const entries: RuleEntry[] = [];
    const invalid: { raw: unknown; id?: string; message: string }[] = [];
    const { rules, issues } = parseRules(this.config.rules);
    for (const issue of issues) invalid.push({ raw: this.config.rules[issue.index], id: issue.id, message: issue.message });
    for (const rule of rules) {
      const scope: RuleScope = { kind: 'global' };
      const scopeIssue = validateRuleForScope(rule, scope);
      if (scopeIssue) {
        invalid.push({ raw: rule, id: rule.id, message: scopeIssue });
        continue;
      }
      entries.push({ key: ruleKey(scope, rule.id), scope, rule });
    }
    return { entries, invalid };
  }

  private projectEntries(): RuleEntry[] {
    const out: RuleEntry[] = [];
    for (const cache of this.projectRules.values()) {
      const scope: RuleScope = { kind: 'project', projectRoot: cache.root };
      for (const rule of cache.rules) out.push({ key: ruleKey(scope, rule.id), scope, rule });
    }
    return out;
  }

  private trustFor(entry: RuleEntry): TrustStatus | undefined {
    if (entry.scope.kind !== 'project') return undefined;
    const approved = this.config.trust[normalizePathKey(entry.scope.projectRoot || '')]?.[entry.rule.id];
    return trustStatus(entry.rule, approved);
  }

  /** Правила, которые реально срабатывают. */
  private activeEntries(): RuleEntry[] {
    const all = [...this.globalEntries().entries, ...this.projectEntries()];
    return all.filter((e) => e.rule.enabled && (e.scope.kind !== 'project' || this.trustFor(e) === 'trusted'));
  }

  /** Перечитывает `automations` из `.projecthub.json` зарегистрированных проектов, если файл менялся. */
  private async refreshProjectRules(): Promise<boolean> {
    let changed = false;
    const roots = await this.deps.listProjects().catch(() => [] as string[]);
    const wanted = new Set(roots.map((r) => normalizePathKey(r)));
    for (const key of [...this.projectRules.keys()]) {
      if (!wanted.has(key)) {
        this.projectRules.delete(key);
        changed = true;
      }
    }
    for (const root of roots) {
      const key = normalizePathKey(root);
      const mtime = await this.deps.statProjectConfig(root).catch(() => null);
      const cached = this.projectRules.get(key);
      if (cached && cached.mtimeMs === mtime) continue;
      changed = true;
      const loaded = mtime === null ? null : await this.deps.readProjectRules(root).catch(() => null);
      // Автор проекта объявляет правило включённым по умолчанию; срабатывает оно после подтверждения.
      const rawList = Array.isArray(loaded?.raw) ? (loaded!.raw as unknown[]).map((r) => (r && typeof r === 'object' ? { enabled: true, ...(r as object) } : r)) : loaded?.raw;
      const { rules, issues } = parseRules(rawList);
      const scoped: AutomationRule[] = [];
      const allIssues: ProjectRulesCache['issues'] = issues.map((i) => ({ ...i, raw: Array.isArray(rawList) ? rawList[i.index] : undefined }));
      for (const rule of rules) {
        const scopeIssue = validateRuleForScope(rule, { kind: 'project', projectRoot: root });
        if (scopeIssue) allIssues.push({ index: -1, id: rule.id, message: scopeIssue, raw: rule });
        else scoped.push(rule);
      }
      this.projectRules.set(key, { root, mtimeMs: mtime, rules: scoped, issues: allIssues });
    }
    return changed;
  }

  private registeredRoots(): string[] {
    return [...this.projectRules.values()].map((c) => c.root);
  }

  /** Корень зарегистрированного проекта, внутри которого лежит путь (самый длинный). */
  private resolveProjectRoot(p: string | undefined): string | undefined {
    if (!p) return undefined;
    let best: string | undefined;
    for (const root of this.registeredRoots()) {
      if (isPathInside(p, root) && (!best || root.length > best.length)) best = root;
    }
    return best;
  }

  /** Наблюдаемые проекты: открытый (встроенное правило, глобальные без проектов) и проекты правил задач. */
  private refreshTaskWatchers(): void {
    const roots = new Set<string>();
    const open = this.deps.getOpenProject();
    const active = this.activeEntries().filter((e) => e.rule.trigger.kind === 'event' && e.rule.trigger.event.startsWith('task.'));
    if (open && (this.deps.builtin.isEnabled() || active.some((e) => e.scope.kind === 'global' && !e.rule.conditions.projects?.length))) {
      roots.add(open);
    }
    for (const entry of active) {
      if (entry.scope.kind === 'project' && entry.scope.projectRoot) roots.add(entry.scope.projectRoot);
      for (const p of entry.rule.conditions.projects ?? []) roots.add(this.resolveProjectRoot(p) ?? p);
    }
    this.deps.taskEvents.setProjects([...roots]);
  }

  // ─────────────────────────── Состояние ───────────────────────────

  private getState(key: string, now: number): RuleRuntimeState {
    const rolled = rollRuleState(this.state[key], now);
    this.state[key] = rolled;
    return rolled;
  }

  private setState(key: string, state: RuleRuntimeState): void {
    this.state[key] = state;
    this.scheduleStateSave();
  }

  private scheduleStateSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.deps.store.saveState(this.state).catch((err) => this.log('warn', `Не удалось сохранить состояние: ${errorText(err)}`));
    }, STATE_SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  private stateView(key: string, now: number): AutomationRuleStateView {
    const s = rollRuleState(this.state[key], now);
    return {
      runsToday: s.runsToday,
      costTodayUsd: s.costTodayUsd,
      ...(s.lastRunAt !== undefined ? { lastRunAt: s.lastRunAt } : {}),
      ...(s.pausedUntil !== undefined ? { pausedUntil: s.pausedUntil, pauseReason: s.pauseReason } : {}),
      ...(s.nextRunAt !== undefined ? { nextRunAt: s.nextRunAt } : {})
    };
  }

  // ─────────────────────────── Планировщик ───────────────────────────

  public tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = this.runTick().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async runTick(): Promise<void> {
    const now = this.deps.now();
    const rulesChanged = await this.refreshProjectRules().catch(() => false);
    for (const entry of this.activeEntries()) {
      if (entry.rule.trigger.kind !== 'cron') continue;
      let cron;
      try {
        cron = parseCron(entry.rule.trigger.expr);
      } catch {
        continue;
      }
      const state = this.getState(entry.key, now);
      const decision = planCronTick({
        cron,
        now: new Date(now),
        nextRunAt: state.nextRunAt,
        lastWallKey: state.lastWallKey,
        catchUp: entry.rule.trigger.catchUp
      });
      const next: RuleRuntimeState = { ...state, ...(decision.nextRunAt !== undefined ? { nextRunAt: decision.nextRunAt } : {}) };
      if (decision.nextRunAt === undefined) delete next.nextRunAt;
      if (decision.fire && decision.wallKey) next.lastWallKey = decision.wallKey;
      if (next.nextRunAt !== state.nextRunAt || next.lastWallKey !== state.lastWallKey) this.setState(entry.key, next);
      if (decision.missed && !decision.fire) this.log('info', `${entry.rule.name}: пропущенное срабатывание не догоняется (catchUp: skip)`);
      if (!decision.fire) continue;
      for (const projectRoot of this.targetsForScheduled(entry)) {
        void this.fire(entry, { trigger: 'cron', manual: false, projectRoot, chain: null });
      }
    }
    // Следы завершённых запусков нужны только окну причинности.
    this.runs = this.runs.filter((r) => r.finishedAt === undefined || now - r.finishedAt < TRACE_RETENTION_MS);
    this.refreshTaskWatchers();
    if (rulesChanged) this.emitChange();
  }

  /** Проекты для запуска без события (cron, ручной). */
  private targetsForScheduled(entry: RuleEntry): (string | undefined)[] {
    if (entry.scope.kind === 'project') return [entry.scope.projectRoot];
    const projects = entry.rule.conditions.projects ?? [];
    if (!projects.length) return [undefined];
    return projects.map((p) => this.resolveProjectRoot(p) ?? p);
  }

  // ─────────────────────────── События шины ───────────────────────────

  private handleBusEvent(busEvent: AppBusEvent): void {
    if (busEvent.type.startsWith('automation:')) return;
    const events = automationEventsFromBus(busEvent);
    if (!events.length) return;
    const now = this.deps.now();
    const entries = this.activeEntries();
    for (const event of events) {
      const chain = attributeEvent(event, this.runs, now);
      if (event.kind === 'task.updated') {
        this.handleBuiltin(event, chain, now);
        continue;
      }
      for (const entry of entries) {
        if (!matchRuleEvent(entry.rule, entry.scope, event)) continue;
        const projectRoot = entry.scope.kind === 'project' ? entry.scope.projectRoot : this.resolveProjectRoot(event.projectPath);
        void this.fire(entry, { trigger: event.kind, event, manual: false, projectRoot, chain });
      }
    }
  }

  private builtinEntry(): RuleEntry {
    const limits = this.config.settings.builtinAssigned;
    const rule: AutomationRule = {
      id: BUILTIN_ASSIGNED_ID,
      name: 'Автозапуск назначенных задач',
      enabled: this.deps.builtin.isEnabled(),
      trigger: { kind: 'manual' },
      conditions: {},
      action: { type: 'runAgent', roleSlug: '', mode: 'single' },
      limits: { cooldownMin: 0, maxRunsPerDay: limits.maxRunsPerDay, dailyBudgetUsd: limits.dailyBudgetUsd }
    };
    return { key: BUILTIN_ASSIGNED_KEY, scope: { kind: 'builtin' }, rule };
  }

  private handleBuiltin(event: AutomationEvent, chain: RunChain | null, now: number): void {
    if (!this.deps.builtin.isEnabled()) return;
    const state = this.getState(BUILTIN_ASSIGNED_KEY, now);
    const decision = this.deps.builtin.decide(event, state.lastRunBySubject[event.subject], now);
    if (!decision.start || !decision.roleSlug) return;
    const entry = this.builtinEntry();
    void this.fire(entry, {
      trigger: 'task.updated',
      event,
      manual: false,
      projectRoot: this.resolveProjectRoot(event.projectPath) ?? event.projectPath,
      chain,
      actionOverride: { type: 'runAgent', roleSlug: decision.roleSlug, mode: 'single' }
    });
  }

  // ─────────────────────────── Запуск ───────────────────────────

  private journal(entry: Omit<AutomationLogEntry, 'ts'>): void {
    this.deps.store.appendLog({ ts: new Date(this.deps.now()).toISOString(), ...entry }).catch((err) => {
      this.log('warn', `Не удалось записать журнал: ${errorText(err)}`);
    });
  }

  private activeAgentRuns(): number {
    return this.runs.filter((r) => r.isAgent && r.finishedAt === undefined).length;
  }

  private suspend(entry: RuleEntry, suspension: Suspension, projectRoot: string | undefined, spentUsd?: number): void {
    const until = suspension.until;
    this.journal({
      ruleKey: entry.key,
      ruleId: entry.rule.id,
      ruleName: entry.rule.name,
      scope: entry.scope.kind,
      status: 'suspended',
      trigger: 'limit',
      reason: suspension.reason,
      detail: `до ${cronWallKey(new Date(until))}`,
      ...(projectRoot ? { projectPath: projectRoot } : {})
    });
    this.deps.publish({
      type: 'automation:suspended',
      ruleId: entry.rule.id,
      ruleName: entry.rule.name,
      ...(projectRoot ? { projectPath: projectRoot } : {}),
      reason: suspension.reason,
      until,
      ...(spentUsd !== undefined ? { spentUsd } : {}),
      ...(entry.rule.limits.dailyBudgetUsd ? { limitUsd: entry.rule.limits.dailyBudgetUsd } : {}),
      at: this.deps.now()
    });
    this.log('warn', `Правило «${entry.rule.name}» приостановлено до полуночи: ${suspension.reason === 'budget' ? 'исчерпан дневной бюджет' : 'исчерпано число запусков'}`);
  }

  /**
   * Запуск правила. Решение о запуске и учёт старта выполняются синхронно до первого `await`, чтобы
   * два события подряд не прошли лимиты оба.
   */
  private async fire(entry: RuleEntry, ctx: FireContext): Promise<{ ok: true; runId: string } | { ok: false; reason: SkipReason | 'already-running' | 'no-project' | 'error' }> {
    const now = this.deps.now();
    const action = ctx.actionOverride ?? entry.rule.action;
    const subject = ctx.event?.subject ?? `${ctx.manual ? 'manual' : 'cron'}:${ctx.projectRoot ?? '-'}`;
    const base = {
      ruleKey: entry.key,
      ruleId: entry.rule.id,
      ruleName: entry.rule.name,
      scope: entry.scope.kind,
      trigger: ctx.trigger,
      subject,
      ...(ctx.event ? { eventSummary: ctx.event.summary } : {}),
      ...(ctx.projectRoot ? { projectPath: ctx.projectRoot } : {}),
      action: action.type
    };

    if (!ctx.projectRoot && action.type !== 'notify') {
      this.journal({ ...base, status: 'skipped', reason: 'no-project', detail: 'Не определён зарегистрированный проект для действия' });
      return { ok: false, reason: 'no-project' };
    }

    if (action.type === 'runAgent') {
      const taskId = action.taskId ?? ctx.event?.taskId;
      if (ctx.projectRoot && taskId && this.deps.hasActiveSwarm(ctx.projectRoot, taskId)) {
        if (ctx.manual) this.journal({ ...base, status: 'skipped', reason: 'already-running' });
        return { ok: false, reason: 'already-running' };
      }
    }

    const state = this.getState(entry.key, now);
    const gate = gateRun({
      ruleKey: entry.key,
      action,
      limits: entry.rule.limits,
      state,
      now,
      subject,
      manual: ctx.manual,
      chain: ctx.chain,
      activeAgentRuns: this.activeAgentRuns(),
      maxConcurrentAgentRuns: this.config.settings.maxConcurrentAgentRuns
    });
    if (!gate.allow) {
      if (gate.suspend && state.pausedUntil === undefined) {
        this.setState(entry.key, { ...state, pausedUntil: gate.suspend.until, pauseReason: gate.suspend.reason });
        this.suspend(entry, gate.suspend, ctx.projectRoot, state.costTodayUsd);
        this.emitChange();
      } else if (gate.log) {
        this.journal({ ...base, status: 'skipped', reason: gate.reason, ...(ctx.chain ? { depth: ctx.chain.depth + 1 } : {}) });
      }
      return { ok: false, reason: gate.reason };
    }

    const started = recordRunStart(state, subject, entry.rule.limits, now);
    this.setState(entry.key, started.state);
    const runId = `run-${now.toString(36)}-${randomUUID().slice(0, 6)}`;
    const run: ActiveRun = {
      runId,
      ruleKey: entry.key,
      entryKey: entry.key,
      ruleId: entry.rule.id,
      ruleName: entry.rule.name,
      scope: entry.scope.kind,
      depth: gate.depth,
      ...(ctx.projectRoot ? { projectPath: ctx.projectRoot } : {}),
      swarmIds: [],
      agentIds: [],
      taskIds: ctx.event?.taskId ? [ctx.event.taskId] : action.type === 'runAgent' && action.taskId ? [action.taskId] : [],
      action,
      limits: entry.rule.limits,
      trigger: ctx.trigger,
      subject,
      ...(ctx.event ? { eventSummary: ctx.event.summary } : {}),
      startedAt: now,
      isAgent: action.type === 'runAgent'
    };
    this.runs.push(run);
    this.journal({ ...base, status: 'started', runId, depth: gate.depth });
    this.emitChange();
    if (started.suspend) this.suspend(entry, started.suspend, ctx.projectRoot);

    // Действие выполняется в фоне: «запустить сейчас» не ждёт минутных проверок.
    void this.executeRun(run, entry, ctx, action, gate.budgetUsd);
    return { ok: true, runId };
  }

  private async executeRun(run: ActiveRun, entry: RuleEntry, ctx: FireContext, action: AutomationAction, budgetUsd: number | undefined): Promise<void> {
    const runId = run.runId;
    let result: ActionResult;
    try {
      result = await executeAutomationAction(
        {
          action,
          ruleKey: entry.key,
          ruleId: entry.rule.id,
          ruleName: entry.rule.name,
          runId,
          depth: run.depth,
          ...(ctx.projectRoot ? { projectRoot: ctx.projectRoot } : {}),
          ...(ctx.event ? { event: ctx.event } : {}),
          ...(budgetUsd !== undefined ? { budgetUsd } : {})
        },
        this.deps.actions
      );
    } catch (err) {
      result = { outcome: 'failed', detail: errorText(err) };
    }

    if (result.outcome === 'pending') {
      run.swarmIds.push(result.swarmId);
      run.agentIds.push(...result.agentIds);
      if (result.taskId && !run.taskIds.includes(result.taskId)) run.taskIds.push(result.taskId);
      this.pendingSwarms.set(result.swarmId, runId);
      // Сессия могла завершиться раньше, чем мы начали её ждать (ошибка старта агента).
      const snapshot = this.deps.getSwarm(result.swarmId);
      if (snapshot) this.handleSwarm(snapshot);
    } else {
      this.finishRun(run, { outcome: result.outcome, ...(result.detail ? { detail: result.detail } : {}) });
    }
  }

  private handleSwarm(session: SwarmSnapshot): void {
    const runId = this.pendingSwarms.get(session.id);
    if (!runId || !TERMINAL_SWARM.has(session.status)) return;
    this.pendingSwarms.delete(session.id);
    const run = this.runs.find((r) => r.runId === runId);
    if (!run) return;
    const failedAgent = session.agents.find((a) => a.status === 'failed');
    const success = session.status === 'completed' && !failedAgent;
    const detail = success
      ? `рой ${session.id}: завершён`
      : `рой ${session.id}: ${session.status}${session.error || failedAgent?.error ? ` — ${session.error || failedAgent?.error}` : ''}`;
    this.finishRun(run, { outcome: success ? 'success' : 'failed', detail, costUsd: session.totalCostUsd, swarmId: session.id });
  }

  private entryByKey(key: string): RuleEntry | undefined {
    if (key === BUILTIN_ASSIGNED_KEY) return this.builtinEntry();
    return [...this.globalEntries().entries, ...this.projectEntries()].find((e) => e.key === key);
  }

  private finishRun(run: ActiveRun, result: { outcome: 'success' | 'failed'; detail?: string; costUsd?: number; swarmId?: string }): void {
    const now = this.deps.now();
    run.finishedAt = now;
    let suspension: Suspension | undefined;
    let spent: number | undefined;
    if (run.isAgent) {
      const recorded = recordRunCost(this.getState(run.entryKey, now), result.costUsd, run.limits, now);
      this.setState(run.entryKey, recorded.state);
      suspension = recorded.suspend;
      spent = recorded.state.costTodayUsd;
    }
    this.journal({
      ruleKey: run.ruleKey,
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      scope: run.scope,
      status: result.outcome,
      runId: run.runId,
      trigger: run.trigger,
      subject: run.subject,
      action: run.action.type,
      depth: run.depth,
      durationMs: now - run.startedAt,
      ...(run.projectPath ? { projectPath: run.projectPath } : {}),
      ...(run.eventSummary ? { eventSummary: run.eventSummary } : {}),
      ...(result.detail ? { detail: result.detail.slice(0, 2000) } : {}),
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      ...(result.swarmId ? { swarmId: result.swarmId } : {})
    });
    this.deps.publish({
      type: 'automation:runFinished',
      ruleId: run.ruleId,
      ruleName: run.ruleName,
      runId: run.runId,
      ...(run.projectPath ? { projectPath: run.projectPath } : {}),
      action: run.action.type,
      outcome: result.outcome,
      ...(result.detail ? { detail: result.detail.slice(0, 500) } : {}),
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      ...(result.swarmId ? { swarmId: result.swarmId } : {}),
      at: now
    });
    if (suspension) {
      const entry = this.entryByKey(run.entryKey);
      if (entry) this.suspend(entry, suspension, run.projectPath, spent);
    }
    this.emitChange();
  }

  // ─────────────────────────── API для IPC и MCP ───────────────────────────

  public async list(): Promise<AutomationRuleView[]> {
    await this.refreshProjectRules().catch(() => false);
    const now = this.deps.now();
    const views: AutomationRuleView[] = [];
    const builtin = this.builtinEntry();
    views.push({
      key: builtin.key,
      scope: 'builtin',
      id: builtin.rule.id,
      name: builtin.rule.name,
      active: builtin.rule.enabled,
      enabled: builtin.rule.enabled,
      state: this.stateView(builtin.key, now),
      builtinLimits: { ...this.config.settings.builtinAssigned }
    });
    const { entries, invalid } = this.globalEntries();
    for (const e of entries) {
      views.push({
        key: e.key,
        scope: 'global',
        id: e.rule.id,
        name: e.rule.name,
        active: e.rule.enabled,
        enabled: e.rule.enabled,
        rule: e.rule,
        state: this.stateView(e.key, now)
      });
    }
    for (const bad of invalid) {
      const id = bad.id ?? '?';
      views.push({ key: `global:${id}`, scope: 'global', id, name: id, active: false, enabled: false, raw: bad.raw, issue: bad.message, state: this.stateView(`global:${id}`, now) });
    }
    for (const cache of this.projectRules.values()) {
      const scope: RuleScope = { kind: 'project', projectRoot: cache.root };
      for (const rule of cache.rules) {
        const entry = { key: ruleKey(scope, rule.id), scope, rule };
        const trust = this.trustFor(entry);
        views.push({
          key: entry.key,
          scope: 'project',
          id: rule.id,
          name: rule.name,
          projectRoot: cache.root,
          active: rule.enabled && trust === 'trusted',
          enabled: trust === 'trusted',
          trust,
          hash: ruleHash(rule),
          rule,
          state: this.stateView(entry.key, now)
        });
      }
      for (const bad of cache.issues) {
        const id = bad.id ?? `#${bad.index + 1}`;
        views.push({
          key: ruleKey(scope, id),
          scope: 'project',
          id,
          name: id,
          projectRoot: cache.root,
          active: false,
          enabled: false,
          raw: bad.raw,
          issue: bad.message,
          state: this.stateView(ruleKey(scope, id), now)
        });
      }
    }
    return views;
  }

  public getSettings(): AutomationsSettings {
    return JSON.parse(JSON.stringify(this.config.settings)) as AutomationsSettings;
  }

  public async updateSettings(patch: Partial<AutomationsSettings>): Promise<AutomationsSettings> {
    const next = {
      ...this.config.settings,
      ...(patch.maxConcurrentAgentRuns ? { maxConcurrentAgentRuns: patch.maxConcurrentAgentRuns } : {}),
      builtinAssigned: { ...this.config.settings.builtinAssigned, ...(patch.builtinAssigned ?? {}) }
    };
    this.config = { ...this.config, settings: normalizeAutomationsSettings(next) };
    await this.deps.store.saveConfig(this.config);
    this.emitChange();
    return this.getSettings();
  }

  public async saveGlobalRule(raw: unknown): Promise<{ ok: true; rule: AutomationRule } | { ok: false; error: string }> {
    const checked = validateRule(raw);
    if (!checked.ok) return checked;
    const scopeIssue = validateRuleForScope(checked.rule, { kind: 'global' });
    if (scopeIssue) return { ok: false, error: scopeIssue };
    const rules = this.config.rules.filter((r) => !(r && typeof r === 'object' && (r as { id?: unknown }).id === checked.rule.id));
    rules.push(checked.rule);
    this.config = { ...this.config, rules };
    // Изменённое расписание считается заново.
    const key = ruleKey({ kind: 'global' }, checked.rule.id);
    if (this.state[key]) {
      const { nextRunAt: _next, lastWallKey: _wall, ...rest } = this.state[key];
      this.setState(key, rest);
    }
    await this.deps.store.saveConfig(this.config);
    await this.tick();
    this.emitChange();
    return checked;
  }

  public async deleteGlobalRule(id: string): Promise<boolean> {
    const before = this.config.rules.length;
    const rules = this.config.rules.filter((r) => !(r && typeof r === 'object' && (r as { id?: unknown }).id === id));
    if (rules.length === before) return false;
    this.config = { ...this.config, rules };
    delete this.state[ruleKey({ kind: 'global' }, id)];
    this.scheduleStateSave();
    await this.deps.store.saveConfig(this.config);
    this.refreshTaskWatchers();
    this.emitChange();
    return true;
  }

  /**
   * Вкл/выкл правила. Глобальное — флаг в `automations.json`; проектное — подтверждение текущей
   * версии на этой машине (`hash` обязан совпасть с тем, что видел человек) или снятие доверия;
   * встроенное — флаг Remote Control.
   */
  public async setEnabled(key: string, enabled: boolean, hash?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (key === BUILTIN_ASSIGNED_KEY) {
      await this.deps.builtin.setEnabled(enabled);
      this.emitChange();
      return { ok: true };
    }
    const entry = [...this.globalEntries().entries, ...this.projectEntries()].find((e) => e.key === key);
    if (!entry) return { ok: false, error: 'Правило не найдено или содержит ошибку' };
    if (entry.scope.kind === 'global') {
      const rules = this.config.rules.map((r) =>
        r && typeof r === 'object' && (r as { id?: unknown }).id === entry.rule.id ? { ...(r as object), enabled } : r
      );
      this.config = { ...this.config, rules };
    } else {
      const projectKey = normalizePathKey(entry.scope.projectRoot || '');
      const trust = { ...this.config.trust, [projectKey]: { ...(this.config.trust[projectKey] ?? {}) } };
      if (enabled) {
        const current = ruleHash(entry.rule);
        if (!hash || hash !== current) return { ok: false, error: 'Правило изменилось — обновите список и проверьте новую версию' };
        trust[projectKey][entry.rule.id] = current;
      } else {
        delete trust[projectKey][entry.rule.id];
        if (!Object.keys(trust[projectKey]).length) delete trust[projectKey];
      }
      this.config = { ...this.config, trust };
    }
    await this.deps.store.saveConfig(this.config);
    await this.tick();
    this.emitChange();
    return { ok: true };
  }

  public resume(key: string): boolean {
    const state = this.state[key];
    if (!state?.pausedUntil) return false;
    const { pausedUntil: _p, pauseReason: _r, ...rest } = state;
    this.setState(key, rest);
    const entry = this.entryByKey(key);
    this.journal({
      ruleKey: key,
      ruleId: entry?.rule.id ?? key,
      ruleName: entry?.rule.name ?? key,
      scope: entry?.scope.kind ?? 'global',
      status: 'resumed',
      trigger: 'manual',
      detail: 'пауза снята вручную'
    });
    this.emitChange();
    return true;
  }

  /** Ручной запуск («запустить сейчас», `automation_run`): доверие и лимиты те же, cooldown — нет. */
  public async runNow(key: string, source: 'ui' | 'mcp'): Promise<RunNowResult> {
    if (key === BUILTIN_ASSIGNED_KEY) return { ok: false, reason: 'Встроенное правило запускается назначением задачи, а не вручную' };
    await this.refreshProjectRules().catch(() => false);
    const entry = [...this.globalEntries().entries, ...this.projectEntries()].find((e) => e.key === key);
    if (!entry) return { ok: false, reason: 'Правило не найдено или содержит ошибку' };
    if (entry.scope.kind === 'project' && this.trustFor(entry) !== 'trusted') {
      return { ok: false, reason: 'Проектное правило не подтверждено на этой машине' };
    }
    const action = entry.rule.action;
    const needsTaskFromEvent = action.type === 'runAgent' && !action.taskId && !action.prompt?.trim();
    if (needsTaskFromEvent) return { ok: false, reason: 'Правилу нужна задача из события — вручную его не запустить' };
    const runIds: string[] = [];
    const reasons: string[] = [];
    for (const projectRoot of this.targetsForScheduled(entry)) {
      const res = await this.fire(entry, { trigger: `manual:${source}`, manual: true, projectRoot, chain: null });
      if (res.ok) runIds.push(res.runId);
      else reasons.push(res.reason);
    }
    return runIds.length ? { ok: true, runIds } : { ok: false, reason: reasons.join(', ') || 'не запущено' };
  }

  public readLog(limit = 200): Promise<AutomationLogEntry[]> {
    return this.deps.store.readLog(limit);
  }

  /** Для тестов: дождаться записи журнала и состояния. */
  public async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.deps.store.saveState(this.state);
    }
    await this.deps.store.flush();
  }
}
