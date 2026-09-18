import { describe, expect, it } from 'vitest';
import { editDistance, isFuzzyDictationStop, normalizeSpokenPhrase } from '../../src/services/dictationStopMatch';

describe('normalizeSpokenPhrase', () => {
  it('приводит регистр, ё и убирает пунктуацию', () => {
    expect(normalizeSpokenPhrase('  Конец, диктовки!..  ')).toBe('конец диктовки');
    expect(normalizeSpokenPhrase('Всё — «ДИКТОВКА»')).toBe('все диктовка');
  });
});

describe('editDistance', () => {
  it('считает расстояние Левенштейна', () => {
    expect(editDistance('конец', 'коронец')).toBe(2);
    expect(editDistance('диктовки', 'диктовке')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});

describe('isFuzzyDictationStop: искажённая стоп-фраза выключает диктовку (TASK-98)', () => {
  it.each([
    // живой прогон TASK-83 s12c и офлайн-искажения s12.wav (шум, подрезка начала VAD)
    'Коронец диктовки.',
    'Конец диктухней.',
    'конец диктохни.',
    'и конец диктовки.',
    'Конец диктовки!',
    'конец диктовке',
    'Конец диктовки',
    'стоп диктовку',
    'Выключи диктовку.',
    'закончит диктовку',
    'Stop dictation.',
    'end dictations'
  ])('«%s» — стоп', (text) => {
    expect(isFuzzyDictationStop(text)).toBe(true);
  });

  it('учитывает пользовательские стоп-фразы', () => {
    const custom = { dictation_stop: ['хватит диктовки'], dictation_start: ['диктовка'] };
    expect(isFuzzyDictationStop('Хватит диктовке.', custom)).toBe(true);
    expect(isFuzzyDictationStop('Коронец диктовки.', custom)).toBe(false);
  });
});

describe('isFuzzyDictationStop: обычный текст печатается', () => {
  it.each([
    'В диктовке было три ошибки.',
    'Конец диктовки был скомкан, поэтому перепишем абзац.',
    'Сегодня пишем диктовку по русскому языку',
    'диктовка',
    'Начало диктовки.',
    'Не конец диктовки.',
    'и диктовка',
    'в диктовке',
    'Включи диктовку',
    'Коронец',
    'Конец главы',
    'Коронец рассказа.',
    '',
    '...'
  ])('«%s» — не стоп', (text) => {
    expect(isFuzzyDictationStop(text)).toBe(false);
  });

  it('без якоря «диктовк…» нечёткое совпадение не засчитывается', () => {
    expect(isFuzzyDictationStop('коронец истории', { dictation_stop: ['конец истории'] })).toBe(false);
    expect(isFuzzyDictationStop('Конец истории.', { dictation_stop: ['конец истории'] })).toBe(true);
  });
});
