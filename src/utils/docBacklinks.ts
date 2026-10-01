/**
 * Связи документации (TASK-122, decision-69): кто ссылается на документ и какие в нём заголовки.
 * Ссылкой считается то же, что показывает ссылкой `MarkdownViewer`: `[[id]]`, упоминание идентификатора
 * без скобок и относительная ссылка на файл Backlog.md. Блоки кода и строчный код — примеры, не ссылки.
 * Чистый модуль без React/Electron — покрыт unit-тестами.
 */
import { parseMarkdownBlocks } from '../components/common/markdownBlocks';
import { docRefFromHref, headingAnchorKey, tokenizeDocRefs } from './docRefs';
import type { DocBacklink, DocLinkIndex } from '../types/electron';

export interface DocLinkSource extends DocBacklink {
  /** Markdown источника вместе с frontmatter. */
  content: string;
}

const KIND_ORDER: Record<DocBacklink['kind'], number> = { decision: 0, doc: 1, task: 2, mem: 3 };

/** Текст документа без frontmatter, блоков кода и диаграмм, по одному фрагменту на блок. */
function proseFragments(markdown: string): string[] {
  const fragments: string[] = [];
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'code' || block.type === 'mermaid' || block.type === 'hr') continue;
    if (block.raw) fragments.push(block.raw);
    if (block.alertContent) fragments.push(block.alertContent);
    if (block.items) fragments.push(...block.items);
    if (block.headers) fragments.push(...block.headers);
    if (block.rows) fragments.push(...block.rows.flat());
  }
  return fragments;
}

/** Идентификаторы (в нижнем регистре, без повторов), на которые ссылается текст. */
export function collectRefTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const fragment of proseFragments(markdown)) {
    const withoutCode = fragment.replace(/`[^`]+`/g, ' ');
    const withoutLinks = withoutCode.replace(/\[[^\]]+\]\(([^)]+)\)/g, (_match, href: string) => {
      const fileRef = docRefFromHref(href);
      if (fileRef) targets.add(fileRef.id);
      return ' ';
    });
    for (const token of tokenizeDocRefs(withoutLinks)) {
      if (token.type === 'ref') targets.add(token.id);
    }
  }
  return [...targets];
}

/** Ключи заголовков документа в порядке появления, без повторов. */
export function collectHeadingKeys(markdown: string): string[] {
  const keys = new Set<string>();
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type !== 'heading') continue;
    const key = headingAnchorKey(block.raw || '');
    if (key) keys.add(key);
  }
  return [...keys];
}

function idParts(id: string): number[] {
  return (id.match(/\d+/g) || []).map(Number);
}

function compareBacklinks(a: DocBacklink, b: DocBacklink): number {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const pa = idParts(a.id);
  const pb = idParts(b.id);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Индекс связей: обратные ссылки собираются только для решений и документов, ссылка документа
 * на самого себя не учитывается. Источники в списке идут решениями, документами, задачами и фактами
 * памяти (decision-70), внутри вида по номеру.
 */
export function buildDocLinkIndex(sources: DocLinkSource[]): DocLinkIndex {
  const backlinks: Record<string, DocBacklink[]> = {};
  const headings: Record<string, string[]> = {};
  const documentIds = new Set<string>();
  for (const source of sources) {
    if (source.kind !== 'decision' && source.kind !== 'doc') continue;
    const key = source.id.toLowerCase();
    documentIds.add(key);
    headings[key] = collectHeadingKeys(source.content);
  }
  for (const source of sources) {
    const sourceKey = source.id.toLowerCase();
    for (const target of collectRefTargets(source.content)) {
      if (target === sourceKey || !documentIds.has(target)) continue;
      const entry: DocBacklink = { id: source.id, kind: source.kind, title: source.title };
      if (source.status) entry.status = source.status;
      (backlinks[target] ||= []).push(entry);
    }
  }
  for (const list of Object.values(backlinks)) list.sort(compareBacklinks);
  return { backlinks, headings };
}
