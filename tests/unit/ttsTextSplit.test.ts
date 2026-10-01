import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_CHARS,
  normalizeTtsText,
  splitTextForStreamingTts,
  splitTextForTts,
  STREAMING_FIRST_MAX_CHARS,
  STREAMING_MAX_CHARS
} from '../../electron/services/ttsTextSplit';

const MARKDOWN_SAMPLE = [
  '## Заголовок раздела',
  '',
  'Это **жирный** текст и `код` внутри строки.',
  '',
  '- первый пункт',
  '* второй пункт',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  'Смотри [документацию](https://example.com/docs) позже.'
].join('\n');

describe('ttsTextSplit — разбиение на предложения (TASK-69)', () => {
  it('режет текст по точке, восклицательному и вопросительному знакам и многоточию', () => {
    expect(splitTextForTts('Привет. Как дела? Отлично! Вот так…')).toEqual([
      'Привет.',
      'Как дела?',
      'Отлично!',
      'Вот так…'
    ]);
  });

  it('перевод строки считается границей фрагмента', () => {
    expect(splitTextForTts('Первая строка\nВторая строка\n\nТретья строка')).toEqual([
      'Первая строка',
      'Вторая строка',
      'Третья строка'
    ]);
  });

  it('подряд идущие знаки конца не дробят предложение', () => {
    expect(splitTextForTts('Что?! Ничего страшного.')).toEqual(['Что?!', 'Ничего страшного.']);
  });

  it('точка внутри числа не считается концом предложения', () => {
    expect(splitTextForTts('Число 3.14 знакомо всем. Конец.')).toEqual([
      'Число 3.14 знакомо всем.',
      'Конец.'
    ]);
    expect(splitTextForTts('Версия 1.2.3 вышла вчера.')).toEqual(['Версия 1.2.3 вышла вчера.']);
  });

  it('известное сокращение не обрывает предложение', () => {
    expect(splitTextForTts('Яблоки, груши и т.д. Потом всё стало ясно.')).toHaveLength(1);
    expect(splitTextForTts('См. рис. 5 внизу страницы.')).toEqual(['См. рис. 5 внизу страницы.']);
  });

  it('инициалы не обрывают предложение', () => {
    expect(splitTextForTts('А. С. Пушкин написал это.')).toEqual(['А. С. Пушкин написал это.']);
  });
});

describe('ttsTextSplit — лимит длины фрагмента (TASK-69)', () => {
  it('длинное предложение без знаков конца режется по лимиту без потери слов', () => {
    const long = Array.from({ length: 60 }, (_, i) => `слово${i % 10}`).join(' ');
    const parts = splitTextForTts(long, 50);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(50);
    // режем по пробелам, слова целиком: склейка восстанавливает исходный текст
    expect(parts.join(' ')).toBe(long);
  });

  it('разрез предпочитает запятую, а не ближайший пробел', () => {
    const text = 'Мы долго шли по узкой тропе через густой лес, а потом вышли к реке и увидели мост.';
    const parts = splitTextForTts(text, 50);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toBe('Мы долго шли по узкой тропе через густой лес,');
    expect(parts[0].endsWith(',')).toBe(true);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(50);
  });

  it('точка с запятой тоже считается местом мягкого переноса', () => {
    const text = 'Первая часть длинной фразы без точки в конце; вторая часть длинной фразы идёт следом';
    const parts = splitTextForTts(text, 55);

    expect(parts[0].endsWith(';')).toBe(true);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(55);
  });

  it('текст без пробелов и знаков режется жёстко по лимиту', () => {
    const parts = splitTextForTts('а'.repeat(500), 40);

    expect(parts.length).toBe(Math.ceil(500 / 40));
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(40);
    expect(parts.join('')).toBe('а'.repeat(500));
  });

  it('по умолчанию фрагмент не длиннее DEFAULT_MAX_CHARS', () => {
    expect(DEFAULT_MAX_CHARS).toBeGreaterThan(0);
    const parts = splitTextForTts('слово '.repeat(500));

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(DEFAULT_MAX_CHARS);
  });
});

describe('ttsTextSplit — normalizeTtsText убирает разметку (TASK-69)', () => {
  it('из ссылки остаётся только текст', () => {
    expect(normalizeTtsText('Смотри [документацию](https://example.com) внимательно.')).toBe(
      'Смотри документацию внимательно.'
    );
    expect(normalizeTtsText('Картинка ![схема](assets/x.png) тут.')).toBe('Картинка схема тут.');
  });

  it('эмфаза и инлайн-код читаются без символов разметки', () => {
    expect(normalizeTtsText('Это **важно** и `код` тут.')).toBe('Это важно и код тут.');
    expect(normalizeTtsText('Совсем *другое* дело.')).toBe('Совсем другое дело.');
  });

  it('заголовки, цитаты и маркеры списка снимаются', () => {
    expect(normalizeTtsText('## Заголовок')).toBe('Заголовок');
    expect(normalizeTtsText('- пункт списка')).toBe('пункт списка');
    expect(normalizeTtsText('* пункт списка')).toBe('пункт списка');
    expect(normalizeTtsText('> цитата')).toBe('цитата');
  });

  it('блок кода не попадает в озвучку', () => {
    const out = normalizeTtsText('До кода\n```js\nconst x = 1;\n```\nПосле кода');

    expect(out).toContain('До кода');
    expect(out).toContain('После кода');
    expect(out).not.toContain('const');
    expect(out).not.toContain('```');
  });

  it('смешанная разметка полностью очищается', () => {
    const out = normalizeTtsText(MARKDOWN_SAMPLE);

    expect(out).toContain('Заголовок раздела');
    expect(out).toContain('Это жирный текст и код внутри строки.');
    expect(out).toContain('первый пункт');
    expect(out).toContain('второй пункт');
    expect(out).toContain('Смотри документацию позже.');

    expect(out).not.toContain('#');
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('const x = 1');
  });
});

/** Предложение заданной длины с точкой на конце. */
function sentence(word: string, chars: number): string {
  const body = `${word} ${'а'.repeat(Math.max(1, chars - word.length - 2))}`;
  return `${body.slice(0, chars - 1)}.`;
}

describe('ttsTextSplit — абзацы в нормализации (TASK-116)', () => {
  it('пустая строка между абзацами остаётся одной, строки внутри абзаца — переводом строки', () => {
    expect(normalizeTtsText('Первый.\n\n\n\nВторой  \n  третий.')).toBe('Первый.\n\nВторой\nтретий.');
  });

  it('блок кода между абзацами не склеивает их', () => {
    expect(normalizeTtsText('До.\n\n```js\nx\n```\n\nПосле.')).toBe('До.\n\nПосле.');
  });

  it('Piper по-прежнему режет по каждому переводу строки и предложению (AC #2)', () => {
    expect(splitTextForTts('Раз. Два.\n\nТри\nЧетыре.')).toEqual(['Раз.', 'Два.', 'Три', 'Четыре.']);
  });
});

describe('ttsTextSplit — нарастающие фрагменты для Qwen3-TTS (TASK-116, AC #1)', () => {
  it('первый фрагмент — одно-два коротких предложения, остальное абзаца — одним фрагментом', () => {
    const text = 'Готово. Сборка прошла. Тесты зелёные. Линтер чистый. Индекс обновлён.';
    expect(splitTextForStreamingTts(text)).toEqual([
      'Готово. Сборка прошла.',
      'Тесты зелёные. Линтер чистый. Индекс обновлён.'
    ]);
  });

  it('длинное первое предложение уходит одно', () => {
    const first = sentence('Первое', 155);
    const text = `${first} Второе. Третье.`;
    expect(splitTextForStreamingTts(text)).toEqual([first, 'Второе. Третье.']);
  });

  it('фрагмент заканчивается с абзацем, если абзац не короче порога', () => {
    const a = sentence('Альфа', 100);
    const b = sentence('Бета', 100);
    const c = sentence('Гамма', 100);
    const text = `Вступление.\n\n${a} ${b}\n\n${c}`;
    expect(splitTextForStreamingTts(text)).toEqual(['Вступление.', `${a} ${b}`, c]);
  });

  it('короткие абзацы копятся в один фрагмент, а не дают стык на каждой фразе', () => {
    const text = 'Начало.\n\nКороткий абзац.\n\nЕщё один.\n\nИ последний.';
    expect(splitTextForStreamingTts(text)).toEqual(['Начало.', 'Короткий абзац. Ещё один. И последний.']);
  });

  it('по пределу длины режется на границе предложения, а не посреди него', () => {
    const sentences = Array.from({ length: 12 }, (_, i) => sentence(`Номер${i}`, 90));
    const fragments = splitTextForStreamingTts(sentences.join(' '));

    expect(fragments[0]).toBe(sentences[0]);
    for (const fragment of fragments) {
      expect(fragment.length).toBeLessThanOrEqual(STREAMING_MAX_CHARS);
      expect(fragment.endsWith('.')).toBe(true);
    }
    // ни одно предложение не разрезано и не потеряно
    expect(fragments.join(' ')).toBe(sentences.join(' '));
    // фрагменты крупные: в каждый, кроме первого и последнего, влезло больше половины потолка
    for (const fragment of fragments.slice(1, -1)) expect(fragment.length).toBeGreaterThan(STREAMING_MAX_CHARS / 2);
  });

  it('предложение длиннее потолка режется по знакам препинания и не прилипает к соседям', () => {
    const long = 'Длинное ' + Array.from({ length: 40 }, (_, i) => `часть${i}, и ещё`).join(' ') + '.';
    const text = `Начало. Перед длинным. ${long} После.`;
    const fragments = splitTextForStreamingTts(text, { maxChars: 200 });

    expect(fragments[0]).toBe('Начало. Перед длинным.');
    expect(fragments[1].startsWith('Длинное часть0,')).toBe(true);
    for (const fragment of fragments) expect(fragment.length).toBeLessThanOrEqual(200);
    expect(fragments.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });

  it('пункты списка без знаков в конце склеиваются через точку — на слух это пауза', () => {
    const text = 'Сделал:\n- обновил нарезку\n- поправил таймаут\n\nВсё.';
    expect(splitTextForStreamingTts(text, { firstMaxChars: 10 })).toEqual([
      'Сделал:',
      'обновил нарезку. поправил таймаут. Всё.'
    ]);
  });

  it('потолки по умолчанию: первый короче остальных', () => {
    expect(STREAMING_FIRST_MAX_CHARS).toBeLessThan(STREAMING_MAX_CHARS);
    expect(STREAMING_MAX_CHARS).toBeGreaterThan(DEFAULT_MAX_CHARS);
  });

  it('пустой текст и чистый код — нет фрагментов; одно предложение — один фрагмент', () => {
    expect(splitTextForStreamingTts('')).toEqual([]);
    expect(splitTextForStreamingTts('\n\n \t')).toEqual([]);
    expect(splitTextForStreamingTts('```\nconst x = 1;\n```')).toEqual([]);
    expect(splitTextForStreamingTts('Готово.')).toEqual(['Готово.']);
  });

  it('фрагменты не пустые и без пробелов по краям', () => {
    for (const input of [MARKDOWN_SAMPLE, 'Раз.  Два.   Три.', '---\n\n* пункт\n\n', 'а'.repeat(1500)]) {
      for (const chunk of splitTextForStreamingTts(input)) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.trim()).toBe(chunk);
        expect(chunk.length).toBeLessThanOrEqual(STREAMING_MAX_CHARS);
      }
    }
  });
});

describe('ttsTextSplit — пустые и вырожденные входы (TASK-69)', () => {
  it('пустая строка и строка из пробелов дают пустой массив', () => {
    expect(splitTextForTts('')).toEqual([]);
    expect(splitTextForTts('   ')).toEqual([]);
    expect(splitTextForTts('\n\n \t \n')).toEqual([]);
    expect(normalizeTtsText('')).toBe('');
    expect(normalizeTtsText('   \n  ')).toBe('');
  });

  it('текст из одного блока кода нечего озвучивать', () => {
    expect(splitTextForTts('```\nconst x = 1;\n```')).toEqual([]);
  });

  it('результат никогда не содержит пустых фрагментов', () => {
    const inputs = [
      MARKDOWN_SAMPLE,
      'Раз.  Два.   Три.',
      '---\n\n* пункт\n\n',
      '\n\nТекст после пустых строк.\n\n\n',
      'а'.repeat(500),
      'Привет. Как дела? Отлично! Вот так…'
    ];

    for (const input of inputs) {
      for (const chunk of splitTextForTts(input, 40)) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.trim()).toBe(chunk);
        expect(chunk.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
