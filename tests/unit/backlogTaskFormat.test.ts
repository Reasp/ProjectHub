import { describe, expect, it } from 'vitest';
import {
  applyCriteria,
  applyDescription,
  buildTaskBody,
  parseTaskBody,
  sanitizeTaskFileTitle,
  taskNumberFromName,
  toggleCriterionInContent
} from '../../electron/services/backlogTaskFormat';

const NATIVE_BODY = `
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Первая строка описания.

Вторая строка.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Добавлен vitest
- [x] #2 Добавлен ESLint
- [ ] #3 Логгер
<!-- AC:END -->

## Implementation Notes

- [ ] это не критерий, а чекбокс в заметках
`;

const LEGACY_BODY = `
## Description

Старое описание без маркеров.

## Acceptance Criteria

- [x] критерий раз
- [ ] критерий два

## Notes

- [ ] чужой чекбокс
`;

describe('parseTaskBody', () => {
  it('нативный формат: описание между маркерами, критерии без префикса #N и только внутри AC-блока', () => {
    const { description, criteria } = parseTaskBody(NATIVE_BODY);
    expect(description).toBe('Первая строка описания.\n\nВторая строка.');
    expect(criteria).toEqual([
      { text: 'Добавлен vitest', completed: false },
      { text: 'Добавлен ESLint', completed: true },
      { text: 'Логгер', completed: false }
    ]);
  });

  it('legacy-формат без маркеров: fallback по заголовкам секций', () => {
    const { description, criteria } = parseTaskBody(LEGACY_BODY);
    expect(description).toBe('Старое описание без маркеров.');
    expect(criteria).toEqual([
      { text: 'критерий раз', completed: true },
      { text: 'критерий два', completed: false }
    ]);
  });

  it('пустое тело и тело без секций → пустое описание и нет критериев', () => {
    expect(parseTaskBody('')).toEqual({ description: '', criteria: [] });
    expect(parseTaskBody('## Notes\n\nпросто текст\n')).toEqual({ description: '', criteria: [] });
  });

  it('roundtrip: buildTaskBody → parseTaskBody', () => {
    const body = buildTaskBody('Описание\nв две строки', [
      { text: 'один', completed: false },
      { text: 'два', completed: true }
    ]);
    expect(body).toContain('- [ ] #1 один');
    expect(body).toContain('- [x] #2 два');
    expect(parseTaskBody(body)).toEqual({
      description: 'Описание\nв две строки',
      criteria: [
        { text: 'один', completed: false },
        { text: 'два', completed: true }
      ]
    });
  });
});

describe('toggleCriterionInContent / applyCriteria / applyDescription', () => {
  it('переключает только нужный чекбокс внутри AC-блока', () => {
    const toggled = toggleCriterionInContent(NATIVE_BODY, 0, true);
    expect(toggled).not.toBeNull();
    expect(toggled).toContain('- [x] #1 Добавлен vitest');
    expect(toggled).toContain('- [x] #2 Добавлен ESLint');
    expect(toggled).toContain('- [ ] это не критерий');
    expect(parseTaskBody(toggled!).criteria[0].completed).toBe(true);
  });

  it('индекс вне диапазона и тело без критериев → null', () => {
    expect(toggleCriterionInContent(NATIVE_BODY, 3, true)).toBeNull();
    expect(toggleCriterionInContent('## Notes\n- [ ] x\n', 0, true)).toBeNull();
  });

  it('applyCriteria перенумеровывает #N и не трогает другие секции', () => {
    const updated = applyCriteria(NATIVE_BODY, [
      { text: 'новый', completed: true },
      { text: 'ещё', completed: false }
    ]);
    expect(updated).toContain('- [x] #1 новый');
    expect(updated).toContain('- [ ] #2 ещё');
    expect(updated).not.toContain('#3');
    expect(updated).toContain('## Implementation Notes');
    expect(parseTaskBody(updated).description).toBe('Первая строка описания.\n\nВторая строка.');
  });

  it('applyDescription приводит legacy-файл к нативному формату с маркерами', () => {
    const updated = applyDescription(LEGACY_BODY, 'Новое описание');
    expect(updated).toContain('<!-- SECTION:DESCRIPTION:BEGIN -->\nНовое описание\n<!-- SECTION:DESCRIPTION:END -->');
    expect(parseTaskBody(updated).description).toBe('Новое описание');
    expect(parseTaskBody(updated).criteria).toHaveLength(2);
  });
});

describe('taskNumberFromName / sanitizeTaskFileTitle', () => {
  it('номер задачи из имени файла и id', () => {
    expect(taskNumberFromName('task-12 - Заголовок.md')).toBe(12);
    expect(taskNumberFromName('TASK-7')).toBe(7);
    expect(taskNumberFromName('doc-3 - x.md')).toBeNull();
    expect(taskNumberFromName('')).toBeNull();
  });

  it('заголовок → безопасная часть имени файла', () => {
    expect(sanitizeTaskFileTitle('Инфра: vitest / ESLint  test')).toBe('Инфра-vitest-ESLint-test');
    expect(sanitizeTaskFileTitle('  --a\\b--  ')).toBe('a-b');
    expect(sanitizeTaskFileTitle('v1.2_ok')).toBe('v1.2_ok');
  });
});
