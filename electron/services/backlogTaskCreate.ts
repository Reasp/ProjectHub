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
  /**
   * Родительская задача (`TASK-80`): создаётся подзадача `TASK-80.<n>` с `parent_task_id`
   * в frontmatter — нативный формат Backlog.md (TASK-80, decision-49 п. 1).
   */
  parentTaskId?: string;
  /** Идентификаторы задач, от которых зависит эта (`dependencies` в frontmatter). */
  dependencies?: string[];
  /** Критерии приёмки: попадают в секцию `## Acceptance Criteria` неотмеченными. */
  acceptanceCriteria?: string[];
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

    const dirs = ['tasks', 'completed', 'drafts', path.join('archive', 'tasks')];
    const fileNames: string[] = [];
    for (const dir of dirs) {
      const full = path.join(backlogDir, dir);
      if (!existsSync(full)) continue;
      fileNames.push(...(await fs.readdir(full)));
    }

    // Подзадача нумеруется внутри родителя (`task-80.3`), обычная задача — сквозным номером.
    const parentNumber = task.parentTaskId ? taskNumberFromName(task.parentTaskId) : null;
    let number: string;
    if (task.parentTaskId && parentNumber !== null) {
      const subRe = new RegExp(`^task-${parentNumber}\\.(\\d+)`, 'i');
      let maxSub = 0;
      for (const f of fileNames) {
        const m = f.match(subRe);
        const n = m ? parseInt(m[1], 10) : NaN;
        if (Number.isInteger(n) && n > maxSub) maxSub = n;
      }
      number = `${parentNumber}.${maxSub + 1}`;
    } else {
      let maxId = 0;
      for (const f of fileNames) {
        const n = taskNumberFromName(f);
        if (n !== null && n > maxId) maxId = n;
      }
      number = String(maxId + 1);
    }

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
      dependencies: task.dependencies ?? [],
      ...(task.parentTaskId ? { parent_task_id: task.parentTaskId } : {}),
      ...(task.milestone ? { milestone: task.milestone } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      type: task.type || 'task'
    };

    const body = buildTaskBody(
      task.description || '',
      (task.acceptanceCriteria ?? []).map((text) => ({ text, completed: false }))
    );
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
