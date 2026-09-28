import { describe, expect, it } from 'vitest';
import { collapseUnchanged, lineDiff, lineDiffStats } from '../../src/lib/lineDiff';

describe('lineDiff', () => {
  it('добавленные и удалённые строки, CRLF не различается', () => {
    const ops = lineDiff('a\r\nb\r\nc', 'a\nX\nc');
    expect(ops).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'X' },
      { op: 'same', text: 'c' }
    ]);
    expect(lineDiffStats(ops!)).toEqual({ added: 1, removed: 1 });
  });

  it('одинаковые тексты — только same', () => {
    expect(lineDiff('a\nb', 'a\r\nb')!.every((o) => o.op === 'same')).toBe(true);
  });

  it('вставка в середину сохраняет общие строки', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nb\nNEW\nc\nd')!.filter((o) => o.op !== 'same')).toEqual([{ op: 'add', text: 'NEW' }]);
    expect(lineDiff('x\ny\nz', 'y\nz')!.filter((o) => o.op !== 'same')).toEqual([{ op: 'del', text: 'x' }]);
  });

  it('collapseUnchanged: контекст вокруг правок, остальное — gap с числом строк', () => {
    const a = Array.from({ length: 12 }, (_, i) => `l${i}`);
    const b = [...a];
    b[6] = 'CHANGED';
    const rows = collapseUnchanged(lineDiff(a.join('\n'), b.join('\n'))!, 2);
    expect(rows).toEqual([
      { op: 'gap', count: 4 },
      { op: 'same', text: 'l4' },
      { op: 'same', text: 'l5' },
      { op: 'del', text: 'l6' },
      { op: 'add', text: 'CHANGED' },
      { op: 'same', text: 'l7' },
      { op: 'same', text: 'l8' },
      { op: 'gap', count: 3 }
    ]);
    // Одна скрытая строка не сворачивается; без правок — одна строка gap.
    expect(collapseUnchanged(lineDiff('x\na\nb', 'a\nb')!, 1)).toEqual([
      { op: 'del', text: 'x' },
      { op: 'same', text: 'a' },
      { op: 'same', text: 'b' }
    ]);
    expect(collapseUnchanged(lineDiff('a\nb\nc', 'a\nb\nc')!, 3)).toEqual([{ op: 'gap', count: 3 }]);
  });

  it('пустой текст и слишком длинный текст', () => {
    expect(lineDiff('', 'x')).toEqual([
      { op: 'del', text: '' },
      { op: 'add', text: 'x' }
    ]);
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    expect(lineDiff(long, 'x', 10)).toBeNull();
  });
});
