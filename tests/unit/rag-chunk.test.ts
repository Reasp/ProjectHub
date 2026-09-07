import { describe, expect, it } from 'vitest';
// @ts-expect-error — инфраструктурный скрипт без типов
import { chunkMarkdown, splitFrontmatter, stripBinaryBlobs } from '../../scripts/rag/chunk.mjs';

const doc = `---
id: doc-9
title: "Тестовый документ"
type: guide
---

# Тестовый документ

${'Вводный абзац документа, достаточно длинный, чтобы не склеиваться со следующим разделом. '.repeat(4).trim()}

## 1. Раздел без текста

### 1.1. Подраздел

Текст подраздела про архитектуру.

## 2. Модуль

#### Назначение
Одно предложение.

#### Функции
- первая
- вторая
`;

describe('splitFrontmatter', () => {
  it('снимает frontmatter и достаёт title без кавычек', () => {
    const { title, body } = splitFrontmatter(doc);
    expect(title).toBe('Тестовый документ');
    expect(body.startsWith('\n# Тестовый документ')).toBe(true);
    expect(body).not.toContain('id: doc-9');
  });

  it('без frontmatter возвращает текст как есть', () => {
    expect(splitFrontmatter('# A\n\ntext')).toEqual({ title: '', body: '# A\n\ntext' });
  });
});

describe('chunkMarkdown', () => {
  const chunks = chunkMarkdown(doc);

  it('не создаёт чанков из frontmatter и из заголовков без текста', () => {
    expect(chunks.some((c: any) => c.text.includes('id: doc-9'))).toBe(false);
    expect(chunks.every((c: any) => c.text.trim().length > 0)).toBe(true);
    expect(chunks.some((c: any) => /^#{1,6}\s[^\n]*$/.test(c.text.trim()))).toBe(false);
  });

  it('заголовок чанка — путь заголовков, включая пустой родительский раздел', () => {
    const sub = chunks.find((c: any) => c.text.includes('Текст подраздела'));
    expect(sub.heading).toBe('Тестовый документ › 1. Раздел без текста › 1.1. Подраздел');
  });

  it('склеивает мелкие соседние блоки под общим родителем', () => {
    const merged = chunks.find((c: any) => c.text.includes('Одно предложение.'));
    expect(merged.text).toContain('#### Назначение');
    expect(merged.text).toContain('#### Функции');
    expect(merged.heading).toBe('Тестовый документ › 2. Модуль');
  });

  it('embedText содержит контекст заголовков, но не дублирует title, совпадающий с H1', () => {
    const sub = chunks.find((c: any) => c.text.includes('Текст подраздела'));
    expect(sub.embedText.startsWith('Тестовый документ › 1. Раздел без текста › 1.1. Подраздел\n\n')).toBe(true);
    expect(sub.embedText).not.toContain('Тестовый документ › Тестовый документ');
  });

  it('короткий вводный абзац раздела склеивается с подразделом, заголовок — сам раздел', () => {
    const out = chunkMarkdown('# Док\n\n## Раздел\n\nКоротко.\n\n### Подраздел\n\nТекст подраздела.\n');
    expect(out).toHaveLength(1);
    expect(out[0].heading).toBe('Док › Раздел');
    expect(out[0].text).toContain('### Подраздел');
  });

  it('заголовки внутри code fence не считаются заголовками', () => {
    const md = '# A\n\n```sh\n# comment\necho 1\n```\n';
    const out = chunkMarkdown(md);
    expect(out).toHaveLength(1);
    expect(out[0].heading).toBe('A');
    expect(out[0].text).toContain('# comment');
  });

  it('режет длинные блоки на куски не больше 1000 символов с перекрытием', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Абзац ${i} ${'слово '.repeat(40)}`.trim());
    const out = chunkMarkdown(`# Длинный\n\n${paragraphs.join('\n\n')}`);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c: any) => c.text.length <= 1000)).toBe(true);
    expect(out.every((c: any) => c.heading === 'Длинный')).toBe(true);
  });
});

describe('stripBinaryBlobs', () => {
  it('заменяет data-URI картинки маркером, сохраняя alt', () => {
    const blob = 'A'.repeat(3000);
    const md = `![Иконка](data:image/png;base64,${blob}) текст <img src="data:image/jpeg;base64,${blob}">`;
    const out = stripBinaryBlobs(md);
    expect(out).toBe('![Иконка](data-uri) текст <img src="data-uri">');
  });

  it('индекс не раздувается от документа с встроенными картинками', () => {
    const md = `# Иконки\n\n${Array.from({ length: 20 }, (_, i) => `![#${i}](data:image/png;base64,${'Q'.repeat(20000)})\n\nОписание ${i}.`).join('\n\n')}`;
    expect(chunkMarkdown(md).length).toBeLessThan(5);
  });
});
