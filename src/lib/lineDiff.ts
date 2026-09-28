/**
 * Построчный дифф двух версий текста (LCS) — для сравнения копий `SKILL.md` в менеджере скиллов (TASK-105).
 * Чистая функция без зависимостей: работает и в рендерере, и в тестах.
 */
export type LineDiffOp = { op: 'same' | 'add' | 'del'; text: string };

/** Больше строк в одной из версий — дифф не строится. */
export const LINE_DIFF_MAX_LINES = 3000;
/** Предел таблицы LCS (строки × строки расходящейся середины), ~16 МБ. */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * `del` — строка есть только в `a`, `add` — только в `b`. Окончания строк не различаются.
 * Для слишком длинных текстов возвращает null — тогда версии показываются целиком.
 */
export function lineDiff(a: string, b: string, maxLines = LINE_DIFF_MAX_LINES): LineDiffOp[] | null {
  const la = a.replace(/\r\n/g, '\n').split('\n');
  const lb = b.replace(/\r\n/g, '\n').split('\n');
  if (la.length > maxLines || lb.length > maxLines) return null;
  // Общие начало и конец не участвуют в таблице LCS.
  let start = 0;
  while (start < la.length && start < lb.length && la[start] === lb[start]) start++;
  let endA = la.length;
  let endB = lb.length;
  while (endA > start && endB > start && la[endA - 1] === lb[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = la.slice(start, endA);
  const midB = lb.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_DIFF_CELLS) return null;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: LineDiffOp[] = la.slice(0, start).map((text) => ({ op: 'same' as const, text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ op: 'same', text: midA[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: 'del', text: midA[i++] });
    } else {
      ops.push({ op: 'add', text: midB[j++] });
    }
  }
  while (i < n) ops.push({ op: 'del', text: midA[i++] });
  while (j < m) ops.push({ op: 'add', text: midB[j++] });
  for (const text of la.slice(endA)) ops.push({ op: 'same', text });
  return ops;
}

export type LineDiffRow = LineDiffOp | { op: 'gap'; count: number };

/**
 * Для показа: неизменённые строки дальше `context` от ближайшей правки сворачиваются в `gap` с их числом.
 * Одиночную скрытую строку сворачивать бессмысленно — она остаётся как есть.
 */
export function collapseUnchanged(ops: LineDiffOp[], context = 3): LineDiffRow[] {
  const keep = ops.map(() => false);
  ops.forEach((o, i) => {
    if (o.op === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const rows: LineDiffRow[] = [];
  for (let i = 0; i < ops.length; ) {
    if (keep[i]) {
      rows.push(ops[i++]);
      continue;
    }
    let j = i;
    while (j < ops.length && !keep[j]) j++;
    if (j - i === 1) rows.push(ops[i]);
    else rows.push({ op: 'gap', count: j - i });
    i = j;
  }
  return rows;
}

/** Сводка диффа: сколько строк добавлено и удалено. */
export function lineDiffStats(ops: LineDiffOp[]): { added: number; removed: number } {
  return { added: ops.filter((o) => o.op === 'add').length, removed: ops.filter((o) => o.op === 'del').length };
}
