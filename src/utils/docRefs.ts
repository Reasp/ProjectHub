/**
 * Перекрёстные ссылки Backlog.md в тексте Markdown (TASK-121, decision-68): `[[decision-46]]`,
 * `[[doc-5|подпись]]`, `[[TASK-103]]`, `[[mem-3]]` и те же идентификаторы без скобок.
 * Ссылка на заголовок документа — `[[decision-46#Decision]]` (TASK-122, decision-69).
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
  /** Заголовок внутри документа после `#`, как он написан в ссылке. */
  anchor?: string;
}

export type DocRefToken = { type: 'text'; value: string } | ({ type: 'ref' } & DocRef);

const ID = '(?:decision|doc|task|mem)-\\d+(?:\\.\\d+)*';

// Упоминание без скобок не считается ссылкой внутри пути или имени файла
// (`backlog/docs/doc-7 - Аудит.md`, `task-28-fix`) и внутри более длинного слова.
const REF_PATTERN = new RegExp(
  `\\[\\[\\s*(${ID})\\s*(?:#([^\\]|\\n]*))?(?:\\|([^\\]\\n]*))?\\]\\]|(?<![\\p{L}\\p{N}_/\\\\.-])(${ID})(?![\\p{L}\\p{N}_-]|\\s+-\\s)`,
  'giu'
);

export function docRefKind(id: string): DocRefKind | null {
  const match = id.trim().toLowerCase().match(/^(decision|doc|task|mem)-\d+(?:\.\d+)*$/);
  return match ? (match[1] as DocRefKind) : null;
}

/**
 * Ключ заголовка для сравнения с якорем ссылки: регистр, знаки препинания и разметка не важны,
 * поэтому `#Decision`, `#decision` и `#принятое-решение` находят «## Decision» и «## Принятое решение».
 */
export function headingAnchorKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Делит строку на обычный текст и ссылки. Строка без ссылок возвращается одним текстовым токеном. */
export function tokenizeDocRefs(text: string): DocRefToken[] {
  const tokens: DocRefToken[] = [];
  let last = 0;
  for (const match of text.matchAll(REF_PATTERN)) {
    const index = match.index ?? 0;
    const wiki = match[1] !== undefined;
    const rawId = wiki ? match[1] : match[4];
    const kind = docRefKind(rawId);
    if (!kind) continue;
    if (index > last) tokens.push({ type: 'text', value: text.slice(last, index) });
    const anchor = wiki ? match[2]?.trim() : undefined;
    const alias = wiki ? match[3]?.trim() : undefined;
    const ref: DocRef = { kind, id: rawId.toLowerCase(), label: alias || (anchor ? `${rawId}#${anchor}` : rawId), wiki };
    if (anchor) ref.anchor = anchor;
    tokens.push({ type: 'ref', ...ref });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // некорректное %-кодирование — разбираем как есть
    return value;
  }
}

/**
 * Идентификатор документа или задачи по относительной ссылке Markdown на файл Backlog.md:
 * `../decisions/decision-46 - Исполнитель.md#Decision` → `decision-46` с якорем `Decision`.
 * Для остальных ссылок — `null`.
 */
export function docRefFromHref(href: string): DocRef | null {
  const trimmed = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const hashIndex = trimmed.indexOf('#');
  const anchor = hashIndex === -1 ? '' : safeDecode(trimmed.slice(hashIndex + 1)).trim();
  const fileName = safeDecode(trimmed.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '');
  const match = fileName.match(new RegExp(`^(${ID})(?:\\s+-\\s.*)?\\.md$`, 'i'));
  if (!match) return null;
  const kind = docRefKind(match[1]);
  if (!kind) return null;
  const ref: DocRef = { kind, id: match[1].toLowerCase(), label: match[1], wiki: true };
  if (anchor) ref.anchor = anchor;
  return ref;
}

export type RefLeaveGuard = 'task' | 'doc';

/**
 * Какие несохранённые правки потеряются при переходе по ссылке (TASK-122): карточка задачи закрывается
 * при переходе к любому другому объекту, открытый документ заменяется другим документом или памятью.
 * Ссылка на ту же задачу или тот же документ ничего не закрывает.
 */
export function refLeaveGuards(
  ref: Pick<DocRef, 'kind' | 'id'>,
  state: { dirtyTaskId: string | null; isDocDirty: boolean; selectedDocId?: string | null }
): RefLeaveGuard[] {
  const guards: RefLeaveGuard[] = [];
  if (state.dirtyTaskId && !(ref.kind === 'task' && ref.id === state.dirtyTaskId.toLowerCase())) guards.push('task');
  if (state.isDocDirty && ref.kind !== 'task' && (ref.kind === 'mem' || state.selectedDocId?.toLowerCase() !== ref.id)) {
    guards.push('doc');
  }
  return guards;
}
