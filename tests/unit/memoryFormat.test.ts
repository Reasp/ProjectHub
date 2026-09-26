import { describe, expect, it } from 'vitest';
import {
  MEMORY_LIMITS,
  buildMemoryFact,
  buildMemoryIndex,
  memoryFileName,
  memoryIdFromFileName,
  memoryNumber,
  nextMemoryId,
  parseMemoryFile,
  serializeMemoryFact,
  validateMemoryDraft,
  type MemoryDraft
} from '../../electron/services/memoryFormat';

/** Формат факта памяти проекта (TASK-76.1, decision-51 п. 2). */

const draft = (over: Partial<MemoryDraft> = {}): MemoryDraft => ({
  title: 'Сборка pack:win падает при открытом exe',
  description: 'Перед pack:win закрыть собранный ProjectHub.exe',
  type: 'project',
  body: 'electron-builder не может перезаписать занятый файл.\n\nПочему: exe держит блокировку.',
  ...over
});

describe('id и имена файлов', () => {
  it('читает номер и следующий id', () => {
    expect(memoryNumber('mem-12')).toBe(12);
    expect(memoryNumber('MEM-3')).toBe(3);
    expect(memoryNumber('doc-3')).toBeNull();
    expect(memoryNumber('mem-')).toBeNull();
    expect(nextMemoryId([])).toBe('mem-1');
    expect(nextMemoryId(['mem-2', 'mem-10', 'junk', 'mem-7'])).toBe('mem-11');
  });

  it('строит имя файла с ограниченным slug и читает id обратно', () => {
    expect(memoryFileName('mem-4', 'Сборка: pack/win падает!')).toBe('mem-4 - Сборка-pack-win-падает.md');
    expect(memoryFileName('mem-5', '???')).toBe('mem-5.md');
    const long = memoryFileName('mem-6', 'а'.repeat(200));
    expect(long.length).toBeLessThanOrEqual('mem-6 - '.length + MEMORY_LIMITS.slug + '.md'.length);
    expect(memoryIdFromFileName('mem-4 - Сборка-pack-win-падает.md')).toBe('mem-4');
    expect(memoryIdFromFileName('mem-5.md')).toBe('mem-5');
    expect(memoryIdFromFileName('MEMORY.md')).toBeNull();
    expect(memoryIdFromFileName('doc-1 - x.md')).toBeNull();
    expect(memoryIdFromFileName('mem-1 - x.txt')).toBeNull();
  });
});

describe('validateMemoryDraft', () => {
  it('принимает корректный черновик', () => {
    expect(validateMemoryDraft(draft())).toEqual([]);
  });

  it('требует заголовок, описание, тело и известный тип', () => {
    const codes = validateMemoryDraft(draft({ title: ' ', description: '', body: '\n\n', type: 'decision' as never })).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['missing_title', 'missing_description', 'empty_body', 'invalid_type']));
  });

  it('проверяет лимиты и однострочность', () => {
    const codes = validateMemoryDraft(
      draft({
        title: 'x'.repeat(MEMORY_LIMITS.title + 1),
        description: 'строка\nвторая',
        body: 'y'.repeat(MEMORY_LIMITS.body + 1),
        source: 's'.repeat(MEMORY_LIMITS.source + 1)
      })
    ).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['title_too_long', 'multiline_field', 'body_too_long', 'source_too_long']));
  });
});

describe('сериализация и разбор', () => {
  it('круговой проход сохраняет факт, все значения frontmatter в кавычках', () => {
    const fact = buildMemoryFact(draft({ source: 'task-76', author: 'claude-cli/developer' }), 'mem-3', '2026-09-26 13:40');
    const text = serializeMemoryFact(fact);
    expect(text).toContain('created: "2026-09-26 13:40"');
    expect(text).toContain('id: "mem-3"');
    expect(text.endsWith('\n')).toBe(true);
    const parsed = parseMemoryFile(memoryFileName('mem-3', fact.title), text);
    expect(parsed).toEqual({ ok: true, fact });
  });

  it('экранирует кавычки и двоеточия в значениях', () => {
    const fact = buildMemoryFact(draft({ title: 'Ключ "a": значение # не комментарий' }), 'mem-1', '2026-09-26 10:00');
    const parsed = parseMemoryFile('mem-1.md', serializeMemoryFact(fact));
    expect(parsed.ok && parsed.fact.title).toBe('Ключ "a": значение # не комментарий');
  });

  it('незакавыченная дата — ошибка not_a_string (правило 16)', () => {
    const text = ['---', 'id: "mem-2"', 'title: "t"', 'description: "d"', 'type: "project"', 'created: 2026-09-26', '---', '', 'тело'].join('\n');
    const parsed = parseMemoryFile('mem-2 - t.md', text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues).toContainEqual({ code: 'not_a_string', field: 'created' });
  });

  it('id должен совпадать с именем файла', () => {
    const text = serializeMemoryFact(buildMemoryFact(draft(), 'mem-2', '2026-09-26 10:00'));
    const parsed = parseMemoryFile('mem-9 - x.md', text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.map((i) => i.code)).toContain('id_mismatch');
  });

  it('отвергает файл без frontmatter и чужое имя', () => {
    expect(parseMemoryFile('mem-1.md', 'просто текст')).toEqual({ ok: false, issues: [{ code: 'invalid_frontmatter' }] });
    expect(parseMemoryFile('notes.md', '---\nid: "mem-1"\n---\n')).toEqual({ ok: false, issues: [{ code: 'invalid_file_name' }] });
  });

  it('CRLF в теле нормализуется', () => {
    const text = serializeMemoryFact(buildMemoryFact(draft(), 'mem-1', '2026-09-26 10:00')).replace(/\n/g, '\r\n');
    const parsed = parseMemoryFile('mem-1.md', text);
    expect(parsed.ok && parsed.fact.body.includes('\r')).toBe(false);
  });
});

describe('buildMemoryIndex', () => {
  it('по строке на факт в порядке номеров, ссылки на фактические файлы', () => {
    const index = buildMemoryIndex([
      { id: 'mem-10', title: 'Десятый', description: 'd10' },
      { id: 'mem-2', title: 'Второй [x]', description: 'd2', fileName: 'mem-2 - Old-name.md' }
    ]);
    const lines = index.trimEnd().split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(['- [Второй x](mem-2%20-%20Old-name.md) — d2', '- [Десятый](mem-10%20-%20Десятый.md) — d10']);
    expect(index.startsWith('# Память проекта')).toBe(true);
  });

  it('пустая память — только заголовок', () => {
    expect(buildMemoryIndex([]).split('\n').some((l) => l.startsWith('- '))).toBe(false);
  });
});
