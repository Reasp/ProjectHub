import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppBusEvent } from './hitlTypes.js';
import { validateCron } from './cronExpr.js';
import { addedAssignees } from './taskSnapshot.js';

/**
 * Правила Automations (TASK-74, decision-52): «триггер + условие + действие».
 *
 * Чистый модуль без Electron и файловой системы: схема правила, превращение события шины в
 * события автоматизаций, матчинг условий, cooldown, дневные лимиты и бюджет, причинность
 * цепочек и хэш правила для доверия к проектным правилам. Побочные эффекты (запуск действий,
 * журнал, хранение) — в `automationService`.
 */

// ─────────────────────────── Константы ───────────────────────────

/** События шины, доступные пользователю как триггеры (только те, что шина реально публикует). */
export const AUTOMATION_EVENT_TRIGGERS = [
  'task.assigned',
  'task.statusChanged',
  'swarm.finished',
  'agent.failed',
  'process.crashed',
  'pr.created',
  'pr.checksFailed',
  'pr.opened',
  'pr.updated',
  'device.connected'
] as const;

export type AutomationEventTrigger = (typeof AUTOMATION_EVENT_TRIGGERS)[number];

/** Внутренний триггер встроенного правила назначенных задач: любое изменение файла задачи. */
export type AutomationEventKind = AutomationEventTrigger | 'task.updated';

export const AUTOMATION_ACTION_TYPES = ['runAgent', 'runChecks', 'reindexDocs', 'notify', 'projectAction', 'reviewPr'] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

/** Глубже этой цепочки «запуск → событие → запуск» автоматизации не идут. */
export const MAX_CHAIN_DEPTH = 3;
export const DEFAULT_COOLDOWN_MIN = 10;
/** Для действий с агентом cooldown не короче минуты — иначе опрос PR запускал бы агента на каждом тике. */
export const MIN_AGENT_COOLDOWN_MIN = 1;
export const DEFAULT_MAX_RUNS_PER_DAY = 20;
/** Сколько после завершения запуска события по его задаче считаются порождёнными им. */
export const CHAIN_ATTRIBUTION_WINDOW_MS = 2 * 60 * 1000;
export const DEFAULT_MAX_CONCURRENT_AGENT_RUNS = 2;
export const DEFAULT_TASK_PROMPT = 'Выполни задачу {{taskId}}: {{taskTitle}}';
/** Сколько ревьюеров может быть у одного ревью PR (decision-53 п. 2). */
export const MAX_PR_REVIEWERS = 3;
/** Триггеры, событие которых несёт PR, — только с ними действует `reviewPr`. */
export const PR_TRIGGERS: ReadonlySet<string> = new Set(['pr.opened', 'pr.updated', 'pr.created']);

/** Действия, запускающие агентов: для них обязателен дневной бюджет и действуют лимиты параллельности. */
export function isAgentAction(type: string): boolean {
  return type === 'runAgent' || type === 'reviewPr';
}

// ─────────────────────────── Схема правила ───────────────────────────

const TriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cron'),
    expr: z.string().trim().min(1),
    catchUp: z.enum(['skip', 'once']).default('skip')
  }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('event'), event: z.enum(AUTOMATION_EVENT_TRIGGERS) })
]);

const ConditionsSchema = z.object({
  /** Только для глобальных правил: проекты, к которым правило относится (пусто — все). */
  projects: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string().min(1)).optional(),
  statusTo: z.array(z.string().min(1)).optional(),
  statusFrom: z.array(z.string().min(1)).optional(),
  /** Шаблон исполнителя с `*` (например `agent:*`). */
  assignee: z.string().min(1).optional(),
  outcomes: z.array(z.enum(['completed', 'failed', 'stopped'])).optional(),
  /** Шаблон имени процесса с `*`. */
  processName: z.string().min(1).optional()
});

const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('runAgent'),
    roleSlug: z.string().trim().min(1),
    mode: z.enum(['single', 'doneLoop']).default('single'),
    /** Шаблон промпта: `{{taskId}}`, `{{taskTitle}}`, `{{event}}`, `{{projectName}}`. */
    prompt: z.string().max(4000).optional(),
    /** Фиксированная задача — для cron и ручного запуска. */
    taskId: z.string().trim().min(1).optional(),
    budgetUsd: z.number().positive().optional(),
    maxIterations: z.number().int().min(1).max(20).optional()
  }),
  z.object({ type: z.literal('runChecks'), checkIds: z.array(z.string().min(1)).optional() }),
  z.object({ type: z.literal('reindexDocs') }),
  z.object({ type: z.literal('notify'), title: z.string().trim().min(1).max(200), body: z.string().max(1000).optional() }),
  z.object({ type: z.literal('projectAction'), actionId: z.string().trim().min(1) }),
  /** Ревью PR (TASK-81, decision-53): ревьюеры на чтение, проверяющий, публикация только через человека. */
  z.object({
    type: z.literal('reviewPr'),
    reviewers: z.array(z.string().trim().min(1)).min(1).max(MAX_PR_REVIEWERS),
    verifier: z.string().trim().min(1).optional(),
    budgetUsd: z.number().positive().optional(),
    publish: z.enum(['hitl', 'manual']).default('hitl'),
    includeDrafts: z.boolean().default(false)
  })
]);

const LimitsSchema = z.object({
  cooldownMin: z.number().min(0).max(24 * 60).default(DEFAULT_COOLDOWN_MIN),
  maxRunsPerDay: z.number().int().min(1).max(1000).default(DEFAULT_MAX_RUNS_PER_DAY),
  dailyBudgetUsd: z.number().positive().optional()
});

function isTaskTrigger(trigger: AutomationTrigger): boolean {
  return trigger.kind === 'event' && trigger.event.startsWith('task.');
}

export const AutomationRuleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'id: латиница, цифры, «.», «_», «-», до 64 символов'),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    trigger: TriggerSchema,
    conditions: ConditionsSchema.default({}),
    action: ActionSchema,
    limits: LimitsSchema.default({})
  })
  .superRefine((rule, ctx) => {
    if (rule.trigger.kind === 'cron') {
      const error = validateCron(rule.trigger.expr);
      if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trigger', 'expr'], message: error });
    }
    if (rule.action.type === 'reviewPr' && !(rule.trigger.kind === 'event' && PR_TRIGGERS.has(rule.trigger.event))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trigger'], message: 'Ревью PR запускается только событием PR (pr.opened, pr.updated, pr.created)' });
    }
    if (isAgentAction(rule.action.type)) {
      if (!rule.limits.dailyBudgetUsd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['limits', 'dailyBudgetUsd'],
          message: 'Для запуска агента нужен дневной бюджет правила'
        });
      }
      if (rule.limits.cooldownMin < MIN_AGENT_COOLDOWN_MIN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['limits', 'cooldownMin'],
          message: `Cooldown для запуска агента — не меньше ${MIN_AGENT_COOLDOWN_MIN} мин`
        });
      }
    }
    if (rule.action.type === 'runAgent') {
      const taskFromEvent = isTaskTrigger(rule.trigger);
      if (rule.action.mode === 'doneLoop' && !taskFromEvent && !rule.action.taskId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action', 'taskId'],
          message: 'Цикл «до готовности» требует задачу: триггер задачи или taskId'
        });
      }
      if (!taskFromEvent && !rule.action.taskId && !rule.action.prompt?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action', 'prompt'], message: 'Без задачи нужен промпт агента' });
      }
    }
  });

export type AutomationRule = z.infer<typeof AutomationRuleSchema>;
export type AutomationRuleInput = z.input<typeof AutomationRuleSchema>;
export type AutomationTrigger = AutomationRule['trigger'];
export type AutomationAction = AutomationRule['action'];
export type AutomationConditions = AutomationRule['conditions'];
export type AutomationLimits = AutomationRule['limits'];

export interface RuleParseIssue {
  index: number;
  id?: string;
  message: string;
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

/** Разбор списка правил: неверные правила возвращаются ошибками, а не роняют остальные. */
export function parseRules(raw: unknown): { rules: AutomationRule[]; issues: RuleParseIssue[] } {
  const rules: AutomationRule[] = [];
  const issues: RuleParseIssue[] = [];
  if (raw === undefined || raw === null) return { rules, issues };
  if (!Array.isArray(raw)) return { rules, issues: [{ index: -1, message: 'automations: ожидается массив правил' }] };
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const id = item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : undefined;
    const parsed = AutomationRuleSchema.safeParse(item);
    if (!parsed.success) {
      issues.push({ index, id, message: formatZodError(parsed.error) });
      return;
    }
    if (seen.has(parsed.data.id)) {
      issues.push({ index, id, message: `Повторяющийся id правила «${parsed.data.id}»` });
      return;
    }
    seen.add(parsed.data.id);
    rules.push(parsed.data);
  });
  return { rules, issues };
}

/** Проверка одного правила (форма редактора, IPC сохранения). */
export function validateRule(raw: unknown): { ok: true; rule: AutomationRule } | { ok: false; error: string } {
  const parsed = AutomationRuleSchema.safeParse(raw);
  return parsed.success ? { ok: true, rule: parsed.data } : { ok: false, error: formatZodError(parsed.error) };
}

// ─────────────────────────── Область и ключи ───────────────────────────

export type RuleScopeKind = 'global' | 'project' | 'builtin';

export interface RuleScope {
  kind: RuleScopeKind;
  /** Корень проекта для проектного правила. */
  projectRoot?: string;
}

export function normalizePathKey(p: string, platform: string = process.platform): string {
  let key = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (platform === 'win32' || platform === 'darwin') key = key.toLowerCase();
  return key;
}

export function isPathInside(child: string | undefined, root: string | undefined, platform: string = process.platform): boolean {
  if (!child || !root) return false;
  const c = normalizePathKey(child, platform);
  const r = normalizePathKey(root, platform);
  return c === r || c.startsWith(`${r}/`);
}

/** Уникальный ключ правила: id уникален только внутри своего источника. */
export function ruleKey(scope: RuleScope, id: string): string {
  if (scope.kind === 'project') return `project:${normalizePathKey(scope.projectRoot || '')}:${id}`;
  return `${scope.kind}:${id}`;
}

/**
 * Проверки, зависящие от области: глобальному правилу без события (cron, ручной запуск) нужен
 * явный проект для всех действий, кроме уведомления.
 */
export function validateRuleForScope(rule: AutomationRule, scope: RuleScope): string | null {
  if (scope.kind === 'project' && rule.conditions.projects?.length) {
    return 'Проектное правило всегда относится к своему проекту: условие projects не используется';
  }
  if (scope.kind === 'global' && rule.trigger.kind !== 'event' && rule.action.type !== 'notify' && !rule.conditions.projects?.length) {
    return 'Глобальному правилу по расписанию или ручному нужен список проектов (conditions.projects)';
  }
  return null;
}

// ─────────────────────────── Доверие к проектным правилам ───────────────────────────

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Хэш содержимого правила для доверия (decision-52 п. 3). `enabled` не входит: автор проекта
 * может выключить и снова включить правило, не меняя того, что человек подтвердил.
 */
export function ruleHash(rule: AutomationRule): string {
  const { enabled: _enabled, ...rest } = rule;
  return createHash('sha256').update(JSON.stringify(canonicalize(rest))).digest('hex');
}

export type TrustStatus = 'trusted' | 'untrusted' | 'changed';

export function trustStatus(rule: AutomationRule, approvedHash: string | undefined): TrustStatus {
  if (!approvedHash) return 'untrusted';
  return approvedHash === ruleHash(rule) ? 'trusted' : 'changed';
}

// ─────────────────────────── События ───────────────────────────

export interface AutomationEvent {
  kind: AutomationEventKind;
  projectPath?: string;
  /** Предмет события — ключ cooldown: задача, PR, процесс, рой, устройство. */
  subject: string;
  /** Краткое описание для `{{event}}` и журнала. */
  summary: string;
  taskId?: string;
  taskTitle?: string;
  labels?: string[];
  status?: string;
  statusFrom?: string;
  statusTo?: string;
  /** Для `task.assigned` — добавленные исполнители, для остальных задач — все текущие. */
  assignee?: string[];
  outcome?: 'completed' | 'failed' | 'stopped';
  processName?: string;
  /** PR события (TASK-81): номер, голова, черновик. */
  prNumber?: number;
  prTitle?: string;
  prUrl?: string;
  headSha?: string;
  draft?: boolean;
  swarmId?: string;
  agentId?: string;
  at: number;
}

/** Событие шины → события автоматизаций (одно изменение задачи может дать несколько). */
export function automationEventsFromBus(event: AppBusEvent): AutomationEvent[] {
  switch (event.type) {
    case 'task:updated': {
      const base = {
        projectPath: event.projectPath,
        subject: `task:${event.taskId}`,
        taskId: event.taskId,
        taskTitle: event.title,
        labels: event.labels,
        status: event.status,
        at: event.at
      };
      const out: AutomationEvent[] = [
        { ...base, kind: 'task.updated', assignee: event.assignee, summary: `${event.taskId} изменена` }
      ];
      if (event.changes.status) {
        out.push({
          ...base,
          kind: 'task.statusChanged',
          assignee: event.assignee,
          statusFrom: event.changes.status.from,
          statusTo: event.changes.status.to,
          summary: `${event.taskId}: ${event.changes.status.from || '—'} → ${event.changes.status.to}`
        });
      }
      const added = addedAssignees(event.changes);
      if (added.length) {
        out.push({ ...base, kind: 'task.assigned', assignee: added, summary: `${event.taskId} назначена на ${added.join(', ')}` });
      }
      return out;
    }
    case 'swarm:finished':
      return [
        {
          kind: 'swarm.finished',
          projectPath: event.projectPath,
          subject: `swarm:${event.swarmId}`,
          summary: `рой «${event.name}» завершён: ${event.outcome}`,
          outcome: event.outcome,
          swarmId: event.swarmId,
          at: event.at
        }
      ];
    case 'agent:failed':
      return [
        {
          kind: 'agent.failed',
          projectPath: event.projectPath,
          subject: `agent:${event.sessionId}`,
          summary: `агент ${event.agentName || event.sessionId} упал: ${event.error}`,
          agentId: event.agentId,
          at: event.at
        }
      ];
    case 'process:crashed':
      return [
        {
          kind: 'process.crashed',
          projectPath: event.projectPath,
          subject: `process:${event.name}`,
          summary: `процесс «${event.name}» упал (код ${event.exitCode ?? '—'})`,
          processName: event.name,
          at: event.at
        }
      ];
    case 'pr:created':
      return [
        {
          kind: 'pr.created',
          projectPath: event.projectPath,
          subject: `pr:${event.number}`,
          summary: `PR #${event.number} «${event.title}» создан`,
          prNumber: event.number,
          prTitle: event.title,
          prUrl: event.url,
          at: event.at
        }
      ];
    case 'pr:opened':
    case 'pr:updated':
      return [
        {
          kind: event.type === 'pr:opened' ? 'pr.opened' : 'pr.updated',
          projectPath: event.projectPath,
          // Cooldown — на пару «PR + голова»: новый коммит в тот же PR ревьюится без ожидания.
          subject: `pr:${event.number}@${event.headSha.slice(0, 12)}`,
          summary:
            event.type === 'pr:opened'
              ? `PR #${event.number} «${event.title}» открыт`
              : `PR #${event.number} «${event.title}»: ${event.reason === 'ready' ? 'готов к ревью' : 'новые коммиты'}`,
          prNumber: event.number,
          prTitle: event.title,
          prUrl: event.url,
          headSha: event.headSha,
          draft: event.draft,
          at: event.at
        }
      ];
    case 'pr:checksFailed':
      return [
        {
          kind: 'pr.checksFailed',
          projectPath: event.projectPath,
          subject: `pr:${event.number}`,
          summary: `проверки PR #${event.number} «${event.title}» упали`,
          at: event.at
        }
      ];
    case 'remote:deviceConnected':
      return [
        {
          kind: 'device.connected',
          subject: `device:${event.deviceId}`,
          summary: `подключено устройство «${event.deviceName}»`,
          at: event.at
        }
      ];
    default:
      return [];
  }
}

// ─────────────────────────── Матчинг ───────────────────────────

export function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value.trim().toLowerCase());
}

function inList(list: string[] | undefined, value: string | undefined): boolean {
  if (!list?.length) return true;
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return list.some((item) => item.trim().toLowerCase() === v);
}

/** Совпадает ли событие с проектом правила. */
export function eventInScope(rule: AutomationRule, scope: RuleScope, event: AutomationEvent): boolean {
  if (scope.kind === 'project') {
    // Событие без проекта (подключение устройства) проектное правило исполняет в своём проекте.
    return !event.projectPath || isPathInside(event.projectPath, scope.projectRoot);
  }
  const projects = rule.conditions.projects;
  if (!projects?.length || !event.projectPath) return true;
  return projects.some((p) => isPathInside(event.projectPath, p));
}

/** Совпадает ли событие с триггером и условиями правила (без лимитов и cooldown). */
export function matchRuleEvent(rule: AutomationRule, scope: RuleScope, event: AutomationEvent): boolean {
  if (rule.trigger.kind !== 'event' || rule.trigger.event !== event.kind) return false;
  if (!eventInScope(rule, scope, event)) return false;
  const c = rule.conditions;
  if (c.labels?.length) {
    const labels = (event.labels ?? []).map((l) => l.toLowerCase());
    if (!c.labels.some((l) => labels.includes(l.toLowerCase()))) return false;
  }
  if (c.statusTo?.length && !inList(c.statusTo, event.statusTo ?? event.status)) return false;
  if (c.statusFrom?.length && !inList(c.statusFrom, event.statusFrom)) return false;
  if (c.assignee && !(event.assignee ?? []).some((a) => wildcardMatch(c.assignee!, a))) return false;
  if (c.outcomes?.length && (!event.outcome || !c.outcomes.includes(event.outcome))) return false;
  if (c.processName && !(event.processName && wildcardMatch(c.processName, event.processName))) return false;
  // Черновики PR ревьюятся, только если правило это разрешает (decision-53 п. 2).
  if (rule.action.type === 'reviewPr' && event.draft && !rule.action.includeDrafts) return false;
  return true;
}

// ─────────────────────────── Состояние, лимиты, cooldown ───────────────────────────

export interface RuleRuntimeState {
  /** Локальный день счётчиков `YYYY-MM-DD`. */
  day: string;
  runsToday: number;
  costTodayUsd: number;
  lastRunAt?: number;
  /** Последний запуск по предмету события — для cooldown. */
  lastRunBySubject: Record<string, number>;
  pausedUntil?: number;
  pauseReason?: 'budget' | 'runs';
  /** cron: следующее запланированное срабатывание. */
  nextRunAt?: number;
  /** cron: метка минуты последнего запуска. */
  lastWallKey?: string;
}

export function localDayKey(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nextLocalMidnight(at: number): number {
  const d = new Date(at);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function emptyRuleState(now: number): RuleRuntimeState {
  return { day: localDayKey(now), runsToday: 0, costTodayUsd: 0, lastRunBySubject: {} };
}

/**
 * Переход на новый день: счётчики обнуляются, пауза по лимиту снимается, старые метки cooldown
 * (старше суток) выбрасываются, чтобы состояние не росло бесконечно.
 */
export function rollRuleState(state: RuleRuntimeState | undefined, now: number): RuleRuntimeState {
  const base = state ? { ...state, lastRunBySubject: { ...state.lastRunBySubject } } : emptyRuleState(now);
  const today = localDayKey(now);
  if (base.day !== today) {
    base.day = today;
    base.runsToday = 0;
    base.costTodayUsd = 0;
  }
  if (base.pausedUntil !== undefined && base.pausedUntil <= now) {
    delete base.pausedUntil;
    delete base.pauseReason;
  }
  for (const [subject, at] of Object.entries(base.lastRunBySubject)) {
    if (now - at > 24 * 60 * 60 * 1000) delete base.lastRunBySubject[subject];
  }
  return base;
}

export type SkipReason =
  | 'disabled'
  | 'untrusted'
  | 'paused'
  | 'chain-self'
  | 'chain-depth'
  | 'cooldown'
  | 'runs-limit'
  | 'budget'
  | 'concurrency';

export interface Suspension {
  reason: 'budget' | 'runs';
  until: number;
}

export interface RunChain {
  parentRunId: string;
  parentRuleKey: string;
  depth: number;
}

export interface RunGateInput {
  ruleKey: string;
  action: AutomationAction;
  limits: AutomationLimits;
  state: RuleRuntimeState;
  now: number;
  subject: string;
  /** Ручной запуск: без cooldown, но с лимитами. */
  manual?: boolean;
  chain?: RunChain | null;
  activeAgentRuns: number;
  maxConcurrentAgentRuns: number;
}

export type RunGate =
  | { allow: true; depth: number; budgetUsd?: number }
  | { allow: false; reason: SkipReason; log: boolean; suspend?: Suspension };

/**
 * Можно ли запускать правило сейчас. `log` — стоит ли писать пропуск в журнал: пропуски по
 * cooldown, паузе и собственной цепочке ожидаемы и шумны (опрос PR), по лимитам — нет.
 */
export function gateRun(input: RunGateInput): RunGate {
  const { state, now, limits, action } = input;
  if (state.pausedUntil !== undefined && state.pausedUntil > now) return { allow: false, reason: 'paused', log: Boolean(input.manual) };

  const depth = input.chain ? input.chain.depth + 1 : 0;
  if (input.chain && input.chain.parentRuleKey === input.ruleKey) return { allow: false, reason: 'chain-self', log: false };
  if (depth > MAX_CHAIN_DEPTH) return { allow: false, reason: 'chain-depth', log: true };

  if (!input.manual) {
    const last = state.lastRunBySubject[input.subject];
    if (last !== undefined && now - last < limits.cooldownMin * 60 * 1000) return { allow: false, reason: 'cooldown', log: false };
  }

  const until = nextLocalMidnight(now);
  if (state.runsToday >= limits.maxRunsPerDay) {
    return { allow: false, reason: 'runs-limit', log: true, suspend: { reason: 'runs', until } };
  }

  if (!isAgentAction(action.type)) return { allow: true, depth };

  const limit = limits.dailyBudgetUsd ?? 0;
  const remaining = limit - state.costTodayUsd;
  if (remaining <= 0) return { allow: false, reason: 'budget', log: true, suspend: { reason: 'budget', until } };
  if (input.activeAgentRuns >= input.maxConcurrentAgentRuns) return { allow: false, reason: 'concurrency', log: true };
  const actionBudget = action.type === 'runAgent' || action.type === 'reviewPr' ? action.budgetUsd : undefined;
  const budgetUsd = Math.min(actionBudget ?? remaining, remaining);
  return { allow: true, depth, budgetUsd: Math.round(budgetUsd * 10000) / 10000 };
}

/** Учёт старта запуска; при достижении числа запусков правило встаёт на паузу до полуночи. */
export function recordRunStart(
  state: RuleRuntimeState,
  subject: string,
  limits: AutomationLimits,
  now: number
): { state: RuleRuntimeState; suspend?: Suspension } {
  const next: RuleRuntimeState = {
    ...state,
    runsToday: state.runsToday + 1,
    lastRunAt: now,
    lastRunBySubject: { ...state.lastRunBySubject, [subject]: now }
  };
  if (next.runsToday >= limits.maxRunsPerDay) {
    const suspend: Suspension = { reason: 'runs', until: nextLocalMidnight(now) };
    return { state: { ...next, pausedUntil: suspend.until, pauseReason: suspend.reason }, suspend };
  }
  return { state: next };
}

/** Учёт стоимости завершённого запуска; исчерпанный бюджет ставит правило на паузу до полуночи. */
export function recordRunCost(
  state: RuleRuntimeState,
  costUsd: number | undefined,
  limits: AutomationLimits,
  now: number
): { state: RuleRuntimeState; suspend?: Suspension } {
  const cost = typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
  // Запуск мог начаться вчера — его стоимость идёт в сегодняшние счётчики.
  const rolled = rollRuleState(state, now);
  const next: RuleRuntimeState = { ...rolled, costTodayUsd: Math.round((rolled.costTodayUsd + cost) * 1e6) / 1e6 };
  if (limits.dailyBudgetUsd && next.costTodayUsd >= limits.dailyBudgetUsd && next.pausedUntil === undefined) {
    const suspend: Suspension = { reason: 'budget', until: nextLocalMidnight(now) };
    return { state: { ...next, pausedUntil: suspend.until, pauseReason: suspend.reason }, suspend };
  }
  return { state: next };
}

// ─────────────────────────── Причинность цепочек ───────────────────────────

export interface RunTrace {
  runId: string;
  ruleKey: string;
  depth: number;
  projectPath?: string;
  swarmIds: string[];
  agentIds: string[];
  taskIds: string[];
  /** Отсутствует, пока запуск активен. */
  finishedAt?: number;
}

/**
 * Каким запуском порождено событие (decision-52 п. 5): событие роя или агента этого запуска,
 * либо изменение его задачи, пока он активен или в течение окна после завершения.
 * Из нескольких кандидатов берётся самая глубокая цепочка.
 */
export function attributeEvent(event: AutomationEvent, runs: RunTrace[], now: number): RunChain | null {
  let best: RunChain | null = null;
  for (const run of runs) {
    const bySwarm = Boolean(event.swarmId && run.swarmIds.includes(event.swarmId));
    const byAgent = Boolean(event.agentId && run.agentIds.includes(event.agentId));
    const recent = run.finishedAt === undefined || now - run.finishedAt <= CHAIN_ATTRIBUTION_WINDOW_MS;
    const byTask = Boolean(
      recent &&
        event.taskId &&
        run.taskIds.some((t) => t.toLowerCase() === event.taskId!.toLowerCase()) &&
        (!run.projectPath || !event.projectPath || isPathInside(event.projectPath, run.projectPath))
    );
    if (!bySwarm && !byAgent && !byTask) continue;
    if (!best || run.depth > best.depth) best = { parentRunId: run.runId, parentRuleKey: run.ruleKey, depth: run.depth };
  }
  return best;
}

// ─────────────────────────── Шаблоны ───────────────────────────

/** Подстановка `{{name}}`; неизвестные переменные становятся пустой строкой. */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_m, name: string) => vars[name] ?? '').trim();
}
