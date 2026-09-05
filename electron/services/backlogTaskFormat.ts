/**
 * Формат файлов задач Backlog.md (`backlog/tasks/task-N - Title.md`).
 *
 * Нативный формат CLI/MCP Backlog.md:
 *
 * ```md
 * ---
 * id: TASK-27
 * title: ...
 * status: To Do
 * assignee: []
 * created_date: '2026-09-05 02:40'
 * updated_date: '2026-09-05 02:44'
 * labels: []
 * dependencies: []
 * ---
 *
 * ## Description
 *
 * <!-- SECTION:DESCRIPTION:BEGIN -->
 * текст
 * <!-- SECTION:DESCRIPTION:END -->
 *
 * ## Acceptance Criteria
 * <!-- AC:BEGIN -->
 * - [ ] #1 критерий
 * <!-- AC:END -->
 * ```
 *
 * Дальше могут идти `## Implementation Plan`, `## Implementation Notes`, `## Final Summary`,
 * `## Comments` и произвольные секции — их GUI не трогает. Все функции здесь чистые
 * (без Electron/fs), работают с телом файла (без frontmatter) с переводами строк `\n`.
 * Legacy-файлы без маркеров (`## Description` + чекбоксы без `#N`) читаются через fallback
 * по заголовкам и при первой записи из GUI приводятся к нативному формату.
 */

export interface TaskCriterionLike {
  text: string;
  completed: boolean;
}

export const DESCRIPTION_BEGIN = '<!-- SECTION:DESCRIPTION:BEGIN -->';
export const DESCRIPTION_END = '<!-- SECTION:DESCRIPTION:END -->';
export const AC_BEGIN = '<!-- AC:BEGIN -->';
export const AC_END = '<!-- AC:END -->';

const DESCRIPTION_HEADING = /^##\s+Description\s*$/i;
const AC_HEADING = /^##\s+Acceptance Criteria\s*$/i;
const ANY_H2 = /^##\s+\S/;
const CHECKBOX = /^(\s*-\s*\[)([ xX])(\]\s*)(.*)$/;
const CRITERION_PREFIX = /^#\d+\s+/;

/** Метка времени в формате Backlog.md: `YYYY-MM-DD HH:mm` (UTC, как пишет CLI). */
export function nowBacklogTimestamp(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}`;
}

/**
 * Приводит значения frontmatter к безопасному для записи виду (правило 16): незакавыченная
 * дата в YAML парсится в `Date`, и js-yaml выписал бы её обратно ISO-таймстампом
 * (`2026-09-03T00:00:00.000Z`). Даты приводим к строкам, вложенные списки/объекты — рекурсивно.
 */
export function normalizeFrontmatter<T>(value: T): T {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return undefined as T;
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0;
    return (hasTime ? nowBacklogTimestamp(value) : value.toISOString().slice(0, 10)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeFrontmatter(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeFrontmatter(v);
    return out as T;
  }
  return value;
}

/**
 * Проставляет `updated_date`, сохраняя порядок ключей как у Backlog.md
 * (сразу после `created_date`, если поля ещё не было).
 */
export function withUpdatedDate(
  data: Record<string, unknown>,
  timestamp: string = nowBacklogTimestamp()
): Record<string, unknown> {
  if ('updated_date' in data) return { ...data, updated_date: timestamp };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v;
    if (k === 'created_date') out.updated_date = timestamp;
  }
  if (!('updated_date' in out)) out.updated_date = timestamp;
  return out;
}

interface Range {
  /** индекс первой строки содержимого */
  start: number;
  /** индекс строки после последней строки содержимого (exclusive) */
  end: number;
}

function findMarkerBlock(lines: string[], begin: string, end: string): Range | null {
  const b = lines.findIndex((l) => l.trim() === begin);
  if (b === -1) return null;
  const e = lines.findIndex((l, i) => i > b && l.trim() === end);
  if (e === -1) return null;
  return { start: b + 1, end: e };
}

/** Тело секции `## Heading` — от строки после заголовка до следующего `## ` (exclusive). */
function findHeadingSection(lines: string[], heading: RegExp): { headingIndex: number; body: Range } | null {
  const h = lines.findIndex((l) => heading.test(l.trim()));
  if (h === -1) return null;
  let e = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    if (ANY_H2.test(lines[i])) {
      e = i;
      break;
    }
  }
  return { headingIndex: h, body: { start: h + 1, end: e } };
}

function trimBlankEdges(lines: string[]): string[] {
  let s = 0;
  let e = lines.length;
  while (s < e && lines[s].trim() === '') s++;
  while (e > s && lines[e - 1].trim() === '') e--;
  return lines.slice(s, e);
}

export function stripCriterionPrefix(text: string): string {
  return text.replace(CRITERION_PREFIX, '').trim();
}

function parseCheckboxes(lines: string[]): TaskCriterionLike[] {
  const out: TaskCriterionLike[] = [];
  for (const line of lines) {
    const m = line.match(CHECKBOX);
    if (m) out.push({ completed: m[2].toLowerCase() === 'x', text: stripCriterionPrefix(m[4]) });
  }
  return out;
}

/** Диапазон строк, в которых живут критерии: блок AC:BEGIN/END, иначе секция `## Acceptance Criteria`. */
function findCriteriaRange(lines: string[]): Range | null {
  return findMarkerBlock(lines, AC_BEGIN, AC_END) ?? findHeadingSection(lines, AC_HEADING)?.body ?? null;
}

/** Описание (без маркеров) и критерии (без префикса `#N`) из тела файла задачи. */
export function parseTaskBody(content: string): { description: string; criteria: TaskCriterionLike[] } {
  const lines = content.split('\n');

  let description = '';
  const descBlock = findMarkerBlock(lines, DESCRIPTION_BEGIN, DESCRIPTION_END);
  if (descBlock) {
    description = trimBlankEdges(lines.slice(descBlock.start, descBlock.end)).join('\n');
  } else {
    const section = findHeadingSection(lines, DESCRIPTION_HEADING);
    if (section) description = trimBlankEdges(lines.slice(section.body.start, section.body.end)).join('\n');
  }

  const acRange = findCriteriaRange(lines);
  const criteria = acRange ? parseCheckboxes(lines.slice(acRange.start, acRange.end)) : [];

  return { description, criteria };
}

export function formatCriteriaLines(criteria: TaskCriterionLike[]): string[] {
  return criteria.map((c, i) => `- [${c.completed ? 'x' : ' '}] #${i + 1} ${c.text.trim()}`);
}

function descriptionLines(description: string): string[] {
  const text = description.replace(/\r\n/g, '\n').trim();
  return text ? text.split('\n') : [];
}

/** Индекс первого `## `-заголовка начиная с позиции `from`, либо `lines.length`. */
function nextHeadingIndex(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (ANY_H2.test(lines[i])) return i;
  return lines.length;
}

function withoutTrailingBlanks(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

/**
 * Заменяет описание задачи, не трогая остальные секции. Маркеры сохраняются или добавляются,
 * если файл legacy-формата; если секции нет — она вставляется перед первым `## `-заголовком.
 */
export function applyDescription(content: string, description: string): string {
  const lines = content.split('\n');
  const body = descriptionLines(description);

  const block = findMarkerBlock(lines, DESCRIPTION_BEGIN, DESCRIPTION_END);
  if (block) {
    lines.splice(block.start, block.end - block.start, ...body);
    return lines.join('\n');
  }

  const replacement = ['', DESCRIPTION_BEGIN, ...body, DESCRIPTION_END, ''];
  const section = findHeadingSection(lines, DESCRIPTION_HEADING);
  if (section) {
    lines.splice(section.body.start, section.body.end - section.body.start, ...replacement);
    return lines.join('\n');
  }

  // Секции нет и описание пустое — нечего добавлять, файл не трогаем.
  if (body.length === 0) return content;

  const insertAt = nextHeadingIndex(lines, 0);
  const before = withoutTrailingBlanks(lines.slice(0, insertAt));
  const after = lines.slice(insertAt);
  const head = before.length > 0 ? [...before, ''] : [''];
  return [...head, '## Description', ...replacement, ...after].join('\n');
}

/**
 * Заменяет блок критериев (с перенумерацией `#1..#N`), не трогая остальные секции.
 * Если секции нет — вставляется после описания (или в конец файла).
 */
export function applyCriteria(content: string, criteria: TaskCriterionLike[]): string {
  const lines = content.split('\n');
  const body = formatCriteriaLines(criteria);

  const block = findMarkerBlock(lines, AC_BEGIN, AC_END);
  if (block) {
    lines.splice(block.start, block.end - block.start, ...body);
    return lines.join('\n');
  }

  const replacement = [AC_BEGIN, ...body, AC_END, ''];
  const section = findHeadingSection(lines, AC_HEADING);
  if (section) {
    lines.splice(section.body.start, section.body.end - section.body.start, ...replacement);
    return lines.join('\n');
  }

  // Секции нет и критериев нет — нечего добавлять, файл не трогаем.
  if (body.length === 0) return content;

  let insertAt = lines.length;
  const descEnd = lines.findIndex((l) => l.trim() === DESCRIPTION_END);
  if (descEnd !== -1) {
    insertAt = nextHeadingIndex(lines, descEnd + 1);
  } else {
    const descSection = findHeadingSection(lines, DESCRIPTION_HEADING);
    if (descSection) insertAt = descSection.body.end;
  }

  const before = withoutTrailingBlanks(lines.slice(0, insertAt));
  const after = lines.slice(insertAt);
  return [...before, '', '## Acceptance Criteria', ...replacement, ...after].join('\n');
}

/**
 * Переключает чекбокс критерия с индексом `index` (0-based) строго внутри блока критериев.
 * Возвращает новое содержимое или `null`, если критерий не найден.
 */
export function toggleCriterionInContent(content: string, index: number, completed: boolean): string | null {
  const lines = content.split('\n');
  const range = findCriteriaRange(lines);
  if (!range) return null;

  let current = 0;
  for (let i = range.start; i < range.end; i++) {
    const m = lines[i].match(CHECKBOX);
    if (!m) continue;
    if (current === index) {
      lines[i] = `${m[1]}${completed ? 'x' : ' '}${m[3]}${m[4]}`;
      return lines.join('\n');
    }
    current++;
  }
  return null;
}

/** Тело нового файла задачи в нативном формате Backlog.md. */
export function buildTaskBody(description: string, criteria: TaskCriterionLike[] = []): string {
  return [
    '',
    '## Description',
    '',
    DESCRIPTION_BEGIN,
    ...descriptionLines(description),
    DESCRIPTION_END,
    '',
    '## Acceptance Criteria',
    AC_BEGIN,
    ...formatCriteriaLines(criteria),
    AC_END,
    ''
  ].join('\n');
}

/** Часть имени файла из заголовка — как у CLI Backlog.md: пробелы → `-`, спецсимволы убраны. */
export function sanitizeTaskFileTitle(title: string): string {
  return title
    .replace(/[\\/]+/g, '-')
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Номер задачи из имени файла или id (`task-12 - ...`, `TASK-12`). */
export function taskNumberFromName(name: string): number | null {
  const m = name.match(/^task-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}
