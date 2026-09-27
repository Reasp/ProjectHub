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
import { isUiSmokeCheck, iterationScreenshots, resolveScreenshotRef, type IterationArtifact } from './visualArtifacts.js';
import type {
  AgentReport,
  CriterionReportStatus,
  CriterionScreenshot,
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
    const shotsRaw = r.screenshots ?? r.screenshot ?? r.artifacts;
    const shots = (Array.isArray(shotsRaw) ? shotsRaw : typeof shotsRaw === 'string' ? [shotsRaw] : [])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());
    return {
      index: criterionIndex(r.index ?? r.acId ?? r.id),
      status,
      evidence: typeof r.evidence === 'string' ? r.evidence.trim() : '',
      ...(shots.length > 0 ? { screenshots: shots } : {})
    };
  },
  z.object({
    index: z.number().int().positive(),
    status: z.enum(['done', 'not_done', 'blocked']),
    evidence: z.string(),
    screenshots: z.array(z.string()).optional()
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
/** Критерий про UI (decision-55 п. 7): метка `[ui]` в тексте требует скриншот проверки. */
export function isUiCriterion(text: string): boolean {
  return /\[ui\]/i.test(text ?? '');
}

export function verifyCriteria(
  criteria: CriterionInput[],
  report: AgentReport | null,
  minEvidenceChars = MIN_EVIDENCE_CHARS,
  /** Скриншоты проверок этой итерации (`iterationScreenshots`) — ссылки отчёта сверяются с ними. */
  screenshots: readonly IterationArtifact[] = []
): CriterionVerification[] {
  const byIndex = new Map<number, AgentReport['criteria'][number]>();
  for (const item of report?.criteria ?? []) {
    if (!byIndex.has(item.index)) byIndex.set(item.index, item);
  }

  return criteria.map((c, i) => {
    const index = i + 1;
    const item = byIndex.get(index);
    const ui = isUiCriterion(c.text);
    const resolved: CriterionScreenshot[] = [];
    const missing: string[] = [];
    for (const ref of item?.screenshots ?? []) {
      const r = resolveScreenshotRef(ref, screenshots);
      if (r.ok) resolved.push({ ref, checkId: r.match.checkId, name: r.match.artifact.name, relPath: r.match.artifact.relPath });
      else missing.push(r.error === 'ambiguous' ? `«${ref}» неоднозначен (${(r.candidates ?? []).join(', ')})` : `«${ref}»`);
    }
    const base: CriterionVerification = {
      index,
      text: c.text,
      accepted: false,
      ...(item ? { reported: item.status, evidence: item.evidence } : {}),
      ...(ui ? { ui: true } : {}),
      ...(resolved.length > 0 ? { screenshots: resolved } : {})
    };
    if (c.completed) return { ...base, accepted: true, alreadyChecked: true, reason: 'Отмечен в задаче до запуска цикла' };
    if (!report) return { ...base, reason: 'Нет разобранного отчёта агента' };
    if (!item) return { ...base, reason: 'Агент не отчитался по критерию' };
    if (item.status !== 'done') {
      return { ...base, reason: item.status === 'blocked' ? 'Агент сообщил о блокере' : 'Агент сообщил, что критерий не выполнен' };
    }
    if (missing.length > 0) {
      return { ...base, reason: `Скриншот ${missing.join(', ')} не найден среди артефактов проверок итерации` };
    }
    if (ui && resolved.length === 0) {
      return { ...base, reason: 'Критерий [ui] требует скриншот проверки ui-smoke (поле screenshots в отчёте)' };
    }
    // Найденный скриншот — evidence наравне с текстом (decision-55 п. 7).
    if (resolved.length === 0 && item.evidence.trim().length < minEvidenceChars) {
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
  const uiSmoke = input.checks.filter(isUiSmokeCheck);
  const hasUiCriteria = input.criteria.some((c) => !c.completed && isUiCriterion(c.text));

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
      '`status`: `done` | `not_done` | `blocked`.',
    ...(uiSmoke.length > 0 ? [buildScreenshotEvidenceSection(uiSmoke)] : []),
    ...(hasUiCriteria && uiSmoke.length === 0
      ? [
          '## Критерии [ui]\nКритерии с меткой `[ui]` засчитываются только со скриншотом проверки `ui-smoke`, а такой проверки в ' +
            'проекте нет: отчитайся по ним `blocked` и объясни, что нужна проверка `ui-smoke` в `.projecthub.json`.'
        ]
      : [])
  ].join('\n\n');
}

/** Раздел инструкции о скриншотах как evidence — только если среди проверок есть `ui-smoke`. */
function buildScreenshotEvidenceSection(uiSmoke: CheckDefinition[]): string {
  const names = uiSmoke.map((c) => `\`${c.id}\``).join(', ');
  return (
    '## Скриншоты как evidence\n' +
    `Проверки ${names} сохраняют скриншоты в каталог из переменной окружения \`PROJECTHUB_ARTIFACTS_DIR\` ` +
    '(Playwright: `page.screenshot({ path: path.join(process.env.PROJECTHUB_ARTIFACTS_DIR, \'home.png\') })`). ' +
    'Для критерия про интерфейс добавь в строку отчёта поле `"screenshots": ["home.png"]` — имена файлов, которые создаёт тест. ' +
    'ProjectHub сверит их с артефактами проверок этой итерации; ненайденное имя — критерий не засчитан. ' +
    'Критерии с меткой `[ui]` без скриншота не засчитываются. Свои снимки из Playwright MCP evidence не являются.'
  );
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

  const shots = iterationScreenshots(input.checks);
  if (shots.length > 0) {
    const lines = shots.slice(0, 40).map((s) => `- ${s.checkId}/${s.artifact.name}`);
    sections.push(`## Скриншоты проверок этой итерации\nНа них можно ссылаться в поле \`screenshots\`:\n${lines.join('\n')}`);
  }

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
  /** Итераций в текущем отрезке цикла, если цикл продолжали после отката (decision-48 п. 2.3). */
  segmentIterations?: number;
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
  // Лимит действует на отрезок, а номера итераций сквозные: после продолжения показываем оба числа.
  const inSegment = input.segmentIterations;
  const count =
    inSegment !== undefined && inSegment !== input.iterations
      ? `итераций ${input.iterations}, после отката ${inSegment} из ${input.maxIterations}`
      : `итераций ${input.iterations} из ${input.maxIterations}`;
  lines.push(
    `Выполнено агентом ProjectHub в режиме «до готовности» (${input.agentName}, движок ${input.engine}): ${OUTCOME_LABELS[input.outcome]}, ${count}.`
  );
  if (input.reportSummary) lines.push('', input.reportSummary.trim());

  if (input.criteria.length > 0) {
    lines.push('', 'Критерии приёмки (сверены ProjectHub по отчёту агента):');
    for (const c of input.criteria) {
      const mark = c.accepted ? 'x' : ' ';
      const note = c.alreadyChecked ? 'отмечен до запуска' : c.accepted ? c.evidence ?? '' : c.reason ?? '';
      // Только имена: пути userData машинозависимы, а файл задачи коммитится (decision-55 п. 7).
      const shots = c.accepted && c.screenshots?.length ? ` (скриншоты: ${c.screenshots.map((s) => `${s.checkId}/${s.name}`).join(', ')})` : '';
      lines.push(`- [${mark}] #${c.index} ${c.text}${note ? ` — ${note.replace(/\s+/g, ' ').trim()}` : ''}${shots}`);
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
