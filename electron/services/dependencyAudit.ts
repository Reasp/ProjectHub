/**
 * Разбор аудита зависимостей проекта (decision-56 п. 2, TASK-73).
 *
 * Форматы сняты с живых запусков 2026-09-27: `npm audit --json` npm 10.9 (`auditReportVersion: 2`, ENOLOCK,
 * недоступный registry) и `pip-audit -f json` 2.10 (`--no-deps --disable-pip`, незакреплённые требования).
 * Код возврата 1 у обоих инструментов означает «есть находки», а не сбой — решает содержимое вывода.
 *
 * Чистый модуль: без Electron, процессов и файловой системы.
 */

export type AuditSeverity = 'critical' | 'high' | 'moderate' | 'low' | 'info' | 'unknown';
export const AUDIT_SEVERITIES: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info', 'unknown'];

export type AuditEcosystem = 'npm' | 'pip' | 'yarn' | 'pnpm' | 'cargo';

/** `done` — аудит прошёл (находки могут быть пустыми); остальное — «нет данных» с причиной. */
export type AuditRunStatus = 'done' | 'no_lockfile' | 'not_installed' | 'unsupported' | 'error';
export type AuditErrorKind = 'network' | 'timeout' | 'format' | 'tool';

export interface AuditAdvisory {
  /** GHSA-…, PYSEC-… или номер advisory registry. */
  id: string;
  title: string;
  url?: string;
  severity: AuditSeverity;
  /** Уязвимый диапазон версий. */
  range?: string;
  fixVersions?: string[];
  aliases?: string[];
}

export interface AuditFinding {
  ecosystem: AuditEcosystem;
  package: string;
  /** Установленная версия — pip-audit её знает, npm audit — нет. */
  version?: string;
  severity: AuditSeverity;
  /** Прямая зависимость проекта (npm `isDirect`); у pip — всегда прямая (режим `--no-deps`). */
  direct?: boolean;
  advisories: AuditAdvisory[];
  /** Транзитивная уязвимость: пакеты, через которые она пришла (npm `via` строками). */
  via?: string[];
  range?: string;
  fix?: { available: boolean; name?: string; version?: string; major?: boolean };
}

export type SeverityCounts = Record<AuditSeverity, number>;

export interface EcosystemAuditParse {
  status: AuditRunStatus;
  findings: AuditFinding[];
  counts: SeverityCounts;
  errorKind?: AuditErrorKind;
  /** Причина для человека: подсказка про lock-файл, текст ошибки инструмента. */
  message?: string;
  /** Сколько зависимостей проверено (npm `metadata.dependencies.total`, pip — число пакетов). */
  dependencyCount?: number;
}

export function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0, unknown: 0 };
}

export function normalizeSeverity(value: unknown): AuditSeverity {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'medium') return 'moderate';
  return (AUDIT_SEVERITIES as string[]).includes(v) ? (v as AuditSeverity) : 'unknown';
}

/**
 * Ранг для порогов. `unknown` (pip-audit уровня не сообщает) считается как `high`: для уведомлений консервативнее
 * лишний раз сказать, чем молча пропустить уязвимость Python-пакета.
 */
const RANK: Record<AuditSeverity, number> = { critical: 5, high: 4, unknown: 4, moderate: 3, low: 2, info: 1 };

export function severityRank(severity: AuditSeverity): number {
  return RANK[severity] ?? 0;
}

export function meetsSeverity(severity: AuditSeverity, min: AuditSeverity): boolean {
  if (min === 'critical') return severity === 'critical';
  return severityRank(severity) >= severityRank(min);
}

function countFindings(findings: AuditFinding[]): SeverityCounts {
  const counts = emptyCounts();
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstLine(text: string, max = 200): string {
  const line = text.replace(/^[#\s]+/, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const clean = line.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const NETWORK_RE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|socket hang up|getaddrinfo|network|request to .* failed|ConnectionError|Max retries exceeded|Failed to establish a new connection/i;

function parseJson(text: string): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Предупреждения npm иногда попадают в stdout перед JSON — берём с первой фигурной скобки.
    const start = trimmed.indexOf('{');
    if (start > 0) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function failed(status: AuditRunStatus, message: string, errorKind?: AuditErrorKind): EcosystemAuditParse {
  return { status, findings: [], counts: emptyCounts(), message, ...(errorKind ? { errorKind } : {}) };
}

/** Идентификатор advisory npm: GHSA из ссылки, иначе номер `source`. */
function npmAdvisoryId(via: Record<string, unknown>): string {
  const url = str(via.url);
  const ghsa = url?.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i)?.[0];
  if (ghsa) return `GHSA${ghsa.slice(4).toLowerCase()}`;
  return via.source !== undefined ? `npm-${String(via.source)}` : str(via.title) ?? 'npm-advisory';
}

/** `npm audit --json` (npm 7+, отчёт v2). `stderr` нужен только для текста ошибки. */
export function parseNpmAudit(stdout: string, stderr = ''): EcosystemAuditParse {
  const data = parseJson(stdout) as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    const text = `${stdout}\n${stderr}`;
    if (/ENOLOCK/.test(text)) return failed('no_lockfile', 'Нет package-lock.json — создайте его: npm i --package-lock-only');
    if (NETWORK_RE.test(text)) return failed('error', firstLine(stderr || stdout) || 'registry недоступен', 'network');
    return failed('error', firstLine(stderr || stdout) || 'npm audit не вернул JSON', 'format');
  }

  const error = data.error as Record<string, unknown> | undefined;
  if (error && typeof error === 'object' && !data.vulnerabilities) {
    const code = str(error.code);
    if (code === 'ENOLOCK') return failed('no_lockfile', 'Нет package-lock.json — создайте его: npm i --package-lock-only');
    const text = [str(data.message), str(error.summary), str(error.detail), stderr].filter(Boolean).join(' ');
    const kind: AuditErrorKind = NETWORK_RE.test(text) ? 'network' : 'tool';
    return failed('error', firstLine(str(data.message) ?? str(error.summary) ?? stderr ?? '') || 'npm audit завершился ошибкой', kind);
  }

  if (data.auditReportVersion !== 2 || typeof data.vulnerabilities !== 'object' || data.vulnerabilities === null) {
    return failed('error', 'Неизвестный формат npm audit (нужен npm 7+, отчёт v2)', 'format');
  }

  const findings: AuditFinding[] = [];
  for (const [name, raw] of Object.entries(data.vulnerabilities as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const advisories: AuditAdvisory[] = [];
    const via: string[] = [];
    for (const item of Array.isArray(v.via) ? v.via : []) {
      if (typeof item === 'string') {
        if (!via.includes(item)) via.push(item);
      } else if (item && typeof item === 'object') {
        const a = item as Record<string, unknown>;
        const id = npmAdvisoryId(a);
        if (advisories.some((x) => x.id === id)) continue;
        advisories.push({
          id,
          title: str(a.title) ?? id,
          ...(str(a.url) ? { url: str(a.url) } : {}),
          severity: normalizeSeverity(a.severity),
          ...(str(a.range) ? { range: str(a.range) } : {})
        });
      }
    }
    const fixRaw = v.fixAvailable;
    const fix =
      fixRaw && typeof fixRaw === 'object'
        ? {
            available: true,
            ...(str((fixRaw as Record<string, unknown>).name) ? { name: str((fixRaw as Record<string, unknown>).name) } : {}),
            ...(str((fixRaw as Record<string, unknown>).version) ? { version: str((fixRaw as Record<string, unknown>).version) } : {}),
            major: (fixRaw as Record<string, unknown>).isSemVerMajor === true
          }
        : { available: fixRaw === true };
    findings.push({
      ecosystem: 'npm',
      package: str(v.name) ?? name,
      severity: normalizeSeverity(v.severity),
      direct: v.isDirect === true,
      advisories,
      ...(via.length ? { via } : {}),
      ...(str(v.range) ? { range: str(v.range) } : {}),
      fix
    });
  }
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.package.localeCompare(b.package));

  const deps = (data.metadata as Record<string, unknown> | undefined)?.dependencies as Record<string, unknown> | undefined;
  const total = typeof deps?.total === 'number' ? deps.total : undefined;
  return { status: 'done', findings, counts: countFindings(findings), ...(total !== undefined ? { dependencyCount: total } : {}) };
}

function pipAdvisoryUrl(id: string, aliases: string[]): string {
  const ghsa = [id, ...aliases].find((x) => /^GHSA-/i.test(x));
  return ghsa ? `https://github.com/advisories/${ghsa}` : `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

/** `pip-audit -r <файл> --no-deps --disable-pip -f json`. */
export function parsePipAudit(stdout: string, stderr = ''): EcosystemAuditParse {
  const data = parseJson(stdout) as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    const unpinned = stderr.match(/requirement (\S+) is not pinned to an exact version/i);
    if (unpinned) {
      return failed('unsupported', `Требования не закреплены (${unpinned[1]}): pip-audit без установки пакетов работает только с ==`);
    }
    if (NETWORK_RE.test(stderr)) return failed('error', firstLine(stderr.split(/\r?\n/).reverse().find((l) => NETWORK_RE.test(l)) ?? stderr), 'network');
    const lastError = stderr.split(/\r?\n/).reverse().find((l) => /ERROR/.test(l));
    return failed('error', firstLine(lastError ?? stderr) || 'pip-audit не вернул JSON', 'format');
  }
  if (!Array.isArray(data.dependencies)) return failed('error', 'Неизвестный формат pip-audit', 'format');

  const findings: AuditFinding[] = [];
  let checked = 0;
  for (const raw of data.dependencies) {
    if (!raw || typeof raw !== 'object') continue;
    const dep = raw as Record<string, unknown>;
    if (dep.skip_reason) continue;
    checked++;
    const vulns = Array.isArray(dep.vulns) ? dep.vulns : [];
    const advisories: AuditAdvisory[] = [];
    for (const item of vulns) {
      if (!item || typeof item !== 'object') continue;
      const v = item as Record<string, unknown>;
      const id = str(v.id);
      if (!id || advisories.some((a) => a.id === id)) continue;
      const aliases = Array.isArray(v.aliases) ? v.aliases.filter((a): a is string => typeof a === 'string') : [];
      const fixVersions = Array.isArray(v.fix_versions) ? v.fix_versions.filter((a): a is string => typeof a === 'string') : [];
      advisories.push({
        id,
        title: firstLine(str(v.description) ?? id),
        url: pipAdvisoryUrl(id, aliases),
        severity: 'unknown',
        ...(fixVersions.length ? { fixVersions } : {}),
        ...(aliases.length ? { aliases } : {})
      });
    }
    if (advisories.length === 0) continue;
    const fixes = [...new Set(advisories.flatMap((a) => a.fixVersions ?? []))];
    findings.push({
      ecosystem: 'pip',
      package: str(dep.name) ?? 'unknown',
      ...(str(dep.version) ? { version: str(dep.version) } : {}),
      severity: 'unknown',
      direct: true,
      advisories,
      fix: fixes.length ? { available: true, version: fixes[fixes.length - 1] } : { available: false }
    });
  }
  findings.sort((a, b) => a.package.localeCompare(b.package));
  return { status: 'done', findings, counts: countFindings(findings), dependencyCount: checked };
}

/** Что аудировать в корне проекта: по списку имён файлов корня (decision-56 п. 2). */
export interface AuditTarget {
  ecosystem: AuditEcosystem;
  /** Файл, по которому идёт аудит (lock или requirements). */
  manifest?: string;
  /** Запускать инструмент или сразу вернуть статус. */
  run: boolean;
  status?: AuditRunStatus;
  message?: string;
}

export function detectAuditTargets(rootFiles: string[]): AuditTarget[] {
  const has = (name: string) => rootFiles.some((f) => f.toLowerCase() === name.toLowerCase());
  const targets: AuditTarget[] = [];
  const npmLock = ['package-lock.json', 'npm-shrinkwrap.json'].find(has);
  if (npmLock) {
    targets.push({ ecosystem: 'npm', manifest: npmLock, run: true });
  } else if (has('pnpm-lock.yaml')) {
    targets.push({ ecosystem: 'pnpm', manifest: 'pnpm-lock.yaml', run: false, status: 'unsupported', message: 'Аудит pnpm пока не поддерживается' });
  } else if (has('yarn.lock')) {
    targets.push({ ecosystem: 'yarn', manifest: 'yarn.lock', run: false, status: 'unsupported', message: 'Аудит yarn пока не поддерживается' });
  } else if (has('package.json')) {
    targets.push({ ecosystem: 'npm', manifest: 'package.json', run: false, status: 'no_lockfile', message: 'Нет package-lock.json — создайте его: npm i --package-lock-only' });
  }
  const requirements = rootFiles.filter((f) => /^requirements[\w.-]*\.txt$/i.test(f)).sort();
  for (const req of requirements) targets.push({ ecosystem: 'pip', manifest: req, run: true });
  if (has('Cargo.lock')) {
    targets.push({ ecosystem: 'cargo', manifest: 'Cargo.lock', run: false, status: 'unsupported', message: 'Формат cargo audit пока не поддержан' });
  }
  return targets;
}

/** Ключи advisory находки: по ним считаются «новые» относительно прошлого отчёта. */
export function findingKeys(finding: AuditFinding): string[] {
  const base = `${finding.ecosystem}:${finding.package}`;
  if (finding.advisories.length === 0) return [`${base}:${(finding.via ?? []).join('+') || '*'}`];
  return finding.advisories.map((a) => `${base}:${a.id}`);
}

/** Находки `next`, которых не было в `previous` (хотя бы одно новое advisory). */
export function newFindings(previous: AuditFinding[] | undefined, next: AuditFinding[]): AuditFinding[] {
  const known = new Set((previous ?? []).flatMap(findingKeys));
  return next.filter((f) => findingKeys(f).some((k) => !known.has(k)));
}

/** «critical 1, high 2» — только ненулевые уровни, от серьёзных к лёгким. */
export function summarizeCounts(counts: SeverityCounts): string {
  const parts = AUDIT_SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${s} ${counts[s]}`);
  return parts.length ? parts.join(', ') : 'уязвимостей нет';
}

export function mergeCounts(list: SeverityCounts[]): SeverityCounts {
  const out = emptyCounts();
  for (const c of list) for (const s of AUDIT_SEVERITIES) out[s] += c[s] ?? 0;
  return out;
}

/** Задача Backlog из находки: заголовок до ~100 символов (лимит пути Windows) и описание с advisories. */
export function buildFindingTask(finding: AuditFinding, projectName?: string): { title: string; description: string; labels: string[] } {
  const top = finding.advisories[0];
  const titleCore = top ? top.title : finding.via?.length ? `через ${finding.via.join(', ')}` : 'уязвимость';
  let title = `Уязвимость ${finding.package}: ${titleCore}`;
  if (title.length > 100) title = `${title.slice(0, 99)}…`;
  const lines: string[] = [
    `Находка аудита зависимостей ProjectHub (${finding.ecosystem}${projectName ? `, проект ${projectName}` : ''}).`,
    '',
    `- Пакет: \`${finding.package}\`${finding.version ? ` ${finding.version}` : ''}${finding.direct === false ? ' (транзитивная зависимость)' : ''}`,
    `- Уровень: ${finding.severity}`
  ];
  if (finding.range) lines.push(`- Уязвимые версии: \`${finding.range}\``);
  if (finding.via?.length) lines.push(`- Приходит через: ${finding.via.map((v) => `\`${v}\``).join(', ')}`);
  if (finding.fix?.available) {
    lines.push(
      `- Исправление: ${finding.fix.name && finding.fix.name !== finding.package ? `\`${finding.fix.name}\` ` : ''}${finding.fix.version ?? 'доступно'}${finding.fix.major ? ' (мажорное обновление)' : ''}`
    );
  } else {
    lines.push('- Исправления пока нет');
  }
  if (finding.advisories.length) {
    lines.push('', '## Advisories', '');
    for (const a of finding.advisories) {
      lines.push(`- ${a.url ? `[${a.id}](${a.url})` : a.id} — ${a.title} (${a.severity}${a.range ? `, ${a.range}` : ''})`);
    }
  }
  return { title, description: lines.join('\n'), labels: ['security'] };
}
