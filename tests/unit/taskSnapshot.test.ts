import { describe, expect, it } from 'vitest';
import { addedAssignees, diffTaskSnapshot, taskIdFromFile, taskSnapshotFromFrontmatter } from '../../electron/services/taskSnapshot';

/** Снимки задач для события `task:updated` (TASK-74, decision-52 п. 2). */

const FILE = 'C:/p/backlog/tasks/task-12 - Сделать-вещь.md';

describe('taskSnapshotFromFrontmatter', () => {
  it('берёт id из frontmatter, иначе из имени файла (включая подзадачи)', () => {
    expect(taskIdFromFile({ id: 'TASK-7' }, FILE)).toBe('TASK-7');
    expect(taskIdFromFile({}, FILE)).toBe('TASK-12');
    expect(taskIdFromFile({}, 'C:/p/backlog/tasks/task-74.3 - Подзадача.md')).toBe('TASK-74.3');
  });

  it('приводит значения к строкам и спискам', () => {
    const snap = taskSnapshotFromFrontmatter(
      { id: 'TASK-12', title: 'Вещь', status: 'To Do', assignee: 'agent:dev@h1', labels: ['a', new Date('2026-09-03T00:00:00Z')] },
      FILE
    );
    expect(snap).toEqual({ taskId: 'TASK-12', title: 'Вещь', status: 'To Do', assignee: ['agent:dev@h1'], labels: ['a', '2026-09-03'] });
    expect(taskSnapshotFromFrontmatter({}, FILE)?.assignee).toEqual([]);
  });
});

describe('diffTaskSnapshot', () => {
  const base = { taskId: 'TASK-12', title: 'Вещь', status: 'To Do', assignee: [] as string[], labels: [] as string[] };

  it('новая задача: created, назначение считается добавленным, статус — нет', () => {
    const update = diffTaskSnapshot(undefined, { ...base, assignee: ['agent:dev@h1'] });
    expect(update.created).toBe(true);
    expect(update.changes.status).toBeUndefined();
    expect(addedAssignees(update.changes)).toEqual(['agent:dev@h1']);
  });

  it('изменение статуса и исполнителя; регистр статуса не считается изменением', () => {
    const update = diffTaskSnapshot({ ...base, assignee: ['@ivan'] }, { ...base, status: 'Review', assignee: ['@ivan', 'agent:qa'] });
    expect(update.changes.status).toEqual({ from: 'To Do', to: 'Review' });
    expect(addedAssignees(update.changes)).toEqual(['agent:qa']);
    expect(diffTaskSnapshot(base, { ...base, status: 'to do' }).changes).toEqual({});
  });

  it('без изменений обновление всё равно возвращается (встроенное правило реагирует на любое изменение)', () => {
    const update = diffTaskSnapshot(base, { ...base, title: 'Новое имя' });
    expect(update).toMatchObject({ created: false, changes: {} });
    expect(update.snapshot.title).toBe('Новое имя');
  });

  it('порядок исполнителей не важен', () => {
    expect(diffTaskSnapshot({ ...base, assignee: ['a', 'b'] }, { ...base, assignee: ['b', 'a'] }).changes.assignee).toBeUndefined();
  });
});
