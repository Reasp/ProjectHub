import { describe, expect, it } from 'vitest';
import { describeMemoryFailure } from '../../src/components/docs/memoryErrorView';
import { MEMORY_STORE_ERROR_CODES } from '../../electron/services/memoryStore';
import { MEMORY_FORMAT_ERROR_CODES } from '../../electron/services/memoryFormat';
import { SECRET_KINDS } from '../../electron/services/secretPatterns';
import { ru } from '../../src/i18n/ru';
import { en } from '../../src/i18n/en';

/** Ошибки памяти проекта в интерфейсе: перевод каждого кода и текст с подробностями (TASK-76.5). */

describe('переводы кодов памяти', () => {
  for (const [lang, dict] of [['ru', ru], ['en', en]] as const) {
    it(`${lang}: у каждого кода есть непустой перевод`, () => {
      for (const code of [...MEMORY_STORE_ERROR_CODES, 'invalid_project', 'unknown']) expect(dict.memory.errors[code], code).toBeTruthy();
      for (const code of MEMORY_FORMAT_ERROR_CODES) expect(dict.memory.issues[code], code).toBeTruthy();
      for (const kind of SECRET_KINDS) expect(dict.memory.secretKinds[kind], kind).toBeTruthy();
    });
  }

  it('наборы ключей ru и en совпадают, осиротевших нет', () => {
    for (const group of ['errors', 'issues', 'secretKinds'] as const) {
      expect(Object.keys(ru.memory[group]).sort()).toEqual(Object.keys(en.memory[group]).sort());
    }
    expect(Object.keys(ru.memory.issues).sort()).toEqual([...MEMORY_FORMAT_ERROR_CODES].sort());
    expect(Object.keys(ru.memory.secretKinds).sort()).toEqual([...SECRET_KINDS].sort());
    expect(Object.keys(ru.memory.errors).sort()).toEqual([...MEMORY_STORE_ERROR_CODES, 'invalid_project', 'unknown'].sort());
  });
});

describe('describeMemoryFailure', () => {
  const s = ru.memory;

  it('секрет — виды находок словами, без значений', () => {
    const text = describeMemoryFailure(s, { error: 'x', errorCode: 'secret_detected', details: { secretKinds: ['provider_key', 'jwt'] } });
    expect(text).toBe('В тексте похоже на секрет (ключ провайдера LLM, JWT) — уберите значение и сохраните снова');
  });

  it('проблемы формата без повторов, дубликат с id и заголовком', () => {
    expect(
      describeMemoryFailure(s, {
        error: 'x',
        errorCode: 'invalid_draft',
        details: { issues: [{ code: 'missing_title', field: 'title' }, { code: 'multiline_field', field: 'title' }, { code: 'multiline_field', field: 'description' }] }
      })
    ).toBe('Факт не прошёл проверку: нет заголовка; поле должно быть одной строкой');
    expect(describeMemoryFailure(s, { error: 'x', errorCode: 'duplicate', details: { duplicateOf: 'mem-3', duplicateTitle: 'Сборка' } })).toContain(
      'mem-3 «Сборка»'
    );
  });

  it('известный код без подробностей и неизвестная ошибка', () => {
    expect(describeMemoryFailure(s, { error: 'x', errorCode: 'not_found' })).toBe(s.errors.not_found);
    expect(describeMemoryFailure(s, { error: 'EACCES: permission denied' })).toBe('Операция с памятью не удалась: EACCES: permission denied');
  });
});
