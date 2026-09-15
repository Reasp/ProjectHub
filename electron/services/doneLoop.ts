/**
 * Цикл «до готовности» (Done-loop, TASK-75, decision-28): чистая логика без Electron и IO.
 *
 * Здесь — схема и разбор отчёта агента, сверка критериев приёмки, решение «закончить /
 * повторить / прервать», тексты инструкций и повторного хода, итоговое резюме для задачи и
 * слияние настроек. Побочные эффекты (запуск агента, проверки, запись в Backlog) живут в
 * `doneLoopService`. Покрыт unit-тестами (`tests/unit/doneLoop.test.ts`).
 */
import { z } from 'zod';
import { extractJsonObject } from './reviewerPrompt.js';
import { isFailedStatus, scriptCommand, summarizeCheckResult, DEFAULT_CHECK_TIMEOUT_MS } from './arenaChecks.js';
import type { CheckDefinition, CheckRunResult } from './arenaTypes.js';
import type {
  AgentReport,
  CriterionReportStatus,
  CriterionVerification,
  DoneLoopOutcome,
  DoneLoopProjectSettings,
  DoneLoopSettings
} from './doneLoopTypes.js';

export const DEFAULT_DONE_LOOP_MAX_ITERATIONS = 5;
export const MAX_DONE_LOOP_ITERATIONS = 20;
/** Evidence короче этого не считается доказательством («готово», «ok»). */
export const MIN_EVIDENCE_CHARS = 12;
/** Язык ограды, в которой агент возвращает отчёт. */
export const REPORT_FENCE = 'projecthub-report';
/** Сколько символов хвоста одной проверки уходит в промпт повторного хода. */
export const RETRY_CHECK_TAIL_CHARS = 3000;

// ─────────────────────────────── Отчёт агента ───────────────────────────────

const STATUS_ALIASES: Record<string, CriterionReportStatus> = {
  done: 'done',
  met: 'done',
  complete: 'done',
  completed: 'done',
  passed: 'done',
  not_done: 'not_done',
  'not-done': 'not_done',
  notdone: 'not_done',
  unmet: 'not_done',
  partial: 'not_done',
  todo: 'not_done',
  failed: 'not_done',
  blocked: 'blocked'
};

function criterionIndex(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  if (typeof value === 'string') {
    const m = value.match(/(\d+)/);
    const n = m ? Number.parseInt(m[1], 10) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

const CriterionReportSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const r = raw as Record<string, unknown>;
    const status = typeof r.status === 'string' ? STATUS_ALIASES[r.status.trim().toLowerCase()] ?? r.status : r.status;
    return {
      index: criterionIndex(r.index ?? r.acId ?? r.id),
      status,
      evidence: typeof r.evidence === 'string' ? r.evidence.trim() : ''
    };
  },
  z.object({
    index: z.number().int().positive(),
    status: z.enum(['done', 'not_done', 'blocked']),
    evidence: z.string()
  })
);

/** Схема отчёта агента: описана в инструкции явно, валидируется zod. */
export const AgentReportSchema = z.object({
  summary: z.string().optional().default(''),
  criteria: z.array(CriterionReportSchema)
});

export const REPORT_EXAMPLE = `{
  "summary": "Что сделано в этом ходе, 2-4 предложения",
  "criteria": [
    { "index": 1, "status": "done", "evidence": "src/foo.ts:42 — функция bar; тест tests/unit/foo.test.ts «bar считает сумму» проходит" },
    { "index": 2, "status": "not_done", "evidence": "Не хватает обработки пустого ввода" }
  ]
}`;

/** Все сбалансированные JSON-объекты верхнего уровня в тексте (с учётом строк и экранирования). */
function jsonObjectsIn(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (;;) {
    const start = rest.indexOf('{');
    if (start < 0) break;
    const obj = extractJsonObject(rest);
    if (!obj) {
      // Незакрытая скобка (кусок кода в тексте) — пропускаем её и ищем дальше.
      rest = rest.slice(start + 1);
      continue;
    }
    out.push(obj);
    rest = rest.slice(start + obj.length);
  }
  return out;
}

export type ParsedAgentReport = { ok: true; report: AgentReport } | { ok: false; error: string };

/**
 * Разбор отчёта из финального сообщения агента. Предпочтение — последней ограде
 * ```projecthub-report```; без неё берётся последний JSON-объект с полем `criteria`
 * (агенты печатают по ходу работы и другие JSON). Отчёт должен пройти схему.
 */
export function parseAgentReport(text: string): ParsedAgentReport {
  const source = text ?? '';
  const fenceRe = new RegExp('```\\s*' + REPORT_FENCE + '\\s*\\n([\\s\\S]*?)```', 'g');
  const fenced = [...source.matchAll(fenceRe)];

  let candidate: string | null;
  if (fenced.length > 0) {
    candidate = extractJsonObject(fenced[fenced.length - 1][1]);
    if (!candidate) return { ok: false, error: `Блок ${REPORT_FENCE} не содержит JSON-объекта` };
  } else {
    const objects = jsonObjectsIn(source).filter((o) => /"criteria"\s*:/.test(o));
    candidate = objects.length > 0 ? objects[objects.length - 1] : null;
  }
  if (!candidate) return { ok: false, error: `В ответе нет отчёта (блок \`\`\`${REPORT_FENCE}\`\`\`)` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, error: `JSON отчёта не разобрался: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = AgentReportSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path?.length ? issue.path.join('.') : 'отчёт';
    return { ok: false, error: `Отчёт не соответствует схеме: ${where} — ${issue?.message ?? 'ошибка'}` };
  }
  return { ok: true, report: result.data };
}

// ───────────────────────────── Сверка критериев ─────────────────────────────

export interface CriterionInput {
  text: string;
  completed: boolean;
}

/**
 * Вердикт ProjectHub по каждому критерию задачи. Засчитывается только `done` с evidence не
 * короче `MIN_EVIDENCE_CHARS`. Набор и порядок критериев задаёт задача, а не агент: пропущенный
 * в отчёте критерий остаётся незакрытым. Уже отмеченные до цикла критерии не пересматриваются.
 */
export function verifyCriteria(
  criteria: CriterionInput[],
  report: AgentReport | null,
  minEvidenceChars = MIN_EVIDENCE_CHARS
): CriterionVerification[] {
  const byIndex = new Map<number, AgentReport['criteria'][number]>();
  for (const item of report?.criteria ?? []) {
    if (!byIndex.has(item.index)) byIndex.set(item.index, item);
  }

  return criteria.map((c, i) => {
    const index = i + 1;
    const item = byIndex.get(index);
    const base: CriterionVerification = {
      index,
      text: c.text,
      accepted: false,
      ...(item ? { reported: item.status, evidence: item.evidence } : {})
    };
    if (c.completed) return { ...base, accepted: true, alreadyChecked: true, reason: 'Отмечен в задаче до запуска цикла' };
    if (!report) return { ...base, reason: 'Нет разобранного отчёта агента' };
    if (!item) return { ...base, reason: 'Агент не отчитался по критерию' };
    if (item.status !== 'done') {
      return { ...base, reason: item.status === 'blocked' ? 'Агент сообщил о блокере' : 'Агент сообщил, что критерий не выполнен' };
    }
    if (item.evidence.trim().length < minEvidenceChars) {
      return { ...base, reason: 'Нет конкретного evidence (файл/тест/вывод команды)' };
    }
    return { ...base, accepted: true };
  });
}

/** Проверки прошли: ни одна блокирующая не упала (пропущенные не мешают). */
export function checksPassed(checks: CheckRunResult[]): boolean {
  return checks.every((c) => !c.blocking || !isFailedStatus(c.status));
}

// ───────────────────────────── Машина состояний ─────────────────────────────

export interface DecideInput {
  /** Номер только что завершённой итерации (1-based). */
  iteration: number;
  maxIterations: number;
  /** Человек остановил сессию. */
  stopped: boolean;
  /** Статус слота агента по итогам хода. */
  agentStatus: string;
  agentError?: string;
  checksPassed: boolean;
  allCriteriaAccepted: boolean;
  costUsd?: number;
  budgetUsd?: number;
}

export type DoneLoopDecision =
  | { action: 'finish' }
  | { action: 'retry' }
  | { action: 'fail'; outcome: Exclude<DoneLoopOutcome, 'success'>; reason: string };

/**
 * Переход после хода: `run → check → verify → finish | retry | fail`.
 * Порядок важен: остановка человеком сильнее всего; успешный ход завершает цикл даже на
 * границе бюджета или лимита (работа уже сделана и проверена); ошибка агента не повторяется
 * вслепую; дальше бюджет и лимит итераций.
 */
export function decideNext(input: DecideInput): DoneLoopDecision {
  if (input.stopped || input.agentStatus === 'stopped') {
    return { action: 'fail', outcome: 'stopped', reason: 'Цикл остановлен человеком' };
  }
  if (input.agentStatus === 'budget_exceeded') {
    return { action: 'fail', outcome: 'budget', reason: input.agentError || 'Агент остановлен по бюджету' };
  }
  if (input.agentStatus === 'failed') {
    return { action: 'fail', outcome: 'agent_error', reason: input.agentError || 'Ход агента завершился ошибкой' };
  }
  if (input.checksPassed && input.allCriteriaAccepted) return { action: 'finish' };

  const budget = input.budgetUsd;
  if (typeof budget === 'number' && budget > 0 && typeof input.costUsd === 'number' && input.costUsd >= budget) {
    return {
      action: 'fail',
      outcome: 'budget',
      reason: `Бюджет цикла $${budget.toFixed(2)} исчерпан (потрачено $${input.costUsd.toFixed(2)}) за ${input.iteration} итер.`
    };
  }
  if (input.iteration >= input.maxIterations) {
    return {
      action: 'fail',
      outcome: 'iteration_limit',
      reason: `Достигнут лимит итераций (${input.maxIterations}): ${failureSummary(input)}`
    };
  }
  return { action: 'retry' };
}

function failureSummary(input: DecideInput): string {
  const parts: string[] = [];
  if (!input.checksPassed) parts.push('проверки не прошли');
  if (!input.allCriteriaAccepted) parts.push('не все критерии приёмки закрыты');
  return parts.join(', ') || 'цель не достигнута';
}

// ───────────────────────────────── Промпты ─────────────────────────────────

/** Системная инструкция цикла — одинаковая для Claude CLI, Codex, Gemini и API-движка. */
export function buildDoneLoopInstructions(input: {
  taskId: string;
  criteria: CriterionInput[];
  checks: CheckDefinition[];
  maxIterations: number;
}): string {
  const criteriaLines = input.criteria.length
    ? input.criteria.map((c, i) => `${i + 1}. ${c.completed ? '[уже отмечен] ' : ''}${c.text}`).join('\n')
    : '(у задачи нет чеклиста — ориентируйся на описание)';
  const checkLines = input.checks.length
    ? input.checks.map((c) => `- ${c.name}: \`${c.command}\`${c.blocking === false ? ' (не блокирует)' : ''}`).join('\n')
    : '- (проверки для проекта не настроены)';

  return [
    '# Режим «до готовности» (ProjectHub Done-loop)',
    `Ты выполняешь задачу ${input.taskId} в замкнутом контуре. После каждого твоего хода ProjectHub сам ` +
      'коммитит изменения, запускает проверки проекта и сверяет критерии приёмки по твоему отчёту. ' +
      `Если что-то не сходится, ты получишь ошибки и продолжишь в этой же сессии (не больше ${input.maxIterations} ходов).`,
    `## Критерии приёмки\n${criteriaLines}`,
    `## Проверки, которые ProjectHub запустит после хода\n${checkLines}`,
    '## Правила\n' +
      '- Не отмечай чекбоксы критериев и не меняй `status` в файле задачи Backlog.md — это делает только ProjectHub; такие правки откатываются.\n' +
      '- Перед отчётом сам прогони проверки, если можешь, и исправь ошибки.\n' +
      '- Отмечай критерий `done` только с конкретным evidence: путь к файлу и строка, имя теста, команда и её результат. Без evidence критерий не засчитывается.\n' +
      '- Честно ставь `not_done` или `blocked` с объяснением — это дешевле, чем повторный ход по ложному `done`.',
    '## Отчёт в конце каждого хода\n' +
      `Последним блоком финального сообщения выведи отчёт в ограде \`\`\`${REPORT_FENCE}:\n` +
      '```' + REPORT_FENCE + '\n' + REPORT_EXAMPLE + '\n```\n' +
      '`index` — номер критерия из списка выше; дай строку по каждому незакрытому критерию. ' +
      '`status`: `done` | `not_done` | `blocked`.'
  ].join('\n\n');
}

function tail(text: string, max: number): string {
  const value = text ?? '';
  return value.length <= max ? value : `…${value.slice(value.length - max)}`;
}

/** Промпт повторного хода: что упало и какие критерии не засчитаны — с причинами. */
export function buildRetryPrompt(input: {
  iteration: number;
  maxIterations: number;
  checks: CheckRunResult[];
  criteria: CriterionVerification[];
  reportError?: string;
  tailChars?: number;
}): string {
  const tailChars = input.tailChars ?? RETRY_CHECK_TAIL_CHARS;
  const sections: string[] = [
    `[ProjectHub Done-loop] Итерация ${input.iteration} из ${input.maxIterations} не принята. Продолжи работу в этом же рабочем каталоге: ` +
      'исправь перечисленное ниже, не начинай задачу заново.'
  ];

  const failed = input.checks.filter((c) => isFailedStatus(c.status));
  if (failed.length > 0) {
    const blocks = failed.map(
      (c) =>
        `### ${c.name} (\`${c.command}\`) — ${summarizeCheckResult(c)}${c.blocking ? '' : ', не блокирует'}\n` +
        '```text\n' +
        tail(c.outputTail || c.detail || '(вывода нет)', tailChars) +
        '\n```'
    );
    sections.push(`## Упавшие проверки\n${blocks.join('\n\n')}`);
  } else if (input.checks.length > 0) {
    sections.push('## Проверки\nВсе проверки прошли — не сломай их.');
  }

  if (input.reportError) sections.push(`## Отчёт\nОтчёт не принят: ${input.reportError}.`);

  const open = input.criteria.filter((c) => !c.accepted);
  if (open.length > 0) {
    const lines = open.map((c) => `- #${c.index} ${c.text} — ${c.reason ?? 'не засчитан'}${c.evidence ? ` (твой evidence: «${tail(c.evidence, 300)}»)` : ''}`);
    sections.push(`## Незакрытые критерии приёмки\n${lines.join('\n')}`);
  }

  sections.push(`В конце хода снова выведи отчёт в ограде \`\`\`${REPORT_FENCE}\`\`\` по всем незакрытым критериям.`);
  return sections.join('\n\n');
}

export const OUTCOME_LABELS: Record<DoneLoopOutcome, string> = {
  success: 'готово',
  iteration_limit: 'исчерпан лимит итераций',
  budget: 'исчерпан бюджет',
  agent_error: 'ошибка агента',
  task_error: 'ошибка задачи',
  stopped: 'остановлен человеком'
};

/** Итоговое резюме для секции `Final Summary` задачи. */
export function buildDoneLoopFinalSummary(input: {
  outcome: DoneLoopOutcome;
  iterations: number;
  maxIterations: number;
  agentName: string;
  engine: string;
  criteria: CriterionVerification[];
  checks: CheckRunResult[];
  costUsd?: number;
  durationMs?: number;
  reportSummary?: string;
  branch?: string;
  commitHash?: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Выполнено агентом ProjectHub в режиме «до готовности» (${input.agentName}, движок ${input.engine}): ${OUTCOME_LABELS[input.outcome]}, ` +
      `итераций ${input.iterations} из ${input.maxIterations}.`
  );
  if (input.reportSummary) lines.push('', input.reportSummary.trim());

  if (input.criteria.length > 0) {
    lines.push('', 'Критерии приёмки (сверены ProjectHub по отчёту агента):');
    for (const c of input.criteria) {
      const mark = c.accepted ? 'x' : ' ';
      const note = c.alreadyChecked ? 'отмечен до запуска' : c.accepted ? c.evidence ?? '' : c.reason ?? '';
      lines.push(`- [${mark}] #${c.index} ${c.text}${note ? ` — ${note.replace(/\s+/g, ' ').trim()}` : ''}`);
    }
  }

  if (input.checks.length > 0) {
    lines.push('', 'Проверки последней итерации:');
    for (const c of input.checks) lines.push(`- ${c.name} (\`${c.command}\`): ${summarizeCheckResult(c)}`);
  } else {
    lines.push('', 'Проверки: не настроены.');
  }

  const meta: string[] = [];
  meta.push(`стоимость ${typeof input.costUsd === 'number' ? `$${input.costUsd.toFixed(4)}` : 'неизвестна'}`);
  if (typeof input.durationMs === 'number') meta.push(`длительность ${Math.round(input.durationMs / 1000)} с`);
  if (input.branch) meta.push(`ветка \`${input.branch}\``);
  if (input.commitHash) meta.push(`коммит ${input.commitHash.slice(0, 7)}`);
  lines.push('', `Итого: ${meta.join(', ')}.`);
  return lines.join('\n');
}

// ───────────────────────────────── Настройки ─────────────────────────────────

/** Скрипты документации, которые done-loop добавляет к проверкам проекта, если они есть. */
const DOC_CHECK_SCRIPTS: Array<{ script: string; id: string; name: string }> = [
  { script: 'lint:docs', id: 'lint-docs', name: 'Docs lint' },
  { script: 'check-index', id: 'check-index', name: 'RAG index' }
];

export interface ResolveDoneLoopInput {
  /** Проверки проекта (секция `checks` или дефолты из `package.json`) — те же, что у арены. */
  projectChecks: CheckDefinition[];
  project?: DoneLoopProjectSettings;
  scripts?: Record<string, string>;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Выбор пользователя в модалке запуска — сильнее настроек проекта. */
  overrides?: Partial<Pick<DoneLoopProjectSettings, 'maxIterations' | 'budgetUsd' | 'checkIds' | 'autoReview'>>;
}

function clampIterations(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_DONE_LOOP_ITERATIONS, Math.max(1, Math.trunc(value)));
}

function positiveOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Слияние: выбор в модалке → `.projecthub.json` → дефолты. Чистая функция — покрыта тестами. */
export function resolveDoneLoopSettings(input: ResolveDoneLoopInput): DoneLoopSettings {
  const project = input.project ?? {};
  const overrides = input.overrides ?? {};

  const checks = input.projectChecks.filter((c) => c.enabled !== false);
  if (project.docChecks !== false && input.scripts) {
    for (const doc of DOC_CHECK_SCRIPTS) {
      const command = input.scripts[doc.script];
      if (typeof command !== 'string' || !command.trim()) continue;
      if (checks.some((c) => c.id === doc.id || c.command.includes(doc.script))) continue;
      checks.push({
        id: doc.id,
        kind: 'custom',
        name: doc.name,
        command: scriptCommand(input.packageManager ?? 'npm', doc.script),
        timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
        blocking: true,
        enabled: true
      });
    }
  }

  const checkIds = overrides.checkIds ?? project.checkIds;
  const selected = Array.isArray(checkIds) ? checks.filter((c) => checkIds.includes(c.id)) : checks;

  return {
    maxIterations: clampIterations(overrides.maxIterations) ?? clampIterations(project.maxIterations) ?? DEFAULT_DONE_LOOP_MAX_ITERATIONS,
    ...(positiveOrUndefined(overrides.budgetUsd ?? project.budgetUsd) !== undefined
      ? { budgetUsd: positiveOrUndefined(overrides.budgetUsd ?? project.budgetUsd) }
      : {}),
    checks: selected,
    autoReview: (overrides.autoReview ?? project.autoReview) !== false
  };
}

/** Имя статуса «на ревью» из конфига проекта (TASK-68): регистр и пробелы не важны. */
export function findReviewStatus(statuses: string[] | undefined): string | undefined {
  return (statuses ?? []).find((s) => s.replace(/\s+/g, '').toLowerCase() === 'review');
}
