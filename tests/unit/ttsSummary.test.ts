import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTS_SUMMARY_MAX_CHARS,
  hasSpeakableContent,
  summarizeForSpeech
} from '../../src/services/ttsSummary';

describe('summarizeForSpeech: ответ агента к озвучке (TASK-83, AC #3)', () => {
  it('блоки кода не читаются вслух', () => {
    const answer = 'Готово.\n\n```ts\nconst x = 1;\nconsole.log(x);\n```\n\nПроверь тесты.';
    expect(summarizeForSpeech(answer)).toBe('Готово. Проверь тесты.');
  });

  it('незакрытая ограда отрезает хвост: ответ мог оборваться на полуслове', () => {
    expect(summarizeForSpeech('Вот код:\n```ts\nconst a = 1;')).toBe('Вот код:');
  });

  it('служебные строки диффа выбрасываются, а пункты списка остаются', () => {
    const answer = [
      'Изменил два файла.',
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,4 +1,6 @@',
      '+++ b/src/a.ts',
      '- Первый пункт',
      '- Второй пункт'
    ].join('\n');
    const spoken = summarizeForSpeech(answer);
    expect(spoken).toContain('Изменил два файла.');
    expect(spoken).toContain('Первый пункт');
    expect(spoken).toContain('Второй пункт');
    expect(spoken).not.toContain('diff --git');
    expect(spoken).not.toContain('@@');
  });

  it('таблицы и горизонтальные линии не озвучиваются', () => {
    const answer = 'Итог ниже.\n\n| Файл | Строк |\n| --- | --- |\n| a.ts | 12 |\n\n---\n\nГотово.';
    const spoken = summarizeForSpeech(answer);
    expect(spoken).toBe('Итог ниже. Готово.');
  });

  it('разметка снимается, текст ссылок сохраняется, картинки выбрасываются', () => {
    expect(summarizeForSpeech('## Заголовок\n\nСмотри [документацию](http://example.com/doc).')).toBe(
      'Заголовок Смотри документацию.'
    );
    expect(summarizeForSpeech('![схема](assets/a.png)\n\nВсё собралось.')).toBe('Всё собралось.');
    expect(summarizeForSpeech('Запусти `npm run build` и жди.')).toBe('Запусти npm run build и жди.');
    expect(summarizeForSpeech('Это **важно** и *срочно*.')).toBe('Это важно и срочно.');
    expect(summarizeForSpeech('> Цитата агента')).toBe('Цитата агента');
  });

  it('обрезка идёт по границе предложения', () => {
    const answer = 'Первое предложение. Второе предложение. Третье.';
    expect(summarizeForSpeech(answer, { maxChars: 30 })).toBe('Первое предложение.');
  });

  it('без границы предложения обрезаем по слову и ставим многоточие', () => {
    const spoken = summarizeForSpeech('ААА БББ ВВВ ГГГ ДДД', { maxChars: 10 });
    expect(spoken).toBe('ААА БББ…');
  });

  it('короткий текст не трогаем', () => {
    expect(summarizeForSpeech('Готово.')).toBe('Готово.');
    expect(DEFAULT_TTS_SUMMARY_MAX_CHARS).toBeGreaterThan(100);
  });

  it('ответ из одного кода озвучивать нечем', () => {
    expect(summarizeForSpeech('```ts\nconst a = 1;\n```')).toBe('');
    expect(summarizeForSpeech('')).toBe('');
    expect(summarizeForSpeech('   \n\n  ')).toBe('');
  });

  it('hasSpeakableContent отличает текст от чистого кода', () => {
    expect(hasSpeakableContent('Готово.')).toBe(true);
    expect(hasSpeakableContent('```ts\nconst a = 1;\n```')).toBe(false);
    expect(hasSpeakableContent('')).toBe(false);
  });
});
