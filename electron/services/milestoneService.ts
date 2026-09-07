import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import type { Milestone, CreateMilestoneParams } from '../../src/types/electron';

function fmString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return String(value);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\sа-яё-]/gi, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'milestone';
}

export async function listMilestones(projectPath: string): Promise<Milestone[]> {
  const milestones: Milestone[] = [];
  const normalizedProject = path.normalize(projectPath);
  const milestonesDir = path.join(normalizedProject, 'backlog', 'milestones');
  const tasksDir = path.join(normalizedProject, 'backlog', 'tasks');

  // 1. Read all tasks to aggregate counts per milestone
  const taskMap = new Map<string, { total: number; done: number; inProgress: number; review: number; todo: number }>();

  if (existsSync(tasksDir)) {
    try {
      const taskFiles = await fs.readdir(tasksDir);
      for (const tFile of taskFiles) {
        if (tFile.endsWith('.md')) {
          const tRaw = await fs.readFile(path.join(tasksDir, tFile), 'utf-8');
          const tParsed = matter(tRaw);
          const milestoneKey = tParsed.data.milestone || tParsed.data.milestone_id;
          const status = tParsed.data.status || 'To Do';

          if (milestoneKey) {
            const key = String(milestoneKey).trim().toLowerCase();
            const current = taskMap.get(key) || { total: 0, done: 0, inProgress: 0, review: 0, todo: 0 };
            current.total++;
            if (status === 'Done') current.done++;
            else if (status === 'In Progress') current.inProgress++;
            else if (status === 'Review') current.review++;
            else current.todo++;
            taskMap.set(key, current);
          }
        }
      }
    } catch (e) {
      console.error('Error scanning tasks for milestones:', e);
    }
  }

  // 2. Read milestone files
  if (existsSync(milestonesDir)) {
    try {
      const files = await fs.readdir(milestonesDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(milestonesDir, file);
          const raw = await fs.readFile(fullPath, 'utf-8');
          const { data, content } = matter(raw);

          const id = fmString(data.id) || file.replace(/\.md$/, '').split('-')[0].trim();
          const title = fmString(data.title) || file.replace(/\.md$/, '');
          const status = (fmString(data.status) as any) || 'Planning';
          const targetDate = fmString(data.target_date) || fmString(data.targetDate) || fmString(data.due_date);
          const description = fmString(data.description) || content.trim();

          const keyById = id.toLowerCase();
          const keyByTitle = title.toLowerCase();
          const counts = taskMap.get(keyById) || taskMap.get(keyByTitle) || {
            total: 0,
            done: 0,
            inProgress: 0,
            review: 0,
            todo: 0
          };

          milestones.push({
            id,
            title,
            description,
            targetDate: targetDate ? String(targetDate) : undefined,
            status,
            filePath: fullPath,
            taskCounts: counts
          });
        }
      }
    } catch (e) {
      console.error('Error reading milestones directory:', e);
    }
  }

  return milestones;
}

export async function createMilestone(
  projectPath: string,
  params: CreateMilestoneParams
): Promise<Milestone> {
  const normalizedProject = path.normalize(projectPath);
  const milestonesDir = path.join(normalizedProject, 'backlog', 'milestones');
  await fs.mkdir(milestonesDir, { recursive: true });

  const title = params.title.trim();
  const slug = slugify(title);

  // Determine next milestone ID
  let nextNum = 1;
  try {
    const existing = await fs.readdir(milestonesDir);
    for (const f of existing) {
      const match = f.match(/milestone-(\d+)/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n >= nextNum) nextNum = n + 1;
      }
    }
  } catch (e) {
    // ignore
  }

  const id = `milestone-${nextNum}`;
  const filename = `${id} - ${slug}.md`;
  const fullPath = path.join(milestonesDir, filename);

  const frontmatter: Record<string, any> = {
    id,
    title,
    status: params.status || 'Planning',
    created_date: new Date().toISOString().split('T')[0]
  };

  if (params.targetDate) {
    frontmatter.target_date = params.targetDate;
  }
  if (params.description) {
    frontmatter.description = params.description;
  }

  const body = `\n# ${title}\n\n${params.description || 'Описание майлстоуна'}\n`;
  const fileContent = matter.stringify(body, frontmatter);

  await fs.writeFile(fullPath, fileContent, 'utf-8');

  return {
    id,
    title,
    description: params.description,
    targetDate: params.targetDate,
    status: params.status || 'Planning',
    filePath: fullPath,
    taskCounts: { total: 0, done: 0, inProgress: 0, review: 0, todo: 0 }
  };
}

export async function saveMilestone(
  filePath: string,
  params: Partial<CreateMilestoneParams>
): Promise<boolean> {
  const normalized = path.normalize(filePath);
  if (!existsSync(normalized)) return false;

  const raw = await fs.readFile(normalized, 'utf-8');
  const parsed = matter(raw);

  if (params.title) parsed.data.title = params.title;
  if (params.status) parsed.data.status = params.status;
  if (params.targetDate !== undefined) parsed.data.target_date = params.targetDate;
  if (params.description !== undefined) parsed.data.description = params.description;

  const updated = matter.stringify(parsed.content, parsed.data);
  await fs.writeFile(normalized, updated, 'utf-8');
  return true;
}

export async function deleteMilestone(filePath: string): Promise<boolean> {
  const normalized = path.normalize(filePath);
  if (!existsSync(normalized)) return false;
  await fs.unlink(normalized);
  return true;
}
