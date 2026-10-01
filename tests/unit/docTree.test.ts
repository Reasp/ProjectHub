import { describe, expect, it } from 'vitest';
import {
  ancestorKeys,
  buildDocTree,
  listSections,
  normalizeSection,
  sectionFromRelativePath,
  type DocTreeItem,
  type DocTreeNode
} from '../../src/utils/docTree';

const ROOTS: Array<{ category: DocTreeItem['category']; name: string }> = [
  { category: 'decision', name: 'Решения' },
  { category: 'doc', name: 'Документы' }
];

const doc = (id: string, section?: string, title = id): DocTreeItem => ({
  id,
  title,
  category: id.startsWith('decision') ? 'decision' : 'doc',
  section
});

/** Дерево в виде отступов — так структура читается в ожидании теста. */
function outline(nodes: Array<DocTreeNode<DocTreeItem>>, depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'folder'
      ? [`${'  '.repeat(depth)}${node.name} (${node.count})`, ...outline(node.children, depth + 1)]
      : [`${'  '.repeat(depth)}${node.doc.id}`]
  );
}

describe('normalizeSection', () => {
  it('чистит пробелы, пустые сегменты и обратные слэши', () => {
    expect(normalizeSection(' Агенты \\ HITL/ ')).toBe('Агенты/HITL');
    expect(normalizeSection(' / ')).toBeUndefined();
    expect(normalizeSection(undefined)).toBeUndefined();
  });
});

describe('sectionFromRelativePath', () => {
  it('берёт вложенные папки, файл в корне раздела не имеет', () => {
    expect(sectionFromRelativePath('guides\\rag\\doc-3 - Title.md')).toBe('guides/rag');
    expect(sectionFromRelativePath('doc-3 - Title.md')).toBeUndefined();
  });
});

describe('buildDocTree', () => {
  it('раскладывает документы по разделам и подразделам, считает вложенные', () => {
    const tree = buildDocTree(
      [
        doc('decision-10', 'Агенты/HITL'),
        doc('decision-9', 'Агенты/Роли'),
        doc('decision-46', 'Агенты/HITL'),
        doc('decision-5', 'Безопасность'),
        doc('decision-1'),
        doc('doc-5', 'Руководства')
      ],
      ROOTS
    );
    expect(outline(tree)).toEqual([
      'Решения (5)',
      '  Агенты (3)',
      '    HITL (2)',
      '      decision-10',
      '      decision-46',
      '    Роли (1)',
      '      decision-9',
      '  Безопасность (1)',
      '    decision-5',
      '  decision-1',
      'Документы (1)',
      '  Руководства (1)',
      '    doc-5'
    ]);
  });

  it('сортирует документы по номеру, а не по строке', () => {
    const tree = buildDocTree([doc('decision-10'), doc('decision-9'), doc('decision-2')], ROOTS);
    expect(outline(tree)).toEqual(['Решения (3)', '  decision-2', '  decision-9', '  decision-10']);
  });

  it('пустую категорию в дерево не включает', () => {
    expect(buildDocTree([doc('doc-1')], ROOTS).map((root) => root.key)).toEqual(['doc']);
    expect(buildDocTree([], ROOTS)).toEqual([]);
  });

  it('ключи узлов уникальны и совпадают с ancestorKeys документа', () => {
    const item = doc('decision-46', 'Агенты/HITL');
    const tree = buildDocTree([item], ROOTS);
    const keys: string[] = [];
    const walk = (nodes: Array<DocTreeNode<DocTreeItem>>) =>
      nodes.forEach((node) => {
        if (node.kind === 'folder') {
          keys.push(node.key);
          walk(node.children);
        }
      });
    walk(tree);
    expect(keys).toEqual(['decision', 'decision/Агенты', 'decision/Агенты/HITL']);
    expect(ancestorKeys(item)).toEqual(keys);
  });
});

describe('listSections', () => {
  it('возвращает разделы категории вместе с промежуточными уровнями', () => {
    const docs = [doc('decision-10', 'Агенты/HITL'), doc('decision-5', 'Безопасность'), doc('doc-5', 'Руководства')];
    expect(listSections(docs, 'decision')).toEqual(['Агенты', 'Агенты/HITL', 'Безопасность']);
    expect(listSections(docs, 'doc')).toEqual(['Руководства']);
  });
});
