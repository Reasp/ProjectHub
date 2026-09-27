import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppBusEvent } from '../../electron/services/hitlTypes';
import { TaskEventSource } from '../../electron/services/taskEventSource';

/**
 * Источник `task:updated` (TASK-74, decision-52 п. 2): снимок задач на старте наблюдения, разница
 * при изменении файла, наблюдение только за нужными проектами. Вотчер подменён — файлы настоящие.
 */

let root: string;
let tasksDir: string;
const events: AppBusEvent[] = [];
const watchers: { dir: string; closed: boolean; handlers: Record<string, (fp: string) => void> }[] = [];

function makeSource() {
  return new TaskEventSource(
    (e) => events.push(e),
    (dir) => {
      const w = { dir, closed: false, handlers: {} as Record<string, (fp: string) => void> };
      watchers.push(w);
      return {
        on: (event: string, listener: (fp: string) => void) => {
          w.handlers[event] = listener;
          return undefined;
        },
        close: () => {
          w.closed = true;
        }
      };
    }
  );
}

const task = (status: string, assignee = '') =>
  ['---', 'id: TASK-1', 'title: "Первая"', `status: "${status}"`, assignee ? `assignee: ["${assignee}"]` : 'assignee: []', 'labels: ["backend"]', '---', '', 'Текст'].join('\n');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-task-events-'));
  tasksDir = path.join(root, 'backlog', 'tasks');
  await fs.mkdir(tasksDir, { recursive: true });
  events.length = 0;
  watchers.length = 0;
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('TaskEventSource', () => {
  it('существующая задача при изменении даёт изменение статуса, а не создание', async () => {
    const file = path.join(tasksDir, 'task-1 - Первая.md');
    await fs.writeFile(file, task('In Progress'), 'utf8');
    const source = makeSource();
    source.setProjects([root]);
    await source.whenReady();
    expect(watchers[0].dir).toBe(tasksDir);

    await fs.writeFile(file, task('Review', 'agent:qa@h1'), 'utf8');
    await source.ingest(root, file);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'task:updated',
      projectPath: root,
      taskId: 'TASK-1',
      status: 'Review',
      labels: ['backend'],
      created: false,
      changes: { status: { from: 'In Progress', to: 'Review' }, assignee: { from: [], to: ['agent:qa@h1'] } }
    });
  });

  it('новый файл — created; не-markdown и чужой проект игнорируются', async () => {
    const source = makeSource();
    source.setProjects([root]);
    await source.whenReady();
    const file = path.join(tasksDir, 'task-1 - Первая.md');
    await fs.writeFile(file, task('To Do', 'agent:dev@h1'), 'utf8');
    await source.ingest(root, file);
    await source.ingest(root, path.join(tasksDir, 'notes.txt'));
    await source.ingest(path.join(root, 'other'), file);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ created: true, changes: { assignee: { from: [], to: ['agent:dev@h1'] } } });
  });

  it('setProjects закрывает вотчеры ненужных проектов и не дублирует нужные', async () => {
    const source = makeSource();
    source.setProjects([root]);
    source.setProjects([root]);
    expect(watchers).toHaveLength(1);
    source.setProjects([]);
    expect(watchers[0].closed).toBe(true);
    expect(source.watchedRoots()).toEqual([]);
  });
});
