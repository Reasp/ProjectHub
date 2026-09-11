import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { buildTaskBody, nowBacklogTimestamp, parseTaskBody, sanitizeTaskFileTitle, taskNumberFromName } from './backlogTaskFormat';

export interface CreateBacklogTaskInput {
  title: string;
  description: string;
  labels: string[];
  type?: string;
  priority?: string;
  milestone?: string;
}

export interface CreatedBacklogTask {
  id: string;
  title: string;
  status: 'To Do';
  labels: string[];
  milestone?: string;
  created: string;
  filePath: string;
  description: string;
  acceptanceCriteria: ReturnType<typeof parseTaskBody>['criteria'];
}

/**
 * Создаёт файл задачи Backlog.md в проекте. Общая логика для IPC (`backlogIpc.ts`) и Remote
 * Control RPC `create_task` (TASK-65) — во избежание дублирования нумерации/frontmatter.
 */
export async function createBacklogTaskFile(projectPath: string, task: CreateBacklogTaskInput): Promise<CreatedBacklogTask | null> {
  try {
    const backlogDir = path.join(projectPath, 'backlog');
    const tasksDir = path.join(backlogDir, 'tasks');
    if (!existsSync(tasksDir)) {
      await fs.mkdir(tasksDir, { recursive: true });
    }

    let maxId = 0;
    for (const dir of ['tasks', 'completed', 'drafts', path.join('archive', 'tasks')]) {
      const full = path.join(backlogDir, dir);
      if (!existsSync(full)) continue;
      for (const f of await fs.readdir(full)) {
        const n = taskNumberFromName(f);
        if (n !== null && n > maxId) maxId = n;
      }
    }

    const number = maxId + 1;
    const id = `TASK-${number}`;
    const fileName = `task-${number} - ${sanitizeTaskFileTitle(task.title) || 'task'}.md`;
    const fullPath = path.join(tasksDir, fileName);
    const createdDate = nowBacklogTimestamp();
    const labels = task.labels || [];

    const frontmatter: Record<string, unknown> = {
      id,
      title: task.title,
      status: 'To Do',
      assignee: [],
      created_date: createdDate,
      labels,
      dependencies: [],
      ...(task.milestone ? { milestone: task.milestone } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      type: task.type || 'task'
    };

    const body = buildTaskBody(task.description || '');
    await fs.writeFile(fullPath, matter.stringify(body, frontmatter), { encoding: 'utf-8', flag: 'wx' });
    const { criteria, description } = parseTaskBody(body);

    return {
      id,
      title: task.title,
      status: 'To Do',
      labels,
      milestone: task.milestone,
      created: createdDate,
      filePath: fullPath,
      description,
      acceptanceCriteria: criteria
    };
  } catch (err) {
    console.error('Failed to create task:', err);
    return null;
  }
}
