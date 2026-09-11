import { describe, expect, it } from 'vitest';
import { assembleContext, DEFAULT_CONTEXT_MAX_CHARS } from '../../electron/services/contextBuilder';

describe('assembleContext — приоритет и обрезка по бюджету символов (TASK-64)', () => {
  it('включает все части и сохраняет порядок task > rag > gitnexus > git', () => {
    const result = assembleContext(
      [
        { key: 'git', text: 'Ветка: main' },
        { key: 'task', text: '**TASK-1: Заголовок**' },
        { key: 'gitnexus', text: 'callers: foo()' },
        { key: 'rag', text: '- doc-1: сниппет' }
      ],
      DEFAULT_CONTEXT_MAX_CHARS
    );

    expect(result.includedKeys).toEqual(['task', 'rag', 'gitnexus', 'git']);
    expect(result.truncatedKeys).toEqual([]);
    expect(result.combined).toContain('## Текущая задача');
    expect(result.combined.indexOf('Текущая задача')).toBeLessThan(result.combined.indexOf('Git-статус'));
  });

  it('пропускает пустые/пробельные части', () => {
    const result = assembleContext(
      [
        { key: 'task', text: '  ' },
        { key: 'rag', text: '' },
        { key: 'git', text: 'Ветка: main' }
      ],
      DEFAULT_CONTEXT_MAX_CHARS
    );
    expect(result.includedKeys).toEqual(['git']);
  });

  it('пустой список частей даёт пустой результат без ошибок', () => {
    const result = assembleContext([], DEFAULT_CONTEXT_MAX_CHARS);
    expect(result.combined).toBe('');
    expect(result.includedKeys).toEqual([]);
    expect(result.truncatedKeys).toEqual([]);
  });

  it('пропускает младшую по приоритету часть целиком, если под неё не остаётся бюджета', () => {
    const shortText = 'x'.repeat(30);
    const longText = 'y'.repeat(1000);
    const result = assembleContext(
      [
        { key: 'task', text: shortText },
        { key: 'git', text: longText }
      ],
      60
    );

    expect(result.includedKeys).toEqual(['task']);
    expect(result.truncatedKeys).toEqual(['git']);
  });

  it('обрезает содержимое части, если она не помещается целиком, но бюджет ещё есть', () => {
    const longText = 'a'.repeat(500);
    const result = assembleContext([{ key: 'task', text: longText }], 100);

    expect(result.includedKeys).toEqual(['task']);
    expect(result.truncatedKeys).toEqual(['task']);
    expect(result.parts[0].text.length).toBeLessThan(longText.length);
    expect(result.parts[0].text).toContain('обрезано');
  });

  it('maxChars=0 — ничего не помещается, всё считается обрезанным', () => {
    const result = assembleContext([{ key: 'task', text: 'что-то' }], 0);
    expect(result.includedKeys).toEqual([]);
    expect(result.truncatedKeys).toEqual(['task']);
  });
});
