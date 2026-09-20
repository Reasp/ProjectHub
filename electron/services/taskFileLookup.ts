/**
 * Поиск файла задачи Backlog.md по id (`TASK-64`, `task-64`, `64`) — общая логика,
 * которую раньше дублировали `prService.syncBacklogOnPRCreated` и (теперь) `contextBuilder`.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';

export interface TaskFileMatch {
  filePath: string;
  data: Record<string, unknown>;
  content: string;
}

/**
 * Префикс имени файла (`task-64`, `task-80.1`) из произвольного написания id, либо `null`,
 * если номер не найден. Номер подзадачи берётся целиком с точками: иначе `TASK-80.1` свёлся бы
 * к `task-80` и нашёл файл родителя (TASK-80).
 */
export function taskIdToFilePrefix(taskId: string): string | null {
  const match = taskId.match(/(\d+(?:\.\d+)*)/);
  return match ? `task-${match[1]}`.toLowerCase() : null;
}

export async function findTaskFile(projectPath: string, taskId: string): Promise<TaskFileMatch | null> {
  const prefix = taskIdToFilePrefix(taskId);
  if (!prefix) return null;

  const tasksDir = path.join(projectPath, 'backlog', 'tasks');
  if (!existsSync(tasksDir)) return null;

  const files = await fs.readdir(tasksDir);
  for (const file of files) {
    // После номера обязан идти разделитель: иначе `task-8` нашёл бы `task-80`, а `task-80` —
    // файл подзадачи `task-80.1`.
    const lower = file.toLowerCase();
    const boundary = lower.charAt(prefix.length);
    const separated = boundary !== '' && !/[\d.]/.test(boundary);
    if (lower.startsWith(prefix) && separated && file.endsWith('.md')) {
      const filePath = path.join(tasksDir, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw.replace(/\r\n/g, '\n'));
      return { filePath, data: { ...parsed.data }, content: parsed.content };
    }
  }
  return null;
}
