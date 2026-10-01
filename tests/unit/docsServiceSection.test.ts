import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectDoc, listProjectDocs } from '../../electron/services/docsService';

/** Раздел дерева документации (decision-68): поле `section` frontmatter либо вложенная папка. */
describe('docsService: раздел документа', () => {
  let project: string;

  const write = async (rel: string, frontmatter: string[]) => {
    const full = path.join(project, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, ['---', ...frontmatter, '---', '', 'Текст', ''].join('\n'), 'utf-8');
  };

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-docs-section-'));
  });

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  it('берёт раздел из frontmatter, иначе из вложенной папки, иначе раздела нет', async () => {
    await write('backlog/decisions/decision-1 - A.md', ['id: decision-1', 'title: "A"', 'section: " Агенты / HITL "']);
    await write('backlog/docs/guides/rag/doc-1 - B.md', ['id: doc-1', 'title: "B"']);
    await write('backlog/docs/guides/doc-2 - C.md', ['id: doc-2', 'title: "C"', 'section: "Руководства"']);
    await write('backlog/docs/doc-3 - D.md', ['id: doc-3', 'title: "D"']);

    const sections = Object.fromEntries((await listProjectDocs(project)).map((doc) => [doc.id, doc.section]));
    expect(sections).toEqual({
      'decision-1': 'Агенты/HITL',
      'doc-1': 'guides/rag',
      'doc-2': 'Руководства',
      'doc-3': undefined
    });
  });

  it('при создании пишет раздел строкой в кавычках и возвращает его', async () => {
    const created = await createProjectDoc(project, { type: 'decision', title: 'Новое решение', section: 'Агенты\\HITL/' });
    expect(created.section).toBe('Агенты/HITL');
    const raw = await fs.readFile(created.filePath, 'utf-8');
    expect(raw).toContain('section: "Агенты/HITL"');

    const withoutSection = await createProjectDoc(project, { type: 'doc', title: 'Без раздела' });
    expect(withoutSection.section).toBeUndefined();
    expect(await fs.readFile(withoutSection.filePath, 'utf-8')).not.toContain('section:');
  });
});
