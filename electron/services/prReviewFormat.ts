import { z } from 'zod';
import { jaccard, tokenize } from './memorySearch.js';
import { REDACTION_PATTERNS, detectSecrets } from './secretPatterns.js';

/**
 * Формат и логика ревью PR (TASK-81, decision-53 п. 4–8): промпты ревьюера и проверяющего,
 * разбор их ответов, дедупликация находок, отбор на проверку, комментарий в PR и команда
 * публикации. Чистый модуль без Electron и файловой системы — покрыт unit-тестами.
 */

export const REVIEW_FENCE = 'projecthub-review';
export const VERIFY_FENCE = 'projecthub-verify';
export const REVIEW_DIFF_MAX_CHARS = 60_000;
/** Сколько уникальных находок уходит проверяющему. */
export const MAX_VERIFIED_FINDINGS = 20;
/** Допуск по строкам, в пределах которого находки считаются об одном месте. */
export const LINE_TOLERANCE = 3;
/** Порог похожести текста находок (Жаккар по основам слов). */
export const TEXT_SIMILARITY = 0.3;
/** Мягкий порог для находок практически на одной строке (±1): разные ревьюеры описывают одно и то же разными словами. */
export const NEAR_LINE_TEXT_SIMILARITY = 0.15;
/** Порог совпадения цитат кода (`evidence`): одинаковая цитата в одном месте — та же находка. */
export const EVIDENCE_SIMILARITY = 0.6;
export const COMMENT_MAX_CHARS = 60_000;

export const SEVERITIES = ['critical', 'major', 'minor', 'nit'] as const;
export type ReviewSeverity = (typeof SEVERITIES)[number];

const SEVERITY_ALIASES: Record<string, ReviewSeverity> = {
  critical: 'critical',
  blocker: 'critical',
  severe: 'critical',
  major: 'major',
  high: 'major',
  error: 'major',
  bug: 'major',
  minor: 'minor',
  medium: 'minor',
  moderate: 'minor',
  warning: 'minor',
  low: 'nit',
  nit: 'nit',
  nitpick: 'nit',
  info: 'nit',
  style: 'nit'
};

export function normalizeSeverity(value: unknown): ReviewSeverity {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SEVERITY_ALIASES[v] ?? 'minor';
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { critical: 4, major: 3, minor: 2, nit: 1 };

// ─────────────────────────── Находки ───────────────────────────

const positiveInt = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}, z.number().int().positive().optional());

const text = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, max) : v === undefined || v === null ? undefined : String(v).trim().slice(0, max)), z.string().optional());

const FindingSchema = z
  .object({
    file: text(400),
    path: text(400),
    line: positiveInt,
    endLine: positiveInt,
    end_line: positiveInt,
    severity: z.unknown(),
    category: text(40),
    title: text(200),
    description: text(3000),
    message: text(3000),
    suggestion: text(2000),
    evidence: text(1500)
  })
  .transform((f) => ({
    file: (f.file || f.path || '').replace(/\\/g, '/').replace(/^\.?\//, ''),
    ...(f.line ? { line: f.line } : {}),
    ...(f.endLine || f.end_line ? { endLine: f.endLine ?? f.end_line } : {}),
    severity: normalizeSeverity(f.severity),
    ...(f.category ? { category: f.category.toLowerCase() } : {}),
    title: f.title || (f.description || f.message || '').split(/[.\n]/)[0].slice(0, 120),
    description: f.description || f.message || f.title || '',
    ...(f.suggestion ? { suggestion: f.suggestion } : {}),
    ...(f.evidence ? { evidence: f.evidence } : {})
  }));

export type ReviewFinding = z.infer<typeof FindingSchema>;

export interface ParsedReviewReport {
  ok: boolean;
  summary?: string;
  findings: ReviewFinding[];
  error?: string;
}

/** Содержимое последней ограды ```` ```<fence> ```` в тексте. */
export function extractFenced(source: string, fence: string): string | null {
  const re = new RegExp('```' + fence.replace(/[-]/g, '\\-') + '[^\\n]*\\n([\\s\\S]*?)```', 'g');
  let last: string | null = null;
  for (const m of source.matchAll(re)) last = m[1];
  return last;
}

/** Последний сбалансированный JSON-объект, в котором есть ключ `key` (для ответа без ограды). */
export function extractLastJsonWithKey(source: string, key: string): string | null {
  const text = source ?? '';
  let found: string | null = null;
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (candidate.includes(`"${key}"`)) {
            try {
              JSON.parse(candidate);
              found = candidate;
            } catch {
              // не JSON — ищем дальше
            }
          }
          break;
        }
      }
    }
  }
  return found;
}

function parseJsonBlock(source: string, fence: string, key: string): { value?: Record<string, unknown>; error?: string } {
  const block = extractFenced(source ?? '', fence) ?? extractLastJsonWithKey(source ?? '', key);
  if (!block) return { error: `В ответе нет ограды ${fence} и JSON с полем «${key}»` };
  try {
    const value = JSON.parse(block.trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Ответ не является объектом' };
    return { value: value as Record<string, unknown> };
  } catch (err) {
    return { error: `JSON не разобрался: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Разбор ответа ревьюера. Отдельные неверные находки отбрасываются, а не роняют весь ответ. */
export function parseReviewReport(source: string): ParsedReviewReport {
  const { value, error } = parseJsonBlock(source, REVIEW_FENCE, 'findings');
  if (!value) return { ok: false, findings: [], error };
  const list = Array.isArray(value.findings) ? value.findings : [];
  const findings: ReviewFinding[] = [];
  for (const item of list) {
    const parsed = FindingSchema.safeParse(item);
    if (parsed.success && parsed.data.file && parsed.data.description) findings.push(parsed.data);
  }
  const summary = typeof value.summary === 'string' ? value.summary.trim().slice(0, 2000) : undefined;
  return { ok: true, findings, ...(summary ? { summary } : {}) };
}

// ─────────────────────────── Вердикты проверяющего ───────────────────────────

export type VerifyVerdict = 'confirmed' | 'refuted' | 'uncertain';

const VERDICT_ALIASES: Record<string, VerifyVerdict> = {
  confirmed: 'confirmed',
  confirm: 'confirmed',
  valid: 'confirmed',
  true: 'confirmed',
  yes: 'confirmed',
  real: 'confirmed',
  refuted: 'refuted',
  refute: 'refuted',
  invalid: 'refuted',
  false: 'refuted',
  no: 'refuted',
  rejected: 'refuted',
  uncertain: 'uncertain',
  unknown: 'uncertain',
  unclear: 'uncertain'
};

export interface VerdictEntry {
  id: string;
  verdict: VerifyVerdict;
  reason?: string;
  evidence?: string;
}

export function parseVerifyReport(source: string): { ok: boolean; verdicts: VerdictEntry[]; error?: string } {
  const { value, error } = parseJsonBlock(source, VERIFY_FENCE, 'verdicts');
  if (!value) return { ok: false, verdicts: [], error };
  const list = Array.isArray(value.verdicts) ? value.verdicts : [];
  const verdicts: VerdictEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = String(r.id ?? '').trim().toUpperCase();
    if (!/^F\d+$/.test(id)) continue;
    const verdict = VERDICT_ALIASES[String(r.verdict ?? '').trim().toLowerCase()] ?? 'uncertain';
    const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 1000) : '';
    const evidence = typeof r.evidence === 'string' ? r.evidence.trim().slice(0, 1000) : '';
    verdicts.push({ id, verdict, ...(reason ? { reason } : {}), ...(evidence ? { evidence } : {}) });
  }
  return { ok: true, verdicts };
}

// ─────────────────────────── Дедупликация и отбор ───────────────────────────

export interface ReviewerReport {
  reviewer: string;
  findings: ReviewFinding[];
}

export interface UniqueFinding extends ReviewFinding {
  id: string;
  reviewers: string[];
  agreement: number;
  verdict?: VerifyVerdict;
  verdictReason?: string;
  verdictEvidence?: string;
}

function rangeOf(f: ReviewFinding): [number, number] | null {
  if (!f.line) return null;
  return [f.line, Math.max(f.line, f.endLine ?? f.line)];
}

function samePlace(a: ReviewFinding, b: ReviewFinding): boolean {
  if (a.file.toLowerCase() !== b.file.toLowerCase()) return false;
  const ra = rangeOf(a);
  const rb = rangeOf(b);
  if (!ra || !rb) return true;
  return ra[0] - LINE_TOLERANCE <= rb[1] && rb[0] - LINE_TOLERANCE <= ra[1];
}

function textSimilarity(a: ReviewFinding, b: ReviewFinding): number {
  return jaccard(tokenize(`${a.title} ${a.description}`), tokenize(`${b.title} ${b.description}`));
}

/** Токены цитаты кода: идентификаторы и числа, включая короткие (`n`, `||` не в счёт). */
function codeTokens(text: string | undefined): string[] {
  return (text ?? '').toLowerCase().match(/[a-z_$][\w$]*|\d+/g) ?? [];
}

/**
 * Та же ли это проблема: близкий текст; или та же цитата кода; или почти та же строка при более
 * мягком пороге текста. Живой прогон (TASK-81.6): ошибку `||` вместо `&&` два ревьюера описали на
 * строках 6 и 7 разными словами с одинаковой цитатой.
 */
function sameIssue(a: ReviewFinding, b: ReviewFinding): boolean {
  const sim = textSimilarity(a, b);
  if (sim >= TEXT_SIMILARITY) return true;
  const ea = codeTokens(a.evidence);
  const eb = codeTokens(b.evidence);
  if (ea.length >= 2 && eb.length >= 2 && jaccard(ea, eb) >= EVIDENCE_SIMILARITY) return true;
  return Boolean(a.line && b.line && Math.abs(a.line - b.line) <= 1 && sim >= NEAR_LINE_TEXT_SIMILARITY);
}

export function compareFindings(a: UniqueFinding, b: UniqueFinding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.agreement - a.agreement ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

/**
 * Склейка находок разных ревьюеров об одном месте: тот же файл, пересекающиеся строки (с допуском)
 * и близкий текст. У склеенной находки — максимальная серьёзность, самое подробное описание и
 * список ревьюеров; `agreement` — сколько разных ревьюеров её нашли. Находки одного ревьюера между
 * собой тоже склеиваются (повтор в ответе).
 */
export function dedupeFindings(reports: ReviewerReport[]): UniqueFinding[] {
  const groups: { lead: ReviewFinding; members: ReviewFinding[]; reviewers: Set<string> }[] = [];
  for (const report of reports) {
    for (const finding of report.findings) {
      const group = groups.find((g) => g.members.some((m) => samePlace(m, finding) && sameIssue(m, finding)));
      if (group) {
        group.members.push(finding);
        group.reviewers.add(report.reviewer);
      } else {
        groups.push({ lead: finding, members: [finding], reviewers: new Set([report.reviewer]) });
      }
    }
  }
  const merged: UniqueFinding[] = groups.map((g) => {
    const severity = g.members.reduce<ReviewSeverity>((best, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[best] ? m.severity : best), 'nit');
    const richest = [...g.members].sort((a, b) => b.description.length - a.description.length)[0];
    const lines = g.members.map(rangeOf).filter((r): r is [number, number] => Boolean(r));
    const suggestion = g.members.find((m) => m.suggestion)?.suggestion;
    const evidence = g.members.find((m) => m.evidence)?.evidence;
    return {
      id: '',
      file: g.lead.file,
      ...(lines.length ? { line: Math.min(...lines.map((r) => r[0])) } : {}),
      ...(lines.length && Math.max(...lines.map((r) => r[1])) > Math.min(...lines.map((r) => r[0])) ? { endLine: Math.max(...lines.map((r) => r[1])) } : {}),
      severity,
      ...(richest.category ? { category: richest.category } : {}),
      title: richest.title,
      description: richest.description,
      ...(suggestion ? { suggestion } : {}),
      ...(evidence ? { evidence } : {}),
      reviewers: [...g.reviewers],
      agreement: g.reviewers.size
    };
  });
  merged.sort(compareFindings);
  return merged.map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

/** Какие находки проверять: самые серьёзные и согласованные, не больше лимита. */
export function selectForVerification(findings: UniqueFinding[], max = MAX_VERIFIED_FINDINGS): UniqueFinding[] {
  return [...findings].sort(compareFindings).slice(0, max);
}

/** Вердикты проверяющего → находки. Находка без вердикта остаётся «не проверена». */
export function applyVerdicts(findings: UniqueFinding[], verdicts: VerdictEntry[]): UniqueFinding[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return findings.map((f) => {
    const v = byId.get(f.id);
    if (!v) return f;
    return { ...f, verdict: v.verdict, ...(v.reason ? { verdictReason: v.reason } : {}), ...(v.evidence ? { verdictEvidence: v.evidence } : {}) };
  });
}

// ─────────────────────────── Промпты ───────────────────────────

export interface ReviewPrInput {
  number: number;
  title: string;
  body?: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  url?: string;
}

export interface ReviewTaskInput {
  id: string;
  title: string;
  description?: string;
  criteria: string[];
}

function truncate(value: string, max: number): { text: string; truncated: boolean } {
  return value.length <= max ? { text: value, truncated: false } : { text: value.slice(0, max), truncated: true };
}

const REVIEW_EXAMPLE = `\`\`\`${REVIEW_FENCE}
{
  "summary": "Что меняет PR и общий вывод, 2-3 предложения",
  "findings": [
    {
      "file": "src/lib/parse.ts",
      "line": 42,
      "endLine": 45,
      "severity": "major",
      "category": "bug",
      "title": "Пустая строка роняет разбор",
      "description": "Почему это ошибка и когда она проявится",
      "suggestion": "Как исправить",
      "evidence": "Цитата кода или путь выполнения, подтверждающие находку"
    }
  ]
}
\`\`\``;

/** Промпт ревьюера PR: ищет ошибки, а не стиль; отвечает оградой `projecthub-review`. */
export function buildReviewerPrompt(input: { pr: ReviewPrInput; task?: ReviewTaskInput; diff: string; maxDiffChars?: number }): string {
  const { text: diff, truncated } = truncate(input.diff ?? '', input.maxDiffChars ?? REVIEW_DIFF_MAX_CHARS);
  const sections: string[] = [
    'Ты ревьюер Pull Request. Рабочий каталог — код головы этого PR; ты можешь только читать файлы и искать по ним. ' +
      'Ничего не меняй и не запускай. Найди настоящие проблемы: ошибки логики, регрессии, уязвимости, потерю данных, ' +
      'гонки, неверную обработку ошибок, нарушение критериев задачи. Стиль, форматирование и вкусовщину не пиши. ' +
      'Каждую находку подтверди: файл, строка, цитата кода или путь выполнения. Если проблем нет — верни пустой список. ' +
      `Результат засчитывается только из ограды ${REVIEW_FENCE} с JSON в конце ответа — таблицы и свободный текст не разбираются.`,
    `## Pull Request #${input.pr.number}: ${input.pr.title}\n` +
      `Ветка ${input.pr.headRef} → ${input.pr.baseRef}, голова ${input.pr.headSha.slice(0, 12)}` +
      (input.pr.body?.trim() ? `\n\n${truncate(input.pr.body.trim(), 4000).text}` : '')
  ];
  if (input.task) {
    const criteria = input.task.criteria.length ? `\n\nКритерии приёмки:\n${input.task.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '';
    sections.push(`## Связанная задача ${input.task.id}: ${input.task.title}\n${truncate(input.task.description ?? '', 4000).text}${criteria}`);
  }
  sections.push(
    `## Дифф PR\n${diff ? `\`\`\`diff\n${diff}\n\`\`\`` : '(пусто)'}` +
      (truncated ? '\n\n[дифф усечён для промпта — остальные изменения читай в файлах рабочего каталога]' : '')
  );
  sections.push(
    `## Формат ответа\nПоследним блоком ответа верни ограду ${REVIEW_FENCE} с JSON:\n${REVIEW_EXAMPLE}\n` +
      '`severity`: critical | major | minor | nit. `line` — строка в новой версии файла.'
  );
  // Последний абзац — напоминание о формате: локальные модели чаще следуют последней инструкции.
  sections.push(`ВАЖНО: закончи ответ оградой \`\`\`${REVIEW_FENCE} с JSON по образцу выше. Ответ без неё не будет засчитан.`);
  return sections.join('\n\n');
}

/** Промпт проверяющего: попытаться опровергнуть каждую находку по коду; ответ — ограда `projecthub-verify`. */
export function buildVerifierPrompt(input: { pr: ReviewPrInput; findings: UniqueFinding[] }): string {
  const list = input.findings
    .map((f) => {
      const place = `${f.file}${f.line ? `:${f.line}${f.endLine ? `-${f.endLine}` : ''}` : ''}`;
      return [
        `### ${f.id} [${f.severity}] ${place}`,
        f.title,
        f.description,
        f.evidence ? `Доказательство ревьюера: ${f.evidence}` : '',
        f.suggestion ? `Предложение: ${f.suggestion}` : ''
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
  return [
    `Ты проверяющий находок ревью PR #${input.pr.number} «${input.pr.title}». Рабочий каталог — код головы PR; ` +
      'ты можешь только читать файлы и искать по ним. Для каждой находки ниже прочитай указанное место и попробуй ' +
      'её опровергнуть: ошибается ли ревьюер, обработан ли случай в другом месте, достижим ли путь выполнения. ' +
      '`confirmed` — только если ты сам нашёл в коде подтверждение (процитируй его в evidence); `refuted` — если ' +
      'находка неверна; `uncertain` — если проверить нельзя. Сомневаешься — не подтверждай.',
    `## Находки\n${list}`,
    `## Формат ответа\nПоследним блоком верни ограду ${VERIFY_FENCE}:\n\`\`\`${VERIFY_FENCE}\n` +
      '{ "verdicts": [{ "id": "F1", "verdict": "confirmed", "reason": "почему", "evidence": "цитата кода" }] }\n```\n' +
      'Дай вердикт по каждой находке из списка.',
    `ВАЖНО: закончи ответ оградой \`\`\`${VERIFY_FENCE} с JSON. Ответ без неё не будет засчитан.`
  ].join('\n\n');
}

// ─────────────────────────── Связанная задача ───────────────────────────

/** `feat/task-12`, `TASK-12.3: …` → `TASK-12` / `TASK-12.3`. */
export function findLinkedTaskId(...texts: (string | undefined)[]): string | null {
  for (const t of texts) {
    const m = String(t ?? '').match(/task-(\d+(?:\.\d+)*)/i);
    if (m) return `TASK-${m[1]}`;
  }
  return null;
}

// ─────────────────────────── Комментарий и публикация ───────────────────────────

export interface CommentInput {
  pr: { number: number; headSha: string };
  findings: UniqueFinding[];
  reviewers: string[];
  verifier?: string;
  costUsd?: number;
}

const SEVERITY_ICON: Record<ReviewSeverity, string> = { critical: '🛑', major: '⚠️', minor: '🔸', nit: '▫️' };

/** Маскировка секретов в тексте для публикации; `blocked` — детектор всё равно видит секрет. */
export function sanitizeForPublication(textIn: string): { text: string; blocked?: string } {
  let out = textIn ?? '';
  for (const [re, replacement] of REDACTION_PATTERNS) out = out.replace(re, replacement);
  const left = detectSecrets(out);
  return left.length ? { text: out, blocked: left.map((s) => s.kind).join(', ') } : { text: out };
}

/** Сводный комментарий: только подтверждённые находки, по серьёзности. */
export function buildPrComment(input: CommentInput): string {
  const confirmed = input.findings.filter((f) => f.verdict === 'confirmed').sort(compareFindings);
  const refuted = input.findings.filter((f) => f.verdict === 'refuted').length;
  const unverified = input.findings.length - confirmed.length - refuted;
  const lines: string[] = [
    `### Ревью ProjectHub · ${input.pr.headSha.slice(0, 7)}`,
    '',
    confirmed.length
      ? `Подтверждено замечаний: **${confirmed.length}** (ревьюеры: ${input.reviewers.join(', ')}${input.verifier ? `; проверка: ${input.verifier}` : ''}).`
      : 'Подтверждённых замечаний нет.',
    ''
  ];
  for (const f of confirmed) {
    const place = `\`${f.file}${f.line ? `:${f.line}${f.endLine ? `-${f.endLine}` : ''}` : ''}\``;
    lines.push(`#### ${SEVERITY_ICON[f.severity]} ${f.severity} · ${place} — ${f.title}`);
    lines.push('', f.description);
    if (f.suggestion) lines.push('', `**Предложение:** ${f.suggestion}`);
    if (f.verdictEvidence) lines.push('', `<details><summary>Подтверждение</summary>\n\n${f.verdictEvidence}\n\n</details>`);
    if (f.agreement > 1) lines.push('', `_Нашли ${f.agreement} ревьюера._`);
    lines.push('');
  }
  const footer = [
    refuted ? `отброшено при проверке: ${refuted}` : '',
    unverified > 0 ? `не проверено: ${unverified}` : '',
    input.costUsd !== undefined ? `стоимость ревью: $${input.costUsd.toFixed(2)}` : ''
  ].filter(Boolean);
  if (footer.length) lines.push(`<sub>${footer.join(' · ')}</sub>`);
  return truncate(lines.join('\n').trim(), COMMENT_MAX_CHARS).text;
}

/**
 * Аргументы `gh` для публикации. Единственная команда, которой ревью пишет в PR, — комментарий:
 * approve и request changes (`gh pr review`) недоступны в принципе (decision-53 п. 8).
 */
export function ghCommentArgs(prNumber: number, bodyFile: string): string[] {
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error(`Неверный номер PR: ${prNumber}`);
  return ['pr', 'comment', String(prNumber), '--body-file', bodyFile];
}
