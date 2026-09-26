/**
 * Формат памяти проекта (TASK-76, decision-51 п. 1–2).
 *
 * Один факт — один файл `backlog/memory/mem-<N> - <Title-Slug>.md` с frontmatter; индекс
 * `backlog/memory/MEMORY.md` — по строке на факт, генерируется из файлов и руками не правится.
 * Все значения frontmatter записываются строками в кавычках (правило 16): незакавыченная дата
 * превращается в YAML в `Date` и роняет рендерер.
 *
 * Чистый модуль: разбор, проверка, сериализация, имена файлов и индекс — без fs и Electron.
 */
import matter from 'gray-matter';
import { sanitizeTaskFileTitle } from './backlogTaskFormat.js';

/** Каталог памяти относительно корня проекта. */
export const MEMORY_DIR_SEGMENTS = ['backlog', 'memory'] as const;
export const MEMORY_DIR = MEMORY_DIR_SEGMENTS.join('/');
export const MEMORY_INDEX_FILE = 'MEMORY.md';

export const MEMORY_TYPES = ['project', 'feedback', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_LIMITS = {
  title: 100,
  description: 200,
  body: 2000,
  slug: 60,
  source: 80,
  author: 80
} as const;

/** Проблемы формата факта — коды, строки интерфейса живут в i18n рендерера. */
export const MEMORY_FORMAT_ERROR_CODES = [
  'invalid_frontmatter',
  'invalid_file_name',
  'invalid_id',
  'id_mismatch',
  'not_a_string',
  'invalid_type',
  'missing_title',
  'missing_description',
  'empty_body',
  'title_too_long',
  'description_too_long',
  'body_too_long',
  'source_too_long',
  'author_too_long',
  'multiline_field'
] as const;

export type MemoryFormatErrorCode = (typeof MEMORY_FORMAT_ERROR_CODES)[number];

export interface MemoryIssue {
  code: MemoryFormatErrorCode;
  /** Поле frontmatter, к которому относится проблема. */
  field?: string;
}

export interface MemoryFact {
  id: string;
  title: string;
  description: string;
  type: MemoryType;
  created: string;
  updated?: string;
  source?: string;
  author?: string;
  body: string;
}

/** То, что присылает агент или человек: без id и дат — их назначает сервис. */
export interface MemoryDraft {
  title: string;
  description: string;
  type: MemoryType;
  body: string;
  source?: string;
  author?: string;
}

const MEMORY_ID_RE = /^mem-(\d{1,6})$/;
const MEMORY_FILE_RE = /^(mem-\d{1,6})(?: - [^/\\]+)?\.md$/;

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as readonly string[]).includes(value);
}

/** Номер факта из id: `mem-12` → 12. */
export function memoryNumber(id: string): number | null {
  const m = MEMORY_ID_RE.exec(String(id).trim().toLowerCase());
  return m ? parseInt(m[1], 10) : null;
}

export function isValidMemoryId(id: string): boolean {
  return memoryNumber(id) !== null;
}

/** id из имени файла факта (`mem-3 - Slug.md` → `mem-3`); не файл факта — null. */
export function memoryIdFromFileName(fileName: string): string | null {
  const m = MEMORY_FILE_RE.exec(fileName);
  return m ? m[1].toLowerCase() : null;
}

/** Следующий свободный id: максимум существующих номеров плюс один. */
export function nextMemoryId(existingIds: Iterable<string>): string {
  let max = 0;
  for (const id of existingIds) {
    const n = memoryNumber(id);
    if (n !== null && n > max) max = n;
  }
  return `mem-${max + 1}`;
}

/** Имя файла факта: `mem-<N> - <Title-Slug>.md`; slug ограничен (ENAMETOOLONG на Windows). */
export function memoryFileName(id: string, title: string): string {
  const slug = sanitizeTaskFileTitle(title).slice(0, MEMORY_LIMITS.slug).replace(/[-.]+$/g, '');
  return slug ? `${id} - ${slug}.md` : `${id}.md`;
}

function trimBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '');
}

/** Проверка черновика: обязательные поля, тип, лимиты, однострочность заголовка и описания. */
export function validateMemoryDraft(draft: MemoryDraft): MemoryIssue[] {
  const issues: MemoryIssue[] = [];
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const description = typeof draft.description === 'string' ? draft.description.trim() : '';
  const body = typeof draft.body === 'string' ? trimBody(draft.body) : '';

  if (!title) issues.push({ code: 'missing_title', field: 'title' });
  else if (title.length > MEMORY_LIMITS.title) issues.push({ code: 'title_too_long', field: 'title' });
  if (/[\r\n]/.test(title)) issues.push({ code: 'multiline_field', field: 'title' });

  if (!description) issues.push({ code: 'missing_description', field: 'description' });
  else if (description.length > MEMORY_LIMITS.description) issues.push({ code: 'description_too_long', field: 'description' });
  if (/[\r\n]/.test(description)) issues.push({ code: 'multiline_field', field: 'description' });

  if (!isMemoryType(draft.type)) issues.push({ code: 'invalid_type', field: 'type' });

  if (!body) issues.push({ code: 'empty_body', field: 'body' });
  else if (body.length > MEMORY_LIMITS.body) issues.push({ code: 'body_too_long', field: 'body' });

  if (draft.source !== undefined) {
    if (/[\r\n]/.test(draft.source)) issues.push({ code: 'multiline_field', field: 'source' });
    if (draft.source.length > MEMORY_LIMITS.source) issues.push({ code: 'source_too_long', field: 'source' });
  }
  if (draft.author !== undefined) {
    if (/[\r\n]/.test(draft.author)) issues.push({ code: 'multiline_field', field: 'author' });
    if (draft.author.length > MEMORY_LIMITS.author) issues.push({ code: 'author_too_long', field: 'author' });
  }
  return issues;
}

/** Черновик → факт: обрезка пробелов, нормализация тела; id и даты задаёт вызывающий. */
export function buildMemoryFact(draft: MemoryDraft, id: string, created: string, updated?: string): MemoryFact {
  const fact: MemoryFact = {
    id,
    title: draft.title.trim(),
    description: draft.description.trim(),
    type: draft.type,
    created,
    body: trimBody(draft.body)
  };
  if (updated) fact.updated = updated;
  if (draft.source?.trim()) fact.source = draft.source.trim();
  if (draft.author?.trim()) fact.author = draft.author.trim();
  return fact;
}

/** JSON-строка — валидная YAML-строка в двойных кавычках: значения всегда остаются строками. */
const q = (value: string) => JSON.stringify(value);

/** Факт → содержимое файла; порядок ключей фиксирован, чтобы дифф был стабильным. */
export function serializeMemoryFact(fact: MemoryFact): string {
  const lines = [
    '---',
    `id: ${q(fact.id)}`,
    `title: ${q(fact.title)}`,
    `description: ${q(fact.description)}`,
    `type: ${q(fact.type)}`,
    `created: ${q(fact.created)}`
  ];
  if (fact.updated) lines.push(`updated: ${q(fact.updated)}`);
  if (fact.source) lines.push(`source: ${q(fact.source)}`);
  if (fact.author) lines.push(`author: ${q(fact.author)}`);
  lines.push('---', '', trimBody(fact.body), '');
  return lines.join('\n');
}

export type ParsedMemoryFile = { ok: true; fact: MemoryFact } | { ok: false; issues: MemoryIssue[] };

const STRING_FIELDS = ['id', 'title', 'description', 'type', 'created', 'updated', 'source', 'author'] as const;

/**
 * Разбирает файл факта. Проверяет имя файла, что все поля frontmatter — строки (а не `Date` или
 * числа, правило 16), что id совпадает с именем файла, и лимиты черновика.
 */
export function parseMemoryFile(fileName: string, content: string): ParsedMemoryFile {
  const fileId = memoryIdFromFileName(fileName);
  if (!fileId) return { ok: false, issues: [{ code: 'invalid_file_name' }] };

  let data: Record<string, unknown>;
  let body: string;
  try {
    // Пустой объект опций отключает кэш gray-matter: иначе повторный разбор того же текста
    // возвращает общий объект, и правки одного результата видны в другом
    const parsed = matter(content, {});
    data = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    return { ok: false, issues: [{ code: 'invalid_frontmatter' }] };
  }
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    return { ok: false, issues: [{ code: 'invalid_frontmatter' }] };
  }

  const issues: MemoryIssue[] = [];
  for (const field of STRING_FIELDS) {
    const value = data[field];
    if (value !== undefined && value !== null && typeof value !== 'string') issues.push({ code: 'not_a_string', field });
  }
  const str = (field: string) => (typeof data[field] === 'string' ? (data[field] as string) : '');

  const id = str('id').trim().toLowerCase();
  if (!isValidMemoryId(id)) issues.push({ code: 'invalid_id', field: 'id' });
  else if (id !== fileId) issues.push({ code: 'id_mismatch', field: 'id' });
  if (!str('created').trim()) issues.push({ code: 'not_a_string', field: 'created' });

  const draft: MemoryDraft = {
    title: str('title'),
    description: str('description'),
    type: str('type') as MemoryType,
    body,
    source: typeof data.source === 'string' ? data.source : undefined,
    author: typeof data.author === 'string' ? data.author : undefined
  };
  issues.push(...validateMemoryDraft(draft));

  // Одна проблема на поле: «не строка» уже объясняет, почему поле пустое
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.field ?? ''}`;
    if (i.field && seen.has(key)) return false;
    if (i.field) seen.add(key);
    return true;
  });
  if (unique.length > 0) return { ok: false, issues: unique };

  return {
    ok: true,
    fact: buildMemoryFact(draft, id, str('created').trim(), str('updated').trim() || undefined)
  };
}

/** Порядок фактов в индексе и списках — по номеру. */
export function compareMemoryFacts(a: Pick<MemoryFact, 'id'>, b: Pick<MemoryFact, 'id'>): number {
  return (memoryNumber(a.id) ?? 0) - (memoryNumber(b.id) ?? 0);
}

export const MEMORY_INDEX_HEADER = [
  '# Память проекта',
  '',
  '<!-- Файл генерирует ProjectHub из backlog/memory/mem-*.md — не правьте вручную. -->',
  ''
].join('\n');

export type MemoryIndexEntry = Pick<MemoryFact, 'id' | 'title' | 'description'> & {
  /** Фактическое имя файла; без него — вычисленное из id и заголовка. */
  fileName?: string;
};

/** Строка индекса: `- [title](file) — description` (ссылка кодирует пробелы в имени файла). */
export function memoryIndexLine(fact: MemoryIndexEntry): string {
  const file = (fact.fileName ?? memoryFileName(fact.id, fact.title)).replace(/ /g, '%20');
  const title = fact.title.replace(/[[\]]/g, '');
  return `- [${title}](${file}) — ${fact.description}`;
}

/** Содержимое `MEMORY.md`: заголовок и по строке на факт в порядке номеров. */
export function buildMemoryIndex(facts: ReadonlyArray<MemoryIndexEntry>): string {
  const lines = [...facts].sort(compareMemoryFacts).map(memoryIndexLine);
  return `${MEMORY_INDEX_HEADER}${lines.length > 0 ? `${lines.join('\n')}\n` : ''}`;
}
