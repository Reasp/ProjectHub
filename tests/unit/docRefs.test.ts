import { describe, expect, it } from 'vitest';
import { docRefFromHref, docRefKind, headingAnchorKey, refLeaveGuards, tokenizeDocRefs } from '../../src/utils/docRefs';

const refs = (text: string) => tokenizeDocRefs(text).filter((token) => token.type === 'ref');

describe('tokenizeDocRefs', () => {
  it('строку без ссылок возвращает одним текстовым токеном', () => {
    expect(tokenizeDocRefs('Обычный текст без ссылок')).toEqual([{ type: 'text', value: 'Обычный текст без ссылок' }]);
  });

  it('разбирает [[decision-N]] вместе с окружающим текстом', () => {
    expect(tokenizeDocRefs('два исполнителя ([[decision-46]], Consequences).')).toEqual([
      { type: 'text', value: 'два исполнителя (' },
      { type: 'ref', kind: 'decision', id: 'decision-46', label: 'decision-46', wiki: true },
      { type: 'text', value: ', Consequences).' }
    ]);
  });

  it('понимает документы, задачи с подномером и память, id приводит к нижнему регистру', () => {
    expect(refs('[[doc-7]] [[TASK-70.2]] [[mem-3]]')).toEqual([
      { type: 'ref', kind: 'doc', id: 'doc-7', label: 'doc-7', wiki: true },
      { type: 'ref', kind: 'task', id: 'task-70.2', label: 'TASK-70.2', wiki: true },
      { type: 'ref', kind: 'mem', id: 'mem-3', label: 'mem-3', wiki: true }
    ]);
  });

  it('берёт подпись после вертикальной черты', () => {
    expect(refs('см. [[decision-10|единый HITL-контур]]')).toEqual([
      { type: 'ref', kind: 'decision', id: 'decision-10', label: 'единый HITL-контур', wiki: true }
    ]);
  });

  it('упоминание без скобок — ссылка с wiki: false', () => {
    expect(tokenizeDocRefs('Это TASK-103. Перевод отложили (decision-46 п. 1).')).toEqual([
      { type: 'text', value: 'Это ' },
      { type: 'ref', kind: 'task', id: 'task-103', label: 'TASK-103', wiki: false },
      { type: 'text', value: '. Перевод отложили (' },
      { type: 'ref', kind: 'decision', id: 'decision-46', label: 'decision-46', wiki: false },
      { type: 'text', value: ' п. 1).' }
    ]);
  });

  it('не считает ссылкой идентификатор в пути, имени файла и внутри слова', () => {
    expect(refs('backlog/docs/doc-7 - Аудит.md')).toEqual([]);
    expect(refs('файл task-28 - Краш-main-процесса.md')).toEqual([]);
    expect(refs('ветка task-28-fix и predecision-4')).toEqual([]);
    expect(refs('поддокумент-5')).toEqual([]);
  });

  it('неизвестные скобочные конструкции оставляет текстом', () => {
    expect(tokenizeDocRefs('[[Просто заметка]]')).toEqual([{ type: 'text', value: '[[Просто заметка]]' }]);
  });

  it('разбирает ссылку на заголовок, с подписью и без', () => {
    expect(refs('[[decision-46#Decision]] и [[doc-5#Принятое решение|как выбирали]]')).toEqual([
      { type: 'ref', kind: 'decision', id: 'decision-46', label: 'decision-46#Decision', wiki: true, anchor: 'Decision' },
      { type: 'ref', kind: 'doc', id: 'doc-5', label: 'как выбирали', wiki: true, anchor: 'Принятое решение' }
    ]);
  });

  it('пустой якорь не считает якорем, а якорь без скобок оставляет текстом', () => {
    expect(refs('[[decision-46#]]')).toEqual([
      { type: 'ref', kind: 'decision', id: 'decision-46', label: 'decision-46', wiki: true }
    ]);
    expect(tokenizeDocRefs('decision-46#Decision')).toEqual([
      { type: 'ref', kind: 'decision', id: 'decision-46', label: 'decision-46', wiki: false },
      { type: 'text', value: '#Decision' }
    ]);
  });
});

describe('headingAnchorKey', () => {
  it('не различает регистр, знаки и разметку', () => {
    expect(headingAnchorKey('Decision')).toBe('decision');
    expect(headingAnchorKey('  Принятое   решение: итог ')).toBe('принятое-решение-итог');
    expect(headingAnchorKey('принятое-решение-итог')).toBe('принятое-решение-итог');
    expect(headingAnchorKey('Поле `section` и **папка**')).toBe('поле-section-и-папка');
    expect(headingAnchorKey('—')).toBe('');
  });
});

describe('refLeaveGuards', () => {
  const ref = (kind: 'decision' | 'doc' | 'task' | 'mem', id: string) => ({ kind, id });

  it('без несохранённых правок подтверждений не требует', () => {
    expect(refLeaveGuards(ref('decision', 'decision-1'), { dirtyTaskId: null, isDocDirty: false })).toEqual([]);
  });

  it('карточка задачи с правками закрывается при переходе к любому другому объекту', () => {
    const state = { dirtyTaskId: 'TASK-7', isDocDirty: false };
    expect(refLeaveGuards(ref('decision', 'decision-1'), state)).toEqual(['task']);
    expect(refLeaveGuards(ref('mem', 'mem-1'), state)).toEqual(['task']);
    expect(refLeaveGuards(ref('task', 'task-8'), state)).toEqual(['task']);
    expect(refLeaveGuards(ref('task', 'task-7'), state)).toEqual([]);
  });

  it('изменённый документ заменяется другим документом или памятью, но не задачей и не самим собой', () => {
    const state = { dirtyTaskId: null, isDocDirty: true, selectedDocId: 'Decision-1' };
    expect(refLeaveGuards(ref('decision', 'decision-2'), state)).toEqual(['doc']);
    expect(refLeaveGuards(ref('mem', 'mem-1'), state)).toEqual(['doc']);
    expect(refLeaveGuards(ref('decision', 'decision-1'), state)).toEqual([]);
    expect(refLeaveGuards(ref('task', 'task-7'), state)).toEqual([]);
  });

  it('спрашивает и про карточку, и про документ, если теряются обе правки', () => {
    expect(
      refLeaveGuards(ref('doc', 'doc-2'), { dirtyTaskId: 'TASK-7', isDocDirty: true, selectedDocId: 'doc-1' })
    ).toEqual(['task', 'doc']);
  });
});

describe('docRefKind', () => {
  it('определяет тип по идентификатору', () => {
    expect(docRefKind('Decision-5')).toBe('decision');
    expect(docRefKind('task-70.2')).toBe('task');
    expect(docRefKind('milestone-1')).toBeNull();
  });
});

describe('docRefFromHref', () => {
  it('распознаёт относительную ссылку на файл Backlog.md', () => {
    expect(docRefFromHref('../decisions/decision-46 - Исполнитель-инструментов.md')).toMatchObject({
      kind: 'decision',
      id: 'decision-46'
    });
    expect(docRefFromHref('doc-5%20-%20RAG-Guide.md#индекс')).toMatchObject({ kind: 'doc', id: 'doc-5' });
  });

  it('якорь ссылки на файл становится ссылкой на заголовок', () => {
    expect(docRefFromHref('doc-5%20-%20RAG-Guide.md#%D0%B8%D0%BD%D0%B4%D0%B5%D0%BA%D1%81')?.anchor).toBe('индекс');
    expect(docRefFromHref('decision-46 - Исполнитель.md#Decision')?.anchor).toBe('Decision');
    expect(docRefFromHref('decision-46 - Исполнитель.md')?.anchor).toBeUndefined();
  });

  it('внешние и прочие ссылки не трогает', () => {
    expect(docRefFromHref('https://example.com/decision-46.md')).toBeNull();
    expect(docRefFromHref('README.md')).toBeNull();
    expect(docRefFromHref('assets/decision-46.png')).toBeNull();
  });
});
