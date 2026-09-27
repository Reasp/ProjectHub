import path from 'node:path';

/**
 * Снимок задачи Backlog.md и разница снимков для события шины `task:updated`
 * (TASK-74, decision-52 п. 2). Чистый модуль: вотчер читает frontmatter, а что именно
 * изменилось — решает здесь, чтобы это проверялось тестами без файловой системы.
 */

export interface TaskSnapshot {
  taskId: string;
  title: string;
  status: string;
  assignee: string[];
  labels: string[];
}

export interface TaskChanges {
  status?: { from: string; to: string };
  assignee?: { from: string[]; to: string[] };
}

export interface TaskUpdate {
  snapshot: TaskSnapshot;
  /** Файл задачи появился впервые (или вотчер видит его впервые). */
  created: boolean;
  changes: TaskChanges;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function toList(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(toText).filter(Boolean);
}

/** Идентификатор задачи: `id` из frontmatter, иначе из имени файла `task-12 - …md`. */
export function taskIdFromFile(data: Record<string, unknown>, filePath: string): string {
  const id = toText(data.id);
  if (id) return id;
  const base = path.basename(filePath, '.md');
  const match = base.match(/^task-(\d+(?:\.\d+)*)/i);
  return match ? `TASK-${match[1]}` : base.split(' - ')[0].trim();
}

/** Снимок из frontmatter; `null` для файла без понятного id. */
export function taskSnapshotFromFrontmatter(data: Record<string, unknown>, filePath: string): TaskSnapshot | null {
  const taskId = taskIdFromFile(data, filePath);
  if (!taskId) return null;
  return {
    taskId,
    title: toText(data.title) || taskId,
    status: toText(data.status),
    assignee: toList(data.assignee),
    labels: toList(data.labels)
  };
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Что изменилось между снимками. Обновление возвращается всегда — даже без изменений статуса и
 * исполнителя: встроенное правило назначенных задач реагирует на любое изменение файла, как
 * прежний прямой вызов из вотчера (decision-52 п. 7).
 */
export function diffTaskSnapshot(prev: TaskSnapshot | undefined, next: TaskSnapshot): TaskUpdate {
  const changes: TaskChanges = {};
  if (!prev) {
    if (next.assignee.length) changes.assignee = { from: [], to: [...next.assignee] };
    return { snapshot: next, created: true, changes };
  }
  if (prev.status.toLowerCase() !== next.status.toLowerCase()) {
    changes.status = { from: prev.status, to: next.status };
  }
  if (!sameList(prev.assignee, next.assignee)) {
    changes.assignee = { from: [...prev.assignee], to: [...next.assignee] };
  }
  return { snapshot: next, created: false, changes };
}

/** Исполнители, которых не было до изменения (для триггера `task.assigned`). */
export function addedAssignees(changes: TaskChanges): string[] {
  if (!changes.assignee) return [];
  const before = new Set(changes.assignee.from.map((a) => a.toLowerCase()));
  return changes.assignee.to.filter((a) => !before.has(a.toLowerCase()));
}
