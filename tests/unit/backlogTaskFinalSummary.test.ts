import { describe, it, expect } from 'vitest';
import {
  FINAL_SUMMARY_BEGIN,
  FINAL_SUMMARY_END,
  applyFinalSummary,
  parseTaskBody,
  restoreCriteriaFlags
} from '../../electron/services/backlogTaskFormat';

const body = [
  '',
  '## Description',
  '',
  '<!-- SECTION:DESCRIPTION:BEGIN -->',
  'Описание',
  '<!-- SECTION:DESCRIPTION:END -->',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [ ] #1 Первый',
  '- [x] #2 Второй',
  '- [ ] #3 Третий',
  '<!-- AC:END -->',
  ''
].join('\n');

describe('applyFinalSummary (TASK-75)', () => {
  it('добавляет секцию с нативными маркерами в конец файла', () => {
    const next = applyFinalSummary(body, 'Итог работы\nвторая строка');
    expect(next).toContain(`## Final Summary\n\n${FINAL_SUMMARY_BEGIN}\nИтог работы\nвторая строка\n${FINAL_SUMMARY_END}`);
    expect(parseTaskBody(next).criteria).toHaveLength(3);
  });

  it('заменяет существующую секцию, не дублируя её', () => {
    const once = applyFinalSummary(body, 'старый итог');
    const twice = applyFinalSummary(once, 'новый итог');
    expect(twice.match(/## Final Summary/g)).toHaveLength(1);
    expect(twice).toContain('новый итог');
    expect(twice).not.toContain('старый итог');
  });

  it('вставляет секцию перед комментариями', () => {
    const withComments = `${body}\n## Comments\n\nкомментарий\n`;
    const next = applyFinalSummary(withComments, 'итог');
    expect(next.indexOf('## Final Summary')).toBeLessThan(next.indexOf('## Comments'));
  });

  it('legacy-секция без маркеров получает маркеры', () => {
    const legacy = `${body}\n## Final Summary\n\nстарый текст\n`;
    const next = applyFinalSummary(legacy, 'итог');
    expect(next).toContain(`${FINAL_SUMMARY_BEGIN}\nитог\n${FINAL_SUMMARY_END}`);
    expect(next).not.toContain('старый текст');
  });
});

describe('restoreCriteriaFlags (AC отмечает только harness, TASK-75)', () => {
  it('возвращает отметки к эталону и не трогает тексты', () => {
    const tampered = body.replace('- [ ] #1 Первый', '- [x] #1 Первый').replace('- [x] #2 Второй', '- [ ] #2 Второй');
    const restored = restoreCriteriaFlags(tampered, [false, true, false]);
    expect(restored).not.toBeNull();
    expect(parseTaskBody(restored!).criteria).toEqual([
      { text: 'Первый', completed: false },
      { text: 'Второй', completed: true },
      { text: 'Третий', completed: false }
    ]);
  });

  it('null, если расхождений нет', () => {
    expect(restoreCriteriaFlags(body, [false, true, false])).toBeNull();
  });
});
