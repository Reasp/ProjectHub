/**
 * Каталог скиллов проекта (TASK-105, decision-61).
 *
 * Скилл — каталог `<корень>/<id>/` с файлом `SKILL.md` (frontmatter `name`, `description`) и вспомогательными
 * файлами. Корни: `.claude/skills` (Claude Code) и `.agents/skills` (Google Antigravity). Один и тот же скилл
 * обычно лежит в обоих корнях копиями, и копии расходятся, когда правят только одну.
 *
 * Чистый модуль без fs и Electron: хэши содержимого, разбор `SKILL.md`, сравнение копий по файлам, статусы,
 * решение «создать / перезаписать / без изменений» при копировании. Построчный дифф `SKILL.md` для UI — в
 * `src/lib/lineDiff.ts` (рендереру не нужны crypto и gray-matter).
 */
import crypto from 'node:crypto';
import matter from 'gray-matter';

export const SKILL_ROOTS = { claude: '.claude/skills', agents: '.agents/skills' } as const;
export type SkillRoot = keyof typeof SKILL_ROOTS;
export const SKILL_ROOT_KEYS: SkillRoot[] = ['claude', 'agents'];
export const SKILL_FILE = 'SKILL.md';

/** Служебные каталоги и файлы, которые не входят в скилл: не сравниваются и не копируются. */
export const SKILL_IGNORED_NAMES = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', 'Thumbs.db']);
/** Префикс временных каталогов копирования; такие каталоги в список скиллов не попадают. */
export const SKILL_TEMP_PREFIX = '.projecthub-';

export const SKILL_LIMITS = {
  /** Больше файлов в одном скилле — скилл не хэшируется и не копируется. */
  maxFiles: 500,
  maxBytes: 20 * 1024 * 1024,
  /** Сколько байт `SKILL.md` отдаётся в предпросмотр. */
  maxPreviewBytes: 256 * 1024
};

export type SkillProblem =
  | 'noSkillMd'
  | 'badFrontmatter'
  | 'noName'
  | 'noDescription'
  | 'nameMismatch'
  | 'nested'
  | 'tooLarge'
  | 'symlinks';

export interface SkillFileEntry {
  /** Путь внутри каталога скилла, через `/`. */
  relPath: string;
  size: number;
  hash: string;
}

/** Одна копия скилла в одном корне. */
export interface SkillCopy {
  root: SkillRoot;
  id: string;
  files: SkillFileEntry[];
  /** Хэш всего скилла; пустая строка, если скилл слишком большой и не хэшировался. */
  hash: string;
  totalBytes: number;
  name?: string;
  description?: string;
  problems: SkillProblem[];
  /** Содержимое `SKILL.md` для предпросмотра (обрезано до `maxPreviewBytes`), null — файла нет. */
  skillMd: string | null;
}

export type SkillStatus = 'synced' | 'diverged' | 'claudeOnly' | 'agentsOnly';
export type SkillFileState = 'same' | 'changed' | 'onlyClaude' | 'onlyAgents';

export interface SkillFileDiff {
  relPath: string;
  state: SkillFileState;
}

export interface SkillEntry {
  id: string;
  name?: string;
  description?: string;
  status: SkillStatus;
  copies: Partial<Record<SkillRoot, SkillCopy>>;
  /** Пофайловое сравнение копий — только если скилл есть в обоих корнях. */
  fileDiff?: SkillFileDiff[];
}

export interface SkillCatalogSummary {
  total: number;
  synced: number;
  diverged: number;
  claudeOnly: number;
  agentsOnly: number;
  /** Скиллы с проблемами формата (нет `SKILL.md`, нет `name`/`description` и т.п.). */
  withProblems: number;
}

export type SkillCopyAction = 'create' | 'overwrite' | 'unchanged';

const ID_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Проверка id скилла, пришедшего из рендерера: один или два сегмента (`name` или `group/name`), без `..`,
 * разделителей Windows, скрытых и служебных каталогов. Возвращает null для допустимого id, иначе причину.
 */
export function validateSkillId(id: unknown): string | null {
  if (typeof id !== 'string' || !id) return 'id скилла не задан';
  const segments = id.split('/');
  if (segments.length > 2) return 'id скилла глубже двух уровней';
  for (const s of segments) {
    if (!ID_SEGMENT_RE.test(s) || s.endsWith('.')) return `недопустимое имя каталога скилла: "${s}"`;
    if (SKILL_IGNORED_NAMES.has(s)) return `служебный каталог: "${s}"`;
  }
  return null;
}

export function isSkillRoot(value: unknown): value is SkillRoot {
  return value === 'claude' || value === 'agents';
}

function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Хэш одного файла. Текст сравнивается без учёта окончаний строк: CRLF и LF — одно и то же содержимое
 * (git с autocrlf и редакторы на Windows меняют окончания, не меняя скилл). Бинарные файлы — побайтно.
 */
export function hashSkillFileContent(buf: Uint8Array): string {
  const h = crypto.createHash('sha256');
  if (looksBinary(buf)) {
    h.update(buf);
    return h.digest('hex');
  }
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[j++] = buf[i];
  }
  h.update(out.subarray(0, j));
  return h.digest('hex');
}

/** Хэш скилла целиком: пути и хэши файлов в стабильном порядке. */
export function hashSkillFiles(files: SkillFileEntry[]): string {
  const h = crypto.createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))) {
    h.update(`${f.relPath}\0${f.hash}\n`);
  }
  return h.digest('hex');
}

function fmString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value === 'object') return undefined;
  return String(value).trim() || undefined;
}

/**
 * Разбор `SKILL.md`: `name` и `description` из frontmatter и проблемы формата. `dirName` — имя каталога
 * скилла (последний сегмент id): Claude Code ищет скилл по каталогу, и `name`, не совпадающий с ним, путает.
 */
export function parseSkillMd(text: string | null, dirName: string): { name?: string; description?: string; problems: SkillProblem[] } {
  if (text === null) return { problems: ['noSkillMd'] };
  let data: Record<string, unknown>;
  try {
    data = matter(text).data as Record<string, unknown>;
  } catch {
    return { problems: ['badFrontmatter'] };
  }
  const name = fmString(data.name);
  const description = fmString(data.description);
  const problems: SkillProblem[] = [];
  if (!name) problems.push('noName');
  else if (name !== dirName) problems.push('nameMismatch');
  if (!description) problems.push('noDescription');
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), problems };
}

/** Пофайловое сравнение двух копий скилла. */
export function diffSkillFiles(claude: SkillFileEntry[], agents: SkillFileEntry[]): SkillFileDiff[] {
  const a = new Map(claude.map((f) => [f.relPath, f.hash]));
  const b = new Map(agents.map((f) => [f.relPath, f.hash]));
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths.map((relPath) => {
    const ha = a.get(relPath);
    const hb = b.get(relPath);
    const state: SkillFileState = ha === undefined ? 'onlyAgents' : hb === undefined ? 'onlyClaude' : ha === hb ? 'same' : 'changed';
    return { relPath, state };
  });
}

/** Одинаковы ли две копии. Нехэшированные (слишком большие) копии одинаковыми не считаются. */
export function sameSkillContent(a: Pick<SkillCopy, 'hash'>, b: Pick<SkillCopy, 'hash'>): boolean {
  return Boolean(a.hash) && a.hash === b.hash;
}

/** Каталог скиллов проекта из копий обоих корней: по записи на id, отсортировано по id. */
export function buildSkillCatalog(copies: SkillCopy[]): SkillEntry[] {
  const byId = new Map<string, Partial<Record<SkillRoot, SkillCopy>>>();
  for (const c of copies) {
    const entry = byId.get(c.id) ?? {};
    entry[c.root] = c;
    byId.set(c.id, entry);
  }
  return [...byId.keys()].sort().map((id) => {
    const pair = byId.get(id)!;
    const { claude, agents } = pair;
    const primary = claude ?? agents!;
    const status: SkillStatus = claude && agents ? (sameSkillContent(claude, agents) ? 'synced' : 'diverged') : claude ? 'claudeOnly' : 'agentsOnly';
    return {
      id,
      ...(primary.name ? { name: primary.name } : {}),
      ...(primary.description ? { description: primary.description } : {}),
      status,
      copies: pair,
      ...(claude && agents ? { fileDiff: diffSkillFiles(claude.files, agents.files) } : {})
    };
  });
}

export function summarizeSkillCatalog(entries: SkillEntry[]): SkillCatalogSummary {
  const count = (s: SkillStatus) => entries.filter((e) => e.status === s).length;
  return {
    total: entries.length,
    synced: count('synced'),
    diverged: count('diverged'),
    claudeOnly: count('claudeOnly'),
    agentsOnly: count('agentsOnly'),
    withProblems: entries.filter((e) => Object.values(e.copies).some((c) => c && c.problems.length > 0)).length
  };
}

/**
 * Что сделает копирование скилла `source` на место `target`: создать, перезаписать (только по явному выбору
 * человека — это решает сервис) или ничего, если содержимое уже совпадает.
 */
export function skillCopyAction(source: Pick<SkillCopy, 'hash'>, target: Pick<SkillCopy, 'hash'> | undefined): SkillCopyAction {
  if (!target) return 'create';
  return sameSkillContent(source, target) ? 'unchanged' : 'overwrite';
}

/** Почему копию нельзя использовать как источник копирования; null — можно. */
export function skillCopyBlocker(copy: Pick<SkillCopy, 'problems' | 'hash'>): string | null {
  if (copy.problems.includes('tooLarge')) {
    return `скилл больше ${SKILL_LIMITS.maxFiles} файлов или ${SKILL_LIMITS.maxBytes / 1024 / 1024} МБ`;
  }
  if (copy.problems.includes('symlinks')) return 'в скилле есть символические ссылки';
  if (copy.problems.includes('noSkillMd')) return 'в каталоге нет SKILL.md';
  if (!copy.hash) return 'содержимое скилла не прочитано';
  return null;
}
