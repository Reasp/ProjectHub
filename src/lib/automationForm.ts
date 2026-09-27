import type { AutomationAction, AutomationEventTrigger, AutomationRule, AutomationRuleInput, AutomationTrigger } from '../types/electron';

/**
 * Форма редактора правила Automations (TASK-74, decision-52) ↔ правило. Чистый модуль: поля формы
 * хранятся строками, как их вводит человек; разбор чисел и списков — здесь, проверку схемы
 * выполняет main (`automationRules.validateRule`) и возвращает понятную ошибку.
 */

export const AUTOMATION_EVENTS: AutomationEventTrigger[] = [
  'task.statusChanged',
  'task.assigned',
  'swarm.finished',
  'agent.failed',
  'process.crashed',
  'pr.created',
  'pr.checksFailed',
  'pr.opened',
  'pr.updated',
  'device.connected'
];

export type AutomationActionType = AutomationAction['type'];
export const AUTOMATION_ACTIONS: AutomationActionType[] = ['runAgent', 'runChecks', 'reindexDocs', 'notify', 'projectAction', 'reviewPr', 'auditDependencies'];
export const AUDIT_MIN_SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'] as const;
export type AuditMinSeverity = (typeof AUDIT_MIN_SEVERITIES)[number];

export interface AutomationFormState {
  id: string;
  name: string;
  enabled: boolean;
  triggerKind: AutomationTrigger['kind'];
  cronExpr: string;
  catchUp: 'skip' | 'once';
  event: AutomationEventTrigger;
  projects: string[];
  labels: string;
  statusTo: string;
  statusFrom: string;
  assignee: string;
  outcomes: ('completed' | 'failed' | 'stopped')[];
  processName: string;
  actionType: AutomationActionType;
  roleSlug: string;
  mode: 'single' | 'doneLoop';
  prompt: string;
  taskId: string;
  runBudgetUsd: string;
  maxIterations: string;
  checkIds: string;
  notifyTitle: string;
  notifyBody: string;
  actionId: string;
  /** Ревью PR (TASK-81): роли ревьюеров, проверяющий, публикация, черновики. */
  reviewers: string[];
  verifier: string;
  publish: 'hitl' | 'manual';
  includeDrafts: boolean;
  /** Аудит зависимостей (TASK-73): порог новых находок для уведомления. */
  minSeverity: AuditMinSeverity;
  cooldownMin: string;
  maxRunsPerDay: string;
  dailyBudgetUsd: string;
}

export function emptyAutomationForm(): AutomationFormState {
  return {
    id: '',
    name: '',
    enabled: true,
    triggerKind: 'event',
    cronExpr: '0 9 * * 1-5',
    catchUp: 'skip',
    event: 'task.statusChanged',
    projects: [],
    labels: '',
    statusTo: '',
    statusFrom: '',
    assignee: '',
    outcomes: [],
    processName: '',
    actionType: 'runChecks',
    roleSlug: '',
    mode: 'single',
    prompt: '',
    taskId: '',
    runBudgetUsd: '',
    maxIterations: '',
    checkIds: '',
    notifyTitle: '',
    notifyBody: '',
    actionId: 'test',
    reviewers: [],
    verifier: '',
    publish: 'hitl',
    includeDrafts: false,
    minSeverity: 'high',
    cooldownMin: '10',
    maxRunsPerDay: '20',
    dailyBudgetUsd: ''
  };
}

/** `a, b ,, c` → `['a','b','c']`. */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const joinList = (list?: string[]) => (list ?? []).join(', ');
const numText = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '');

/** Число из поля формы; пусто или мусор — `undefined` (схема в main скажет, если поле обязательно). */
export function parseNumber(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

/** id правила из названия: латиница, цифры и дефисы, до 48 символов. */
export function ruleIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'rule';
}

export function formFromRule(rule: AutomationRule): AutomationFormState {
  const base = emptyAutomationForm();
  const c = rule.conditions ?? {};
  const form: AutomationFormState = {
    ...base,
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    triggerKind: rule.trigger.kind,
    ...(rule.trigger.kind === 'cron' ? { cronExpr: rule.trigger.expr, catchUp: rule.trigger.catchUp } : {}),
    ...(rule.trigger.kind === 'event' ? { event: rule.trigger.event } : {}),
    projects: [...(c.projects ?? [])],
    labels: joinList(c.labels),
    statusTo: joinList(c.statusTo),
    statusFrom: joinList(c.statusFrom),
    assignee: c.assignee ?? '',
    outcomes: [...(c.outcomes ?? [])],
    processName: c.processName ?? '',
    actionType: rule.action.type,
    cooldownMin: numText(rule.limits.cooldownMin),
    maxRunsPerDay: numText(rule.limits.maxRunsPerDay),
    dailyBudgetUsd: numText(rule.limits.dailyBudgetUsd)
  };
  const a = rule.action;
  if (a.type === 'runAgent') {
    Object.assign(form, {
      roleSlug: a.roleSlug,
      mode: a.mode,
      prompt: a.prompt ?? '',
      taskId: a.taskId ?? '',
      runBudgetUsd: numText(a.budgetUsd),
      maxIterations: numText(a.maxIterations)
    });
  } else if (a.type === 'runChecks') {
    form.checkIds = joinList(a.checkIds);
  } else if (a.type === 'notify') {
    form.notifyTitle = a.title;
    form.notifyBody = a.body ?? '';
  } else if (a.type === 'projectAction') {
    form.actionId = a.actionId;
  } else if (a.type === 'auditDependencies') {
    form.minSeverity = a.minSeverity;
  } else if (a.type === 'reviewPr') {
    Object.assign(form, {
      reviewers: [...a.reviewers],
      verifier: a.verifier ?? '',
      publish: a.publish,
      includeDrafts: a.includeDrafts,
      runBudgetUsd: numText(a.budgetUsd)
    });
  }
  return form;
}

function actionFromForm(form: AutomationFormState): AutomationRuleInput['action'] {
  switch (form.actionType) {
    case 'runAgent': {
      const budget = parseNumber(form.runBudgetUsd);
      const iterations = parseNumber(form.maxIterations);
      return {
        type: 'runAgent',
        roleSlug: form.roleSlug.trim(),
        mode: form.mode,
        ...(form.prompt.trim() ? { prompt: form.prompt.trim() } : {}),
        ...(form.taskId.trim() ? { taskId: form.taskId.trim() } : {}),
        ...(budget !== undefined ? { budgetUsd: budget } : {}),
        ...(form.mode === 'doneLoop' && iterations !== undefined ? { maxIterations: iterations } : {})
      };
    }
    case 'runChecks': {
      const ids = splitList(form.checkIds);
      return { type: 'runChecks', ...(ids.length ? { checkIds: ids } : {}) };
    }
    case 'reindexDocs':
      return { type: 'reindexDocs' };
    case 'auditDependencies':
      return { type: 'auditDependencies', minSeverity: form.minSeverity };
    case 'notify':
      return { type: 'notify', title: form.notifyTitle.trim(), ...(form.notifyBody.trim() ? { body: form.notifyBody.trim() } : {}) };
    case 'projectAction':
      return { type: 'projectAction', actionId: form.actionId.trim() };
    case 'reviewPr': {
      const budget = parseNumber(form.runBudgetUsd);
      return {
        type: 'reviewPr',
        reviewers: [...form.reviewers],
        ...(form.verifier.trim() ? { verifier: form.verifier.trim() } : {}),
        ...(budget !== undefined ? { budgetUsd: budget } : {}),
        publish: form.publish,
        includeDrafts: form.includeDrafts
      };
    }
  }
}

/** Правило из формы; условия, не относящиеся к выбранному триггеру, не попадают в правило. */
export function ruleFromForm(form: AutomationFormState): AutomationRuleInput {
  const trigger: AutomationRuleInput['trigger'] =
    form.triggerKind === 'cron'
      ? { kind: 'cron', expr: form.cronExpr.trim(), catchUp: form.catchUp }
      : form.triggerKind === 'event'
        ? { kind: 'event', event: form.event }
        : { kind: 'manual' };

  const isEvent = form.triggerKind === 'event';
  const isTask = isEvent && form.event.startsWith('task.');
  const labels = splitList(form.labels);
  const statusTo = splitList(form.statusTo);
  const statusFrom = splitList(form.statusFrom);
  const conditions = {
    ...(form.projects.length ? { projects: [...form.projects] } : {}),
    ...(isTask && labels.length ? { labels } : {}),
    ...(isEvent && form.event === 'task.statusChanged' && statusTo.length ? { statusTo } : {}),
    ...(isEvent && form.event === 'task.statusChanged' && statusFrom.length ? { statusFrom } : {}),
    ...(isTask && form.assignee.trim() ? { assignee: form.assignee.trim() } : {}),
    ...(isEvent && form.event === 'swarm.finished' && form.outcomes.length ? { outcomes: [...form.outcomes] } : {}),
    ...(isEvent && form.event === 'process.crashed' && form.processName.trim() ? { processName: form.processName.trim() } : {})
  };

  const cooldown = parseNumber(form.cooldownMin);
  const maxRuns = parseNumber(form.maxRunsPerDay);
  const budget = parseNumber(form.dailyBudgetUsd);
  const limits = {
    ...(cooldown !== undefined ? { cooldownMin: cooldown } : {}),
    ...(maxRuns !== undefined ? { maxRunsPerDay: Math.round(maxRuns) } : {}),
    ...(budget !== undefined ? { dailyBudgetUsd: budget } : {})
  };

  return {
    id: form.id.trim() || ruleIdFromName(form.name),
    name: form.name.trim(),
    enabled: form.enabled,
    trigger,
    conditions,
    action: actionFromForm(form),
    limits
  };
}
