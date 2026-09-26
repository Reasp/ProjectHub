import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

// Проверка памяти проекта backlog/memory для lint:docs (decision-51 п. 7, TASK-76).
// Скрипт шаблона инфраструктуры работает и без приложения ProjectHub, поэтому правила формата
// повторены здесь; совпадение с electron/services/memoryFormat.ts сторожит тест memoryRules.test.ts.

export const MEMORY_ROOT = 'backlog/memory';
export const MEMORY_INDEX_FILE = 'MEMORY.md';
export const MEMORY_TYPES = ['project', 'feedback', 'reference'];
export const MEMORY_LIMITS = { title: 100, description: 200, body: 2000 };
const REQUIRED = ['id', 'title', 'description', 'type', 'created'];
const STRING_FIELDS = [...REQUIRED, 'updated', 'source', 'author'];
const FILE_RE = /^(mem-\d{1,6})(?: - [^/\\]+)?\.md$/;

// Секреты — только шаблоны с высокой уверенностью; полный детектор (с ИМЯ=значение) работает
// при записи в приложении (electron/services/secretPatterns.ts), сюда попадают правки руками.
export const STRICT_SECRET_PATTERNS = [
  ['private_key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['provider_key', /\b(?:sk-(?:ant-|or-v1-|or-|proj-)?|gsk_|xai-)[A-Za-z0-9_-]{16,}/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['slack_token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['aws_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['google_key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['huggingface_token', /\bhf_[A-Za-z0-9]{30,}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/]
];

/** Ошибки одного файла факта. */
export function checkMemoryFile(fileName, content) {
  const errors = [];
  const m = FILE_RE.exec(fileName);
  if (!m) return [`Имя файла памяти должно быть "mem-<N> - <Title-Slug>.md" (или ${MEMORY_INDEX_FILE})`];
  let data;
  let body;
  try {
    const parsed = matter(content, {});
    data = parsed.data;
    body = parsed.content.replace(/\r\n/g, '\n').trim();
  } catch (e) {
    return [`Frontmatter не парсится как YAML: ${e.message}`];
  }
  for (const field of REQUIRED) {
    if (data[field] === undefined || data[field] === null || data[field] === '') errors.push(`Отсутствует поле "${field}"`);
  }
  for (const field of STRING_FIELDS) {
    const v = data[field];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      errors.push(`Поле "${field}" должно быть строкой в кавычках (правило 16), сейчас ${v instanceof Date ? 'Date' : typeof v}`);
    }
  }
  if (typeof data.id === 'string' && data.id.trim().toLowerCase() !== m[1].toLowerCase()) {
    errors.push(`id "${data.id}" не совпадает с именем файла (${m[1]})`);
  }
  if (typeof data.type === 'string' && !MEMORY_TYPES.includes(data.type)) {
    errors.push(`type "${data.type}" не из списка: ${MEMORY_TYPES.join(', ')}`);
  }
  for (const [field, max] of [['title', MEMORY_LIMITS.title], ['description', MEMORY_LIMITS.description]]) {
    if (typeof data[field] === 'string' && data[field].trim().length > max) errors.push(`Поле "${field}" длиннее ${max} символов`);
  }
  if (!body) errors.push('Пустое тело факта');
  else if (body.length > MEMORY_LIMITS.body) errors.push(`Тело факта длиннее ${MEMORY_LIMITS.body} символов`);
  const text = [data.title, data.description, body, data.source, data.author].filter((v) => typeof v === 'string').join('\n');
  for (const [kind, re] of STRICT_SECRET_PATTERNS) {
    if (re.test(text)) errors.push(`Похоже на секрет (${kind}) — секреты в память проекта не пишутся`);
  }
  return errors;
}

/** Ссылки индекса MEMORY.md на файлы (пробелы в ссылках закодированы как %20). */
export function indexLinks(indexContent) {
  const links = [];
  for (const match of indexContent.matchAll(/^- \[[^\]]*\]\(([^)]+)\)/gm)) {
    try {
      links.push(decodeURIComponent(match[1]));
    } catch {
      links.push(match[1]);
    }
  }
  return links;
}

/**
 * Проверяет каталог памяти проекта: каждый файл факта и соответствие MEMORY.md набору файлов.
 * Возвращает Map<относительный путь, ошибки[]>; пустой каталог или его отсутствие — пустая Map.
 */
export function validateMemoryDir(root) {
  const result = new Map();
  const dir = path.join(root, MEMORY_ROOT);
  if (!fs.existsSync(dir)) return result;
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
  const factFiles = files.filter((f) => f !== MEMORY_INDEX_FILE);
  for (const f of factFiles) {
    result.set(`${MEMORY_ROOT}/${f}`, checkMemoryFile(f, fs.readFileSync(path.join(dir, f), 'utf-8')));
  }
  const indexErrors = [];
  if (factFiles.length > 0 && !files.includes(MEMORY_INDEX_FILE)) {
    indexErrors.push(`Нет индекса ${MEMORY_INDEX_FILE}: его пересобирает ProjectHub при записи памяти`);
  } else if (files.includes(MEMORY_INDEX_FILE)) {
    const links = indexLinks(fs.readFileSync(path.join(dir, MEMORY_INDEX_FILE), 'utf-8'));
    for (const f of factFiles) if (!links.includes(f)) indexErrors.push(`Факт "${f}" не упомянут в индексе`);
    for (const l of links) if (!factFiles.includes(l)) indexErrors.push(`Индекс ссылается на отсутствующий файл "${l}"`);
  }
  if (files.includes(MEMORY_INDEX_FILE) || indexErrors.length > 0) result.set(`${MEMORY_ROOT}/${MEMORY_INDEX_FILE}`, indexErrors);
  return result;
}
