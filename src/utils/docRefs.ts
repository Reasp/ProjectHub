/**
 * Перекрёстные ссылки Backlog.md в тексте Markdown (TASK-121, decision-68): `[[decision-46]]`,
 * `[[doc-5|подпись]]`, `[[TASK-103]]`, `[[mem-3]]` и те же идентификаторы без скобок.
 * Чистый модуль без React/Electron — разбор покрыт unit-тестами.
 */
export type DocRefKind = 'decision' | 'doc' | 'task' | 'mem';

export interface DocRef {
  kind: DocRefKind;
  /** Идентификатор в нижнем регистре: `decision-46`, `task-70.2`. */
  id: string;
  /** Текст ссылки: подпись после `|` либо идентификатор как он написан в документе. */
  label: string;
  /** `true` — записана в двойных скобках, `false` — упоминание идентификатора в тексте. */
  wiki: boolean;
}

export type DocRefToken = { type: 'text'; value: string } | ({ type: 'ref' } & DocRef);

const ID = '(?:decision|doc|task|mem)-\\d+(?:\\.\\d+)*';

// Упоминание без скобок не считается ссылкой внутри пути или имени файла
// (`backlog/docs/doc-7 - Аудит.md`, `task-28-fix`) и внутри более длинного слова.
const REF_PATTERN = new RegExp(
  `\\[\\[\\s*(${ID})\\s*(?:\\|([^\\]\\n]*))?\\]\\]|(?<![\\p{L}\\p{N}_/\\\\.-])(${ID})(?![\\p{L}\\p{N}_-]|\\s+-\\s)`,
  'giu'
);

export function docRefKind(id: string): DocRefKind | null {
  const match = id.trim().toLowerCase().match(/^(decision|doc|task|mem)-\d+(?:\.\d+)*$/);
  return match ? (match[1] as DocRefKind) : null;
}

/** Делит строку на обычный текст и ссылки. Строка без ссылок возвращается одним текстовым токеном. */
export function tokenizeDocRefs(text: string): DocRefToken[] {
  const tokens: DocRefToken[] = [];
  let last = 0;
  for (const match of text.matchAll(REF_PATTERN)) {
    const index = match.index ?? 0;
    const wiki = match[1] !== undefined;
    const rawId = wiki ? match[1] : match[3];
    const kind = docRefKind(rawId);
    if (!kind) continue;
    if (index > last) tokens.push({ type: 'text', value: text.slice(last, index) });
    const alias = wiki ? match[2]?.trim() : undefined;
    tokens.push({ type: 'ref', kind, id: rawId.toLowerCase(), label: alias || rawId, wiki });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/**
 * Идентификатор документа или задачи по относительной ссылке Markdown на файл Backlog.md:
 * `../decisions/decision-46 - Исполнитель.md` → `decision-46`. Для остальных ссылок — `null`.
 */
export function docRefFromHref(href: string): DocRef | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href.trim())) return null;
  let fileName = href.trim().split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // некорректное %-кодирование — разбираем имя как есть
  }
  const match = fileName.match(new RegExp(`^(${ID})(?:\\s+-\\s.*)?\\.md$`, 'i'));
  if (!match) return null;
  const kind = docRefKind(match[1]);
  return kind ? { kind, id: match[1].toLowerCase(), label: match[1], wiki: true } : null;
}
