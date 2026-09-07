import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from '../../src/components/common/markdownBlocks';

describe('parseMarkdownBlocks', () => {
  it('срезает YAML frontmatter и разбирает заголовки разных уровней', () => {
    const blocks = parseMarkdownBlocks('---\nid: doc-1\ntitle: "X"\n---\n\n# Заголовок\n\n### Подраздел\n');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, raw: 'Заголовок' },
      { type: 'heading', level: 3, raw: 'Подраздел' }
    ]);
  });

  it('код с языком, без языка и mermaid; незакрытый блок читается до конца', () => {
    const blocks = parseMarkdownBlocks('```ts\nconst a = 1;\n```\n```\nplain\n```\n```mermaid\ngraph TD; A-->B\n```\n```js\nunclosed');
    expect(blocks).toEqual([
      { type: 'code', lang: 'ts', code: 'const a = 1;' },
      { type: 'code', lang: 'text', code: 'plain' },
      { type: 'mermaid', code: 'graph TD; A-->B' },
      { type: 'code', lang: 'js', code: 'unclosed' }
    ]);
  });

  it('GitHub-alert и обычная цитата', () => {
    const blocks = parseMarkdownBlocks('> [!WARNING] Осторожно\n> вторая строка\n\n> просто цитата\n> ещё\n');
    expect(blocks).toEqual([
      { type: 'alert', alertType: 'warning', alertTitle: 'WARNING', alertContent: 'Осторожно\nвторая строка' },
      { type: 'blockquote', raw: 'просто цитата\nещё' }
    ]);
  });

  it('таблица: заголовки и строки без внешних «|»; строка без разделителя — не таблица', () => {
    const blocks = parseMarkdownBlocks('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n| не таблица |\n');
    expect(blocks[0]).toEqual({ type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] });
    expect(blocks[1]).toEqual({ type: 'paragraph', raw: '| не таблица |' });
  });

  it('списки: маркированный и нумерованный, разделитель и абзацы', () => {
    const blocks = parseMarkdownBlocks('- один\n* два\n\n1. первый\n2. второй\n\n---\n\nАбзац\nв две строки\n\nВторой абзац\n');
    expect(blocks).toEqual([
      { type: 'list', items: ['один', 'два'], ordered: false },
      { type: 'list', items: ['первый', 'второй'], ordered: true },
      { type: 'hr' },
      { type: 'paragraph', raw: 'Абзац\nв две строки' },
      { type: 'paragraph', raw: 'Второй абзац' }
    ]);
  });

  it('абзац прерывается следующим блоком без пустой строки', () => {
    const blocks = parseMarkdownBlocks('текст\n## Заголовок\nещё текст\n- пункт\n');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph', 'list']);
  });

  it('пустой текст → нет блоков', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks('\n\n')).toEqual([]);
  });
});
