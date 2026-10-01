import { describe, expect, it } from 'vitest';
import { buildDocLinkIndex, collectHeadingKeys, collectRefTargets, type DocLinkSource } from '../../src/utils/docBacklinks';

const doc = (id: string, body: string, extra: Partial<DocLinkSource> = {}): DocLinkSource => ({
  id,
  kind: id.toLowerCase().startsWith('task') ? 'task' : id.startsWith('doc') ? 'doc' : 'decision',
  title: `Заголовок ${id}`,
  content: ['---', `id: ${id}`, '---', '', body].join('\n'),
  ...extra
});

describe('collectRefTargets', () => {
  it('собирает ссылки в скобках, упоминания и ссылки на файлы, без повторов', () => {
    const text = [
      '## Context',
      'См. [[decision-3]] и [[doc-5#Индекс|раздел про индекс]], а также TASK-12.',
      '- пункт с decision-3 ещё раз',
      '| Что | Где |',
      '| --- | --- |',
      '| формат | [файл](../decisions/decision-9 - Формат.md) |'
    ].join('\n');
    expect(collectRefTargets(text).sort()).toEqual(['decision-3', 'decision-9', 'doc-5', 'task-12']);
  });

  it('не считает ссылкой примеры в коде и идентификаторы во frontmatter', () => {
    const text = [
      '---',
      'id: decision-1',
      'dependencies: [TASK-4]',
      '---',
      'Пример записи: `[[decision-7]]`.',
      '```md',
      '[[decision-8]]',
      '```',
      'Путь backlog/docs/doc-2 - Аудит.md ссылкой не считается.'
    ].join('\n');
    expect(collectRefTargets(text)).toEqual([]);
  });
});

describe('collectHeadingKeys', () => {
  it('возвращает ключи заголовков, пропуская заголовки внутри блоков кода', () => {
    const text = ['# Решение', '## Context', '```md', '## Не заголовок', '```', '## Принятое решение', '## Context'].join('\n');
    expect(collectHeadingKeys(text)).toEqual(['решение', 'context', 'принятое-решение']);
  });
});

describe('buildDocLinkIndex', () => {
  const sources = [
    doc('decision-1', '## Decision\nОснова.'),
    doc('decision-2', 'Уточняет [[decision-1]] и сам себя: [[decision-2]].', { status: 'accepted' }),
    doc('doc-3', 'Аудит: decision-1 и несуществующее [[decision-99]].'),
    doc('TASK-10', 'Реализует [[decision-1#Decision]].', { status: 'Done' }),
    doc('TASK-2', 'Тоже про [[decision-1]] и про [[TASK-10]].')
  ];
  const index = buildDocLinkIndex(sources);

  it('перечисляет источники по видам и номерам: решения, документы, задачи', () => {
    expect(index.backlinks['decision-1']).toEqual([
      { id: 'decision-2', kind: 'decision', title: 'Заголовок decision-2', status: 'accepted' },
      { id: 'doc-3', kind: 'doc', title: 'Заголовок doc-3' },
      { id: 'TASK-2', kind: 'task', title: 'Заголовок TASK-2' },
      { id: 'TASK-10', kind: 'task', title: 'Заголовок TASK-10', status: 'Done' }
    ]);
  });

  it('не учитывает ссылку на себя, несуществующие документы и ссылки на задачи', () => {
    expect(index.backlinks['decision-2']).toBeUndefined();
    expect(index.backlinks['decision-99']).toBeUndefined();
    expect(index.backlinks['task-10']).toBeUndefined();
  });

  it('факты памяти идут после задач и сами целью обратных ссылок не становятся', () => {
    const withMemory = buildDocLinkIndex([
      ...sources,
      doc('mem-2', 'Почему так: [[decision-1]].', { kind: 'mem' }),
      doc('mem-1', 'Договорённость из decision-1, см. также [[mem-2]].', { kind: 'mem' })
    ]);
    expect(withMemory.backlinks['decision-1'].map((item) => item.id)).toEqual([
      'decision-2',
      'doc-3',
      'TASK-2',
      'TASK-10',
      'mem-1',
      'mem-2'
    ]);
    expect(withMemory.backlinks['mem-2']).toBeUndefined();
    expect(withMemory.headings['mem-1']).toBeUndefined();
  });

  it('хранит заголовки только для решений и документов', () => {
    expect(index.headings['decision-1']).toEqual(['decision']);
    expect(index.headings['doc-3']).toEqual([]);
    expect(index.headings['task-10']).toBeUndefined();
  });
});
