import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { prService } from '../../electron/services/prService';

describe('prService.syncBacklogOnPRCreated — обратная связь задача → branch/pr (TASK-64)', () => {
  let projectPath: string;
  const taskFile = 'task-8 - Something.md';

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-pr-sync-'));
    await fs.mkdir(path.join(projectPath, 'backlog', 'tasks'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'backlog', 'tasks', taskFile),
      ['---', 'id: TASK-8', 'title: Something', 'status: In Progress', "created_date: '2026-09-01 10:00'", '---', '', 'текст'].join(
        '\n'
      ),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true });
  });

  async function readTask() {
    const raw = await fs.readFile(path.join(projectPath, 'backlog', 'tasks', taskFile), 'utf-8');
    return matter(raw);
  }

  it('переводит задачу в Review и записывает branch/pr', async () => {
    await (prService as any).syncBacklogOnPRCreated(
      projectPath,
      'feat/task-8-something',
      'feat(task-8): something',
      'https://github.com/acme/repo/pull/42'
    );

    const { data } = await readTask();
    expect(data.status).toBe('Review');
    expect(data.branch).toBe('feat/task-8-something');
    expect(data.pr).toBe('https://github.com/acme/repo/pull/42');
  });

  it('не понижает статус Done обратно в Review, но branch/pr всё равно записывает', async () => {
    await fs.writeFile(
      path.join(projectPath, 'backlog', 'tasks', taskFile),
      ['---', 'id: TASK-8', 'title: Something', 'status: Done', "created_date: '2026-09-01 10:00'", '---', '', 'текст'].join('\n'),
      'utf-8'
    );

    await (prService as any).syncBacklogOnPRCreated(projectPath, 'task-8', 'task-8', 'https://github.com/acme/repo/pull/42');

    const { data } = await readTask();
    expect(data.status).toBe('Done');
    expect(data.pr).toBe('https://github.com/acme/repo/pull/42');
  });

  it('ничего не делает, если id задачи не извлекается из ветки/заголовка', async () => {
    await (prService as any).syncBacklogOnPRCreated(projectPath, 'feature/login-page', 'Add login page', 'https://x/pull/1');
    const { data } = await readTask();
    expect(data.status).toBe('In Progress');
    expect(data.pr).toBeUndefined();
  });
});
