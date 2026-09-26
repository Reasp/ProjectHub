import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Память проекта в контексте агента (TASK-76.3, decision-51 п. 6). */

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memctx-ud-'));
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}));

const {
  assembleContext,
  buildAgentContext,
  buildMemoryContextText,
  DEFAULT_CONTEXT_MAX_CHARS,
  MEMORY_CONTEXT_MAX_CHARS
} = await import('../../electron/services/contextBuilder');
const { writeMemoryFact } = await import('../../electron/services/memoryStore');

const entry = (n: number, title: string, description: string, body = `тело ${n}`) => ({
  id: `mem-${n}`,
  title,
  description,
  type: 'project' as const,
  created: '2026-09-26 10:00',
  body,
  fileName: `mem-${n}.md`
});

const FACTS = [
  entry(1, 'Сборка падает при открытом exe', 'Закрыть ProjectHub.exe перед pack:win', 'electron-builder не перезапишет занятый файл'),
  entry(2, 'Ollama виснет под нагрузкой', 'Перезапустить ollama при пустых ответах'),
  entry(3, 'Зеркало hf-mirror.com', 'huggingface.co рвёт соединение')
];

describe('assembleContext — часть memory', () => {
  it('стоит сразу после задачи', () => {
    const r = assembleContext(
      [
        { key: 'rag', text: 'doc' },
        { key: 'memory', text: 'факт' },
        { key: 'task', text: 'задача' }
      ],
      DEFAULT_CONTEXT_MAX_CHARS
    );
    expect(r.includedKeys).toEqual(['task', 'memory', 'rag']);
    expect(r.combined).toContain('## Память проекта');
  });

  it('обрезается своей долей и не вытесняет RAG', () => {
    const r = assembleContext(
      [
        { key: 'memory', text: 'м'.repeat(5000) },
        { key: 'rag', text: 'r'.repeat(1000) }
      ],
      DEFAULT_CONTEXT_MAX_CHARS
    );
    const memory = r.parts.find((p) => p.key === 'memory')!;
    expect(memory.text.length).toBeLessThanOrEqual(MEMORY_CONTEXT_MAX_CHARS + '\n…(обрезано)'.length);
    expect(r.truncatedKeys).toEqual(['memory']);
    expect(r.parts.find((p) => p.key === 'rag')!.text).toHaveLength(1000);
  });
});

describe('buildMemoryContextText', () => {
  it('релевантные задаче факты целиком, остальные строкой индекса от новых к старым', () => {
    const text = buildMemoryContextText(FACTS, 'Почему pack:win падает — exe открыт');
    expect(text).toContain('### mem-1: Сборка падает при открытом exe\nelectron-builder не перезапишет занятый файл');
    expect(text).toContain('- mem-3: Зеркало hf-mirror.com — huggingface.co рвёт соединение');
    expect(text.indexOf('- mem-3')).toBeLessThan(text.indexOf('- mem-2'));
    expect(text).not.toContain('- mem-1:');
  });

  it('без запроса — только индекс; длинное тело обрезается', () => {
    expect(buildMemoryContextText(FACTS, '')).not.toContain('###');
    const long = buildMemoryContextText([entry(9, 'Сборка', 'описание', 'x'.repeat(2000))], 'сборка', { bodyMax: 100 });
    expect(long).toContain(`${'x'.repeat(100)}…`);
  });

  it('инструкция записи — только при инструменте; пустая память без инструмента — пусто', () => {
    expect(buildMemoryContextText([], 'q')).toBe('');
    const withTool = buildMemoryContextText([], 'q', { toolPrefix: 'mcp__projecthub-hitl__memory_' });
    expect(withTool).toContain('Память проекта пока пуста.');
    expect(withTool).toContain('mcp__projecthub-hitl__memory_write');
    expect(buildMemoryContextText(FACTS, 'q')).not.toContain('memory_write');
  });
});

describe('buildAgentContext — память без задачи и в задаче', () => {
  let project: string;

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-memctx-'));
    await writeMemoryFact(project, {
      title: 'Сборка падает при открытом exe',
      description: 'Закрыть ProjectHub.exe перед pack:win',
      body: 'electron-builder не перезапишет занятый файл',
      type: 'project'
    });
  });

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  it('без задачи в контексте только память', async () => {
    const r = await buildAgentContext({ projectPath: project });
    expect(r.includedKeys).toEqual(['memory']);
    expect(r.combined).toContain('mem-1: Сборка падает при открытом exe');
  });

  it('поиск приложения находит факт с категорией memory и пропускает MEMORY.md', async () => {
    const { searchProjectDocs } = await import('../../electron/services/ragSearch');
    const hits = await searchProjectDocs({ projectPath: project, query: 'electron-builder', mode: 'text', limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ category: 'memory', heading: 'Сборка падает при открытом exe' });
    const index = await searchProjectDocs({ projectPath: project, query: 'Закрыть ProjectHub.exe', mode: 'text', limit: 10 });
    expect(index.map((h) => h.fileRelative.replace(/\\/g, '/'))).not.toContain('backlog/memory/MEMORY.md');
  });

  it('часть выключается через enabledParts', async () => {
    const r = await buildAgentContext({ projectPath: project, enabledParts: { memory: false } });
    expect(r.combined).toBe('');
  });

  it('с задачей: task, затем memory с релевантным фактом и инструкцией движка', async () => {
    await fs.mkdir(path.join(project, 'backlog', 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(project, 'backlog', 'tasks', 'task-1 - Починить-сборку.md'),
      '---\nid: TASK-1\ntitle: "Починить сборку pack:win"\nstatus: "To Do"\n---\n\n## Description\n\n<!-- SECTION:DESCRIPTION:BEGIN -->\nСборка падает, exe открыт\n<!-- SECTION:DESCRIPTION:END -->\n',
      'utf-8'
    );
    const r = await buildAgentContext({
      projectPath: project,
      taskId: 'TASK-1',
      enabledParts: { rag: false, gitnexus: false, git: false },
      memoryToolPrefix: 'memory_'
    });
    expect(r.includedKeys).toEqual(['task', 'memory']);
    const memory = r.parts.find((p) => p.key === 'memory')!.text;
    expect(memory).toContain('### mem-1: Сборка падает при открытом exe');
    expect(memory).toContain('memory_write');
  });
});
