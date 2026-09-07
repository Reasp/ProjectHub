const MAX_CHARS = 1000;
const MIN_CHARS = 250;
const OVERLAP = 150;

// Версия алгоритма разбиения: пишется в meta.json, чтобы check-index требовал пересборку
// индекса при изменении логики чанкинга (иначе старый индекс молча останется с прежними чанками).
export const CHUNKER_VERSION = 2;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Снимает YAML frontmatter и вытаскивает из него title (без полноценного YAML-парсера —
 * достаточно строки `title: ...`). Frontmatter в индекс не попадает: как отдельный чанк он
 * лишь засорял выдачу (id/даты/теги), а title полезен как контекст для каждого чанка документа.
 */
export function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { title: '', body: text };
  const titleLine = m[1].split(/\r?\n/).find((l) => /^title:\s*/.test(l));
  let title = titleLine ? titleLine.replace(/^title:\s*/, '').trim() : '';
  if (/^(["']).*\1$/.test(title)) title = title.slice(1, -1);
  return { title, body: text.slice(m[0].length) };
}

/**
 * Режем markdown по заголовкам, для каждого блока храним «хлебные крошки» — путь заголовков
 * от корня документа (`Раздел › Подраздел › Пункт`). Заголовки без собственного текста
 * отдельными чанками не становятся (раньше они давали пустые результаты поиска), а лишь
 * попадают в путь дочерних чанков. Соседние мелкие блоки под одним родителем склеиваются,
 * чтобы «#### Назначение — одно предложение» не отрывалось от своего «#### Функции».
 *
 * Возвращает [{ heading, text, embedText }]: `text` — что показывать человеку/агенту,
 * `embedText` — что кодировать (title + путь заголовков + текст), чтобы вектор знал контекст.
 */
export function chunkMarkdown(source, options = {}) {
  const { title: fmTitle, body } = splitFrontmatter(source);
  const title = fmTitle || options.title || '';

  const blocks = collectBlocks(stripBinaryBlobs(body));
  const merged = mergeSmallBlocks(blocks);

  const chunks = [];
  for (const block of merged) {
    const heading = block.path.join(' › ');
    // H1 документа обычно повторяет title из frontmatter — не дублируем его в контексте.
    const context =
      block.path[0]?.toLowerCase() === title.toLowerCase()
        ? heading
        : [title, heading].filter(Boolean).join(' › ');
    for (const piece of splitLong(block.text)) {
      chunks.push({ heading, text: piece, embedText: context ? `${context}\n\n${piece}` : piece });
    }
  }
  return chunks;
}

// Встроенные картинки (data:image/...;base64,...) и прочие длинные base64-блобы в индекс не
// нужны: один документ с иконками давал ~950 чанков base64-мусора из ~1000 всего. Оставляем
// alt-текст и маркер, чтобы было понятно, что здесь была картинка.
export function stripBinaryBlobs(text) {
  return text
    .replace(/\(\s*data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]+\)/gi, '(data-uri)')
    .replace(/(["'])\s*data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]+\1/gi, '$1data-uri$1')
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '[base64]');
}

function collectBlocks(body) {
  const lines = body.split(/\r?\n/);
  const stack = []; // [{ level, title }]
  const blocks = [];
  let buffer = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ path: stack.map((s) => s.title), level: stack.at(-1)?.level ?? 0, text });
    buffer = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const m = !inFence && line.match(HEADING_RE);
    if (m) {
      flush();
      const level = m[1].length;
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

function samePrefix(a, b, len) {
  if (a.length < len || b.length < len) return false;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

function commonPrefix(a, b) {
  const out = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]);
  return out;
}

function mergeSmallBlocks(blocks) {
  const out = [];
  let acc = null;

  for (const block of blocks) {
    if (acc) {
      const parentLen = Math.max(0, acc.path.length - 1);
      const sibling = block.path.length === acc.path.length && samePrefix(acc.path, block.path, parentLen);
      const child = block.path.length > acc.path.length && samePrefix(acc.path, block.path, acc.path.length);
      const withHeading = `${'#'.repeat(block.level || 1)} ${block.path.at(-1) ?? ''}\n${block.text}`;
      if (
        acc.text.length < MIN_CHARS &&
        (sibling || child) &&
        acc.text.length + withHeading.length + 2 <= MAX_CHARS
      ) {
        acc = {
          // У склеенного чанка заголовок — общий префикс путей (для соседей — родитель, для
          // «вводный абзац + подраздел» — сам раздел); свои подзаголовки остаются в тексте.
          path: commonPrefix(acc.path, block.path),
          level: acc.level,
          text: acc.merged
            ? `${acc.text}\n\n${withHeading}`
            : `${'#'.repeat(acc.level || 1)} ${acc.ownTitle}\n${acc.text}\n\n${withHeading}`,
          merged: true,
        };
        continue;
      }
      out.push(acc);
    }
    acc = { path: block.path, level: block.level, text: block.text, ownTitle: block.path.at(-1) ?? '' };
  }
  if (acc) out.push(acc);
  return out.map(({ path, text }) => ({ path, text }));
}

function splitLong(text) {
  if (text.length <= MAX_CHARS) return [text];
  const pieces = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHARS, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n\n', end);
      const line = text.lastIndexOf('\n', end);
      if (paragraph > start + MAX_CHARS * 0.4) end = paragraph;
      else if (line > start + MAX_CHARS * 0.4) end = line;
    }
    const slice = text.slice(start, end).trim();
    if (slice) pieces.push(slice);
    if (end >= text.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return pieces;
}
