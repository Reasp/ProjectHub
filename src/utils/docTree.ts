/**
 * Дерево документации (TASK-121, decision-68): решения и документы раскладываются по разделам.
 * Раздел документа — путь через `/` из поля `section` frontmatter либо из вложенной папки.
 * Чистый модуль без React/Electron — используется и в main-процессе, и в рендерере.
 */
export interface DocTreeItem {
  id: string;
  title: string;
  category: 'doc' | 'decision';
  section?: string;
}

export interface DocTreeFolder<T extends DocTreeItem> {
  kind: 'folder';
  /** Уникальный ключ узла: `decision`, `decision/Агенты/HITL`. */
  key: string;
  name: string;
  /** Число документов в узле вместе с вложенными разделами. */
  count: number;
  children: Array<DocTreeNode<T>>;
}

export interface DocTreeLeaf<T extends DocTreeItem> {
  kind: 'doc';
  key: string;
  doc: T;
}

export type DocTreeNode<T extends DocTreeItem> = DocTreeFolder<T> | DocTreeLeaf<T>;

/** `" Агенты \ HITL/ "` → `["Агенты", "HITL"]`. Пустые сегменты отбрасываются. */
export function sectionSegments(section: string | undefined | null): string[] {
  if (!section) return [];
  return section
    .split(/[\\/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeSection(section: string | undefined | null): string | undefined {
  const segments = sectionSegments(section);
  return segments.length > 0 ? segments.join('/') : undefined;
}

/**
 * Раздел по расположению файла: путь вложенных папок относительно корня категории
 * (`guides/rag/doc-3 - Title.md` → `guides/rag`). Файл в корне раздела не имеет.
 */
export function sectionFromRelativePath(relativeToRoot: string): string | undefined {
  const segments = sectionSegments(relativeToRoot);
  return normalizeSection(segments.slice(0, -1).join('/'));
}

/** Сортировка документов: по номеру из id (`decision-9` раньше `decision-10`), затем по названию. */
function compareDocs(a: DocTreeItem, b: DocTreeItem): number {
  const num = (id: string) => {
    const match = id.match(/-(\d+)$/);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  return num(a.id) - num(b.id) || a.title.localeCompare(b.title);
}

function sortFolder<T extends DocTreeItem>(folder: DocTreeFolder<T>): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.kind === 'folder' && b.kind === 'folder') return a.name.localeCompare(b.name);
    if (a.kind === 'doc' && b.kind === 'doc') return compareDocs(a.doc, b.doc);
    return 0;
  });
  for (const child of folder.children) {
    if (child.kind === 'folder') sortFolder(child);
  }
}

/**
 * Строит дерево: корневые узлы категорий в порядке `roots`, внутри — разделы (сначала папки по
 * алфавиту, затем документы без раздела). Пустые категории в дерево не попадают.
 */
export function buildDocTree<T extends DocTreeItem>(
  docs: T[],
  roots: Array<{ category: T['category']; name: string }>
): Array<DocTreeFolder<T>> {
  const result: Array<DocTreeFolder<T>> = [];

  for (const root of roots) {
    const rootFolder: DocTreeFolder<T> = { kind: 'folder', key: root.category, name: root.name, count: 0, children: [] };
    const folders = new Map<string, DocTreeFolder<T>>([[rootFolder.key, rootFolder]]);

    for (const doc of docs) {
      if (doc.category !== root.category) continue;
      let parent = rootFolder;
      parent.count += 1;
      for (const segment of sectionSegments(doc.section)) {
        const key = `${parent.key}/${segment}`;
        let folder = folders.get(key);
        if (!folder) {
          folder = { kind: 'folder', key, name: segment, count: 0, children: [] };
          folders.set(key, folder);
          parent.children.push(folder);
        }
        folder.count += 1;
        parent = folder;
      }
      parent.children.push({ kind: 'doc', key: `${parent.key}#${doc.id}`, doc });
    }

    if (rootFolder.count === 0) continue;
    sortFolder(rootFolder);
    result.push(rootFolder);
  }

  return result;
}

/** Ключи узлов-предков документа — чтобы раскрыть ветку до выбранного документа. */
export function ancestorKeys(doc: DocTreeItem): string[] {
  const keys: string[] = [doc.category];
  for (const segment of sectionSegments(doc.section)) {
    keys.push(`${keys[keys.length - 1]}/${segment}`);
  }
  return keys;
}

/** Все разделы категории (включая промежуточные уровни) — подсказки при создании документа. */
export function listSections(docs: DocTreeItem[], category: DocTreeItem['category']): string[] {
  const sections = new Set<string>();
  for (const doc of docs) {
    if (doc.category !== category) continue;
    const segments = sectionSegments(doc.section);
    for (let i = 1; i <= segments.length; i++) sections.add(segments.slice(0, i).join('/'));
  }
  return Array.from(sections).sort((a, b) => a.localeCompare(b));
}
