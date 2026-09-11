import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTaskFile, taskIdToFilePrefix } from '../../electron/services/taskFileLookup';

describe('taskIdToFilePrefix', () => {
  it('извлекает префикс имени файла из разных написаний id задачи', () => {
    expect(taskIdToFilePrefix('TASK-64')).toBe('task-64');
    expect(taskIdToFilePrefix('task-64')).toBe('task-64');
    expect(taskIdToFilePrefix('64')).toBe('task-64');
  });

  it('без номера в id возвращает null', () => {
    expect(taskIdToFilePrefix('no-number-here')).toBeNull();
  });
});

describe('findTaskFile', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = mkdtempSync(path.join(os.tmpdir(), 'projecthub-taskfilelookup-'));
    const tasksDir = path.join(projectPath, 'backlog', 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(
      path.join(tasksDir, 'task-64 - Context builder.md'),
      ['---', 'id: TASK-64', 'title: Context builder', 'status: To Do', '---', '', '## Description', '', 'текст'].join(
        '\n'
      ),
      'utf-8'
    );
  });

  afterEach(() => {
    if (existsSync(projectPath)) rmSync(projectPath, { recursive: true, force: true });
  });

  it('находит файл задачи по id и парсит frontmatter/тело', async () => {
    const match = await findTaskFile(projectPath, 'TASK-64');
    expect(match).not.toBeNull();
    expect(match?.data.title).toBe('Context builder');
    expect(match?.content).toContain('текст');
    expect(match?.filePath.endsWith('task-64 - Context builder.md')).toBe(true);
  });

  it('не находит несуществующую задачу', async () => {
    expect(await findTaskFile(projectPath, 'TASK-999')).toBeNull();
  });

  it('без backlog/tasks в проекте возвращает null', async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'projecthub-taskfilelookup-empty-'));
    try {
      expect(await findTaskFile(empty, 'TASK-64')).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
