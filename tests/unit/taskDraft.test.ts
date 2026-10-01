import { describe, expect, it } from 'vitest';
import { isTaskDraftDirty, type TaskDraft } from '../../src/utils/taskDraft';

const saved: TaskDraft = {
  title: 'Задача',
  status: 'To Do',
  milestone: '',
  assignee: '',
  description: 'Описание',
  labels: ['ui'],
  criteria: ['Первый', 'Второй']
};

describe('isTaskDraftDirty', () => {
  it('форма без правок чистая', () => {
    expect(isTaskDraftDirty(saved, { ...saved, labels: ['ui'], criteria: ['Первый', 'Второй'] })).toBe(false);
  });

  it('пробелы вокруг исполнителя правкой не считаются: при сохранении они обрезаются', () => {
    expect(isTaskDraftDirty(saved, { ...saved, assignee: '  ' })).toBe(false);
  });

  it.each([
    ['заголовок', { title: 'Другая' }],
    ['статус', { status: 'In Progress' }],
    ['майлстоун', { milestone: 'm-1' }],
    ['исполнитель', { assignee: '@agent:dev' }],
    ['описание', { description: 'Описание со ссылкой [[decision-1]]' }],
    ['метки', { labels: ['ui', 'backlog'] }],
    ['добавленный критерий', { criteria: ['Первый', 'Второй', 'Третий'] }],
    ['удалённый критерий', { criteria: ['Первый'] }]
  ] as Array<[string, Partial<TaskDraft>]>)('замечает правку: %s', (_name, patch) => {
    expect(isTaskDraftDirty(saved, { ...saved, ...patch })).toBe(true);
  });
});
