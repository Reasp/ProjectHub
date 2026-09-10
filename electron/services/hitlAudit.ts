import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { HitlAuditEntry, HitlAuditQuery } from './hitlTypes.js';

/**
 * Аудит-лог решений HITL (TASK-57, decision-10 п. 4).
 *
 * Файлы `<dir>/hitl-<yyyy-mm>.jsonl`, по строке на событие (`decision`, `outcome`, `fallback`);
 * ротация — по месяцам. В лог не попадают секреты и содержимое файлов: команда хранится как
 * SHA-256 плюс короткое превью с вырезанными токенами (`redactSecrets`), дифф и содержимое
 * файлов не пишутся вовсе.
 *
 * Модуль чистый (fs/path/crypto), покрыт unit-тестами на временном каталоге.
 */

export const AUDIT_FILE_PREFIX = 'hitl-';
export const AUDIT_FILE_RE = /^hitl-(\d{4}-\d{2})\.jsonl$/;
export const COMMAND_PREVIEW_MAX = 160;
export const COMMENT_MAX = 200;
export const DEFAULT_QUERY_LIMIT = 500;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization: Bearer <token>, --header "Authorization: ..."
  [/(bearer\s+)[A-Za-z0-9\-_.=+/]+/gi, '$1***'],
  // key=value / key: value для типичных имён секретов
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|authorization|client[_-]?secret)\s*[=:]\s*["']?)[^\s"'&;]+/gi, '$1***'],
  // Известные префиксы ключей
  [/\b(sk-(?:ant-)?[A-Za-z0-9\-_]{8,})/g, 'sk-***'],
  [/\b(gh[pousr]_[A-Za-z0-9]{10,})/g, 'gh*_***'],
  [/\b(xox[abpr]-[A-Za-z0-9-]{10,})/g, 'xox*-***'],
  [/\b(AKIA[0-9A-Z]{12,})/g, 'AKIA***'],
  // Пароли в URL: https://user:pass@host
  [/((?:https?|ftp|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:)[^\s/@]+@/gi, '$1***@'],
  // Переменные окружения вида FOO_TOKEN=... в начале команды
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\s*=\s*)[^\s]+/g, '$1***']
];

/** Вырезает похожие на секреты фрагменты из произвольного текста команды. */
export function redactSecrets(text: string): string {
  if (!text) return '';
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

export function hashCommand(command: string): string {
  return createHash('sha256').update(command ?? '', 'utf-8').digest('hex');
}

/** Первые символы команды без переводов строк и с вырезанными секретами. */
export function commandPreview(command: string, max = COMMAND_PREVIEW_MAX): string {
  const oneLine = (command ?? '').replace(/\s+/g, ' ').trim();
  const redacted = redactSecrets(oneLine);
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}

export function truncateComment(text: string | undefined, max = COMMENT_MAX): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** `YYYY-MM` для даты в локальном времени. */
export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function auditFileName(month: string): string {
  return `${AUDIT_FILE_PREFIX}${month}.jsonl`;
}

function matchesQuery(entry: HitlAuditEntry, q: HitlAuditQuery): boolean {
  if (q.sessionId && entry.sessionId !== q.sessionId) return false;
  if (q.projectPath && entry.projectPath !== q.projectPath) return false;
  if (q.decidedBy && entry.decidedBy !== q.decidedBy) return false;
  if (q.decision && entry.decision !== q.decision) return false;
  if (q.kind && entry.kind !== q.kind) return false;
  if (q.origin && entry.origin !== q.origin) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    const hay = [entry.title, entry.tool, entry.filePath, entry.commandPreview, entry.agentName, entry.role, entry.detail, entry.rule]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function toCsv(entries: HitlAuditEntry[]): string {
  const columns: Array<keyof HitlAuditEntry> = [
    'ts', 'kind', 'requestId', 'sessionId', 'projectPath', 'hostId', 'origin', 'engine', 'agentId', 'agentName', 'role',
    'tool', 'type', 'title', 'filePath', 'commandHash', 'commandPreview', 'decision', 'decidedBy', 'deviceId', 'deviceName',
    'rule', 'comment', 'waitedMs', 'outcome', 'detail'
  ];
  const escape = (v: unknown) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const e of entries) lines.push(columns.map((c) => escape(e[c])).join(','));
  return lines.join('\n');
}

export class HitlAuditLog {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {}

  public get directory(): string {
    return this.dir;
  }

  /** Добавляет строку в файл текущего месяца. Ошибки записи логируются, но не бросаются. */
  public append(entry: HitlAuditEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const file = path.join(this.dir, auditFileName(monthKey(this.now())));
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true });
        await fs.appendFile(file, line, 'utf-8');
      })
      .catch((err) => {
        console.error('[HitlAudit] append failed:', err);
      });
    return this.writeChain;
  }

  /** Дожидается завершения всех запланированных записей (для тестов и завершения приложения). */
  public flush(): Promise<void> {
    return this.writeChain;
  }

  /** Доступные месяцы, новые первыми. */
  public async listMonths(): Promise<string[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    return names
      .map((n) => AUDIT_FILE_RE.exec(n)?.[1])
      .filter((m): m is string => Boolean(m))
      .sort()
      .reverse();
  }

  public async readMonth(month: string): Promise<HitlAuditEntry[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) return [];
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.dir, auditFileName(month)), 'utf-8');
    } catch {
      return [];
    }
    const out: HitlAuditEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && typeof parsed.requestId === 'string') out.push(parsed as HitlAuditEntry);
      } catch {
        /* повреждённая строка — пропускаем */
      }
    }
    return out;
  }

  /** Выборка с фильтрами; результат — новые записи первыми, не больше `limit`. */
  public async query(q: HitlAuditQuery = {}): Promise<HitlAuditEntry[]> {
    const months = q.month ? [q.month] : await this.listMonths();
    const limit = Math.max(1, Math.min(q.limit ?? DEFAULT_QUERY_LIMIT, 10_000));
    const result: HitlAuditEntry[] = [];
    for (const month of months) {
      const entries = await this.readMonth(month);
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (matchesQuery(e, q)) {
          result.push(e);
          if (result.length >= limit) return result;
        }
      }
    }
    return result;
  }

  public async export(q: HitlAuditQuery, format: 'jsonl' | 'json' | 'csv'): Promise<string> {
    const entries = await this.query({ ...q, limit: q.limit ?? 10_000 });
    if (format === 'csv') return toCsv(entries);
    if (format === 'json') return JSON.stringify(entries, null, 2);
    return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
  }
}
