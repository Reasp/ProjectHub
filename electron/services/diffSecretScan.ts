/**
 * Скан унифицированного диффа на секреты (decision-56 п. 3, TASK-73).
 *
 * Детектор один — `detectSecrets` из `secretPatterns` (тот же, что защищает память проекта); здесь только разбор
 * патча: какие строки добавлены, в каком файле и на какой строке. Удалённые и контекстные строки не сканируются —
 * удаление секрета не утечка. Значение секрета наружу не отдаётся: находка — вид, файл и номер строки.
 *
 * Чистый модуль: без Electron, git и файловой системы.
 */
import { detectSecrets, maskDetectedSecrets, type SecretKind } from './secretPatterns.js';

/** Маркер на строке, который снимает находку, если изменение сделал человек (в диффах агентов не действует). */
export const ALLOW_SECRET_MARKER = 'projecthub:allow-secret';

/** Сколько добавленного текста сканируется, прежде чем результат помечается усечённым. */
export const DIFF_SCAN_MAX_ADDED_BYTES = 2 * 1024 * 1024;
/** Из строки длиннее этого (минифицированный бандл) сканируется только начало. */
export const DIFF_SCAN_MAX_LINE_CHARS = 4000;
/** Больше находок не копим: для решения «сливать или нет» хватает первых. */
export const DIFF_SCAN_MAX_FINDINGS = 200;

export type DiffSecretKind = SecretKind | 'env_file';

export interface DiffSecretFinding {
  kind: DiffSecretKind;
  file: string;
  /** Номер строки в новой версии файла; у `env_file` отсутствует. */
  line?: number;
}

export interface DiffSecretScanOptions {
  /** Glob-шаблоны путей, где находки не считаются (`security.secretScan.allowPaths` основного дерева). */
  allowPaths?: string[];
  /** Учитывать маркер `projecthub:allow-secret` — только для изменений человека. */
  honorInlineMarker?: boolean;
  maxAddedBytes?: number;
  maxLineChars?: number;
}

export interface DiffSecretScanResult {
  findings: DiffSecretFinding[];
  /** Находки, снятые `allowPaths` или маркером, — показываются числом. */
  suppressed: number;
  filesScanned: number;
  /** Скан остановлен по лимиту объёма или числа находок. */
  truncated: boolean;
}

/** `.env`, `.env.local`, `.env.production` — но не шаблоны вроде `.env.example`. */
const ENV_FILE_RE = /^\.env(?:\.[^/]+)?$/i;
const ENV_TEMPLATE_RE = /^\.env\.(?:example|sample|template|dist)$/i;

export function isEnvFile(file: string): boolean {
  const base = file.split('/').pop() ?? '';
  return ENV_FILE_RE.test(base) && !ENV_TEMPLATE_RE.test(base);
}

/**
 * Путь из заголовка git. Имена с пробелами, кавычками и не-ASCII git берёт в кавычки и экранирует в стиле C
 * (`"\320\277…"` при `core.quotePath=true` по умолчанию) — такие байты собираются обратно в UTF-8.
 */
export function unquoteGitPath(raw: string): string {
  const value = raw.trim();
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
      continue;
    }
    const next = body[i + 1];
    if (next !== undefined && /[0-7]/.test(next)) {
      const oct = body.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
      bytes.push(parseInt(oct, 8) & 0xff);
      i += oct.length;
    } else if (next !== undefined && next in simple) {
      bytes.push(simple[next]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Путь после префикса `a/`/`b/` из строк `---`/`+++`; `null` для `/dev/null`. */
function pathFromMarker(rest: string): string | null {
  const raw = unquoteGitPath(rest.replace(/\t.*$/, ''));
  if (raw === '/dev/null') return null;
  return raw.replace(/^[ab]\//, '');
}

/** Путь нового файла из `diff --git a/x b/y` — запасной вариант, если строк `+++` нет (бинарный файл). */
function pathFromDiffHeader(line: string): string {
  const rest = line.slice('diff --git '.length);
  const quoted = rest.match(/"b\/(?:[^"\\]|\\.)*"$/);
  if (quoted) return unquoteGitPath(quoted[0]).replace(/^b\//, '');
  const idx = rest.lastIndexOf(' b/');
  return idx >= 0 ? rest.slice(idx + 3) : rest;
}

/** Glob → RegExp: `**` — любая глубина, `*` — внутри сегмента, `?` — один символ. Регистр не важен. */
export function globToRegExp(glob: string): RegExp {
  const g = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        const slash = g[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // Шаблон без слэша (`*.pem`, `.env.test`) сопоставляется с именем файла на любой глубине.
  const anchored = g.includes('/') ? `^${re}$` : `^(?:.*/)?${re}$`;
  return new RegExp(anchored, 'i');
}

export function matchesAnyGlob(file: string, globs: string[] | undefined): boolean {
  if (!globs?.length) return false;
  const normalized = file.replace(/\\/g, '/');
  return globs.some((g) => typeof g === 'string' && g.trim() && globToRegExp(g).test(normalized));
}

export function scanDiffForSecrets(patch: string, options: DiffSecretScanOptions = {}): DiffSecretScanResult {
  const maxBytes = options.maxAddedBytes ?? DIFF_SCAN_MAX_ADDED_BYTES;
  const maxLine = options.maxLineChars ?? DIFF_SCAN_MAX_LINE_CHARS;
  const findings: DiffSecretFinding[] = [];
  const seen = new Set<string>();
  let suppressed = 0;
  let truncated = false;
  let scannedBytes = 0;
  const files = new Set<string>();

  let file: string | null = null;
  let isNew = false;
  let inHunk = false;
  let newLine = 0;
  let skipFile = false;

  const allowed = (f: string, text?: string) =>
    matchesAnyGlob(f, options.allowPaths) || (options.honorInlineMarker === true && text !== undefined && text.includes(ALLOW_SECRET_MARKER));

  const add = (finding: DiffSecretFinding, text?: string) => {
    if (allowed(finding.file, text)) {
      suppressed++;
      return;
    }
    const key = `${finding.kind}\u0000${finding.file}\u0000${finding.line ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (findings.length >= DIFF_SCAN_MAX_FINDINGS) {
      truncated = true;
      return;
    }
    findings.push(finding);
  };

  /** Файл целиком известен (после `+++` или заголовка бинарного) — проверка `.env`. */
  const fileKnown = (f: string) => {
    files.add(f);
    if (isNew && isEnvFile(f)) add({ kind: 'env_file', file: f });
  };

  for (const rawLine of (patch ?? '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('diff --git ')) {
      file = pathFromDiffHeader(line);
      isNew = false;
      inHunk = false;
      skipFile = false;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith('new file mode')) isNew = true;
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        skipFile = true;
        if (file) fileKnown(file);
      } else if (line.startsWith('+++ ')) {
        const target = pathFromMarker(line.slice(4));
        if (target === null) skipFile = true;
        else {
          file = target;
          fileKnown(file);
        }
      } else if (line.startsWith('--- ') && line.slice(4).trim() === '/dev/null') {
        isNew = true;
      }
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      newLine = Number(hunk[1]);
      continue;
    }
    if (!inHunk || skipFile || !file) continue;

    if (line.startsWith('+')) {
      const text = line.slice(1);
      const lineNo = newLine++;
      scannedBytes += text.length + 1;
      if (scannedBytes > maxBytes) {
        truncated = true;
        break;
      }
      for (const hit of detectSecrets(text.length > maxLine ? text.slice(0, maxLine) : text)) {
        add({ kind: hit.kind, file, line: lineNo }, text);
      }
    } else if (line.startsWith(' ')) {
      newLine++;
    } else if (line.startsWith('-') || line.startsWith('\\')) {
      // удалённая строка или «\ No newline at end of file» — номер новой строки не двигается
    } else if (line === '') {
      // пустая строка контекста без ведущего пробела (патч, прошедший через редактор) — считаем контекстом
      newLine++;
    } else {
      inHunk = false;
    }
  }

  return { findings, suppressed, filesScanned: files.size, truncated };
}

/**
 * Патч с замаскированными значениями секретов в добавленных строках и вычищенным телом PEM — для текста,
 * который уходит наружу (промпт LLM-ревьюера). Структура патча и номера строк не меняются.
 */
export function maskSecretsInPatch(patch: string): string {
  let inPem = false;
  return (patch ?? '')
    .split('\n')
    .map((line) => {
      if (!line.startsWith('+') || line.startsWith('+++ ')) {
        inPem = false;
        return line;
      }
      if (inPem) {
        if (/-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)) inPem = false;
        else return '+***';
        return line;
      }
      if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line)) inPem = !/-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(line);
      return `+${maskDetectedSecrets(line.slice(1))}`;
    })
    .join('\n');
}

/** Сводка для заголовков, аудита и уведомлений: «provider_key ×2 (src/a.ts), env_file (.env)» — без значений. */
export function summarizeSecretFindings(findings: DiffSecretFinding[], maxFiles = 3): string {
  const byKind = new Map<DiffSecretKind, Set<string>>();
  for (const f of findings) {
    const set = byKind.get(f.kind) ?? new Set<string>();
    set.add(f.line ? `${f.file}:${f.line}` : f.file);
    byKind.set(f.kind, set);
  }
  return [...byKind.entries()]
    .map(([kind, where]) => {
      const list = [...where];
      const shown = list.slice(0, maxFiles).join(', ') + (list.length > maxFiles ? ` +${list.length - maxFiles}` : '');
      return `${kind}${list.length > 1 ? ` ×${list.length}` : ''} (${shown})`;
    })
    .join('; ');
}
