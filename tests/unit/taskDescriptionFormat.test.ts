import { describe, expect, it } from 'vitest';
import { structureTaskDescription } from '../../src/utils/taskDescriptionFormat';

describe('structureTaskDescription', () => {
  it('сплошное описание агента: жирные и простые метки становятся заголовками', () => {
    const src =
      '**Исполнитель:** Claude Code, Opus 5, effort high. **Почему:** новый внешний канал публикации; цена ошибки высокая. ' +
      'Цель: Вестник автоматически уходит в Threads. Без переменных `THREADS_*` движок пишет причину в лог.';
    expect(structureTaskDescription(src)).toBe(
      [
        '### Исполнитель',
        'Claude Code, Opus 5, effort high.',
        '### Почему',
        'Новый внешний канал публикации; цена ошибки высокая.',
        '### Цель',
        'Вестник автоматически уходит в Threads. Без переменных `THREADS_*` движок пишет причину в лог.'
      ].join('\n\n')
    );
  });

  it('метка вида **Почему**: тоже распознаётся', () => {
    expect(structureTaskDescription('**Почему**: так надо.')).toBe('### Почему\n\nТак надо.');
  });

  it('текст до первой метки остаётся абзацем без заголовка', () => {
    expect(structureTaskDescription('Короткое вступление. Цель: сделать кнопку.')).toBe(
      'Короткое вступление.\n\n### Цель\n\nСделать кнопку.'
    );
  });

  it('короткое описание без меток не меняется', () => {
    const src = 'Сделать кнопку экспорта в шапке.';
    expect(structureTaskDescription(src)).toBe(src);
  });

  it('уже размеченное описание не меняется', () => {
    const cases = [
      '## Цель\n\nСделать кнопку. Цель: вторая.',
      'Первый абзац. Цель: x.\n\nВторой абзац.',
      '- пункт один\n- Цель: пункт два',
      '```\nЦель: код\n```',
      '| a | b |\n|---|---|\n| Цель: 1 | 2 |',
      '> Цель: цитата'
    ];
    for (const src of cases) expect(structureTaskDescription(src)).toBe(src);
  });

  it('пустое описание возвращается как есть', () => {
    expect(structureTaskDescription('')).toBe('');
    expect(structureTaskDescription('   ')).toBe('   ');
  });

  it('связки вроде «Например:» и слова с цифрами заголовками не становятся', () => {
    expect(structureTaskDescription('Сделать так. Например: вот так.')).toBe('Сделать так. Например: вот так.');
    expect(structureTaskDescription('Сделать так. Шаг 2: вот так.')).toBe('Сделать так. Шаг 2: вот так.');
  });

  it('двоеточия и точки внутри кода и ссылок текст не режут', () => {
    const src = 'Смотри `Цель: код. Тут` и [Цель: ссылка. Тут](http://x.y/a.b). Цель: готово.';
    expect(structureTaskDescription(src)).toBe(
      'Смотри `Цель: код. Тут` и [Цель: ссылка. Тут](http://x.y/a.b).\n\n### Цель\n\nГотово.'
    );
  });

  it('длинный текст делится на абзацы по предложениям, не длиннее порога', () => {
    const sentence = 'Это предложение описывает одну часть работы и занимает около семидесяти символов.';
    const src = Array.from({ length: 8 }, () => sentence).join(' ');
    const paragraphs = structureTaskDescription(src).split('\n\n');
    expect(paragraphs.length).toBeGreaterThan(1);
    for (const p of paragraphs) expect(p.length).toBeLessThanOrEqual(280);
    expect(paragraphs.join(' ')).toBe(src);
  });

  it('жёсткие переносы строк внутри абзаца склеиваются, CRLF понимается', () => {
    expect(structureTaskDescription('**Цель:** сделать\r\nкнопку.')).toBe('### Цель\n\nСделать кнопку.');
  });

  it('жирный текст посреди слова и со строчной буквы меткой не считается', () => {
    const src = 'Сделать **важно:** аккуратно.';
    expect(structureTaskDescription(src)).toBe(src);
  });
});
