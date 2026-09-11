import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import type { BacklogTask, CreateDocParams, CreateMilestoneParams } from '../../src/types/electron';
import { backlogWatcher } from '../services/backlogWatcher';
import {
  parseTaskBody,
  applyDescription,
  applyCriteria,
  toggleCriterionInContent,
  sanitizeTaskFileTitle,
  taskNumberFromName,
  nowBacklogTimestamp,
  normalizeFrontmatter,
  withUpdatedDate
} from '../services/backlogTaskFormat';
import { createBacklogTaskFile } from '../services/backlogTaskCreate';
import { listProjectDocs, readDocFile, saveDocFile, createProjectDoc } from '../services/docsService';
import { listMilestones, createMilestone, saveMilestone, deleteMilestone } from '../services/milestoneService';
import { assertInsideRegisteredProject, assertRegisteredProject } from '../services/projectPathGuard';
import type { IpcContext } from './types';

function fmString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return String(value);
}

function fmStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(fmString).filter((v): v is string => v !== undefined);
}

function parseTaskFile(raw: string) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const parsed = matter(raw.replace(/\r\n/g, '\n'));
  return { eol, data: { ...parsed.data } as Record<string, unknown>, content: parsed.content };
}

function serializeTaskFile(content: string, data: Record<string, unknown>, eol: string): string {
  const text = matter.stringify(content, normalizeFrontmatter(data));
  return eol === '\n' ? text : text.replace(/\n/g, eol);
}

function taskIdFromFile(data: Record<string, unknown>, filePath: string): string {
  const fromFrontmatter = fmString(data.id);
  if (fromFrontmatter) return fromFrontmatter;
  const base = path.basename(filePath, '.md');
  const n = taskNumberFromName(base);
  return n !== null ? `TASK-${n}` : base.split(' - ')[0].trim();
}

export function registerBacklogIpc(ctx: IpcContext) {
  ipcMain.handle('backlog:watchProject', async (_event, projectPath: string) => {
    backlogWatcher.watch(projectPath, ctx.getMainWindow());
  });

  ipcMain.handle('backlog:getTasks', async (_event, projectPath: string) => {
    const tasksDir = path.join(projectPath, 'backlog', 'tasks');
    if (!existsSync(tasksDir)) return [];

    backlogWatcher.watch(projectPath, ctx.getMainWindow());

    const taskList: BacklogTask[] = [];
    try {
      const files = await fs.readdir(tasksDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(tasksDir, file);
          const raw = await fs.readFile(fullPath, 'utf-8');
          const { data, content } = parseTaskFile(raw);
          const { criteria, description } = parseTaskBody(content);

          taskList.push({
            id: taskIdFromFile(data, fullPath),
            title: fmString(data.title) || path.basename(file, '.md'),
            status: (fmString(data.status) as any) || 'To Do',
            labels: fmStringList(data.labels),
            milestone: fmString(data.milestone) || fmString(data.milestone_id) || undefined,
            assignee: fmStringList(data.assignee),
            created: fmString(data.created_date) || fmString(data.created) || undefined,
            filePath: fullPath,
            description,
            acceptanceCriteria: criteria,
            branch: fmString(data.branch),
            worktree: fmString(data.worktree),
            pr: fmString(data.pr)
          });
        }
      }
    } catch (err) {
      console.error(`Error reading tasks from ${tasksDir}:`, err);
    }

    return taskList;
  });

  ipcMain.handle('backlog:updateTaskStatus', async (_event, rawFilePath: string, newStatus: string) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      if (!existsSync(filePath)) return false;
      const { eol, data, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));
      data.status = newStatus;
      await fs.writeFile(filePath, serializeTaskFile(content, withUpdatedDate(data), eol), 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to update status for ${filePath}:`, err);
      return false;
    }
  });

  ipcMain.handle('backlog:toggleCriterion', async (_event, rawFilePath: string, index: number, completed: boolean) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      if (!existsSync(filePath)) return false;
      const { eol, data, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));
      const updated = toggleCriterionInContent(content, index, completed);
      if (updated === null) return false;
      await fs.writeFile(filePath, serializeTaskFile(updated, withUpdatedDate(data), eol), 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to toggle criterion in ${filePath}:`, err);
      return false;
    }
  });

  ipcMain.handle('backlog:saveFullTask', async (_event, rawFilePath: string, data: {
    title: string;
    status: BacklogTask['status'];
    labels: string[];
    milestone?: string;
    assignee?: string[];
    description: string;
    criteria?: Array<{ text: string; completed: boolean }>;
  }) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      if (!existsSync(filePath)) return false;
      const { eol, data: frontmatter, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));

      frontmatter.title = data.title;
      frontmatter.status = data.status;
      frontmatter.labels = data.labels;
      if (data.milestone) {
        frontmatter.milestone = data.milestone;
      } else {
        delete frontmatter.milestone;
        delete frontmatter.milestone_id;
      }
      if (data.assignee !== undefined) {
        frontmatter.assignee = data.assignee;
      }

      let body = applyDescription(content, data.description || '');
      body = applyCriteria(body, data.criteria || []);

      await fs.writeFile(filePath, serializeTaskFile(body, withUpdatedDate(frontmatter), eol), 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to save full task ${filePath}:`, err);
      return false;
    }
  });

  ipcMain.handle('backlog:deleteTask', async (_event, rawFilePath: string) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      if (!existsSync(filePath)) return false;
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      console.error(`Failed to delete task ${filePath}:`, err);
      return false;
    }
  });

  ipcMain.handle('backlog:getTaskContent', async (_event, rawFilePath: string) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      console.error(`Failed to read task ${filePath}:`, err);
      return null;
    }
  });

  ipcMain.handle('backlog:saveTask', async (_event, rawFilePath: string, content: string) => {
    const filePath = await assertInsideRegisteredProject(rawFilePath);
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to save task ${filePath}:`, err);
      return false;
    }
  });

  ipcMain.handle('backlog:createTask', async (_event, projectPath: string, task: {
    title: string;
    description: string;
    labels: string[];
    type?: string;
    priority?: string;
    milestone?: string;
  }) => {
    await assertRegisteredProject(projectPath);
    return createBacklogTaskFile(projectPath, task);
  });

  // Docs & Decisions
  ipcMain.handle('docs:list', async (_event, projectPath: string) => {
    return await listProjectDocs(projectPath);
  });

  ipcMain.handle('docs:read', async (_event, filePath: string) => {
    return await readDocFile(await assertInsideRegisteredProject(filePath));
  });

  ipcMain.handle('docs:save', async (_event, filePath: string, content: string) => {
    return await saveDocFile(await assertInsideRegisteredProject(filePath), content);
  });

  ipcMain.handle('docs:create', async (_event, projectPath: string, params: CreateDocParams) => {
    return await createProjectDoc(await assertRegisteredProject(projectPath), params);
  });

  // Milestones
  ipcMain.handle('milestones:list', async (_event, projectPath: string) => {
    return await listMilestones(projectPath);
  });

  ipcMain.handle('milestones:create', async (_event, projectPath: string, params: CreateMilestoneParams) => {
    return await createMilestone(await assertRegisteredProject(projectPath), params);
  });

  ipcMain.handle('milestones:save', async (_event, filePath: string, params: Partial<CreateMilestoneParams>) => {
    return await saveMilestone(await assertInsideRegisteredProject(filePath), params);
  });

  ipcMain.handle('milestones:delete', async (_event, filePath: string) => {
    return await deleteMilestone(await assertInsideRegisteredProject(filePath));
  });
}
