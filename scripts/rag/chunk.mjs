const MAX_CHARS = 1000;
const OVERLAP = 150;

// Режем markdown по границам параграфов/заголовков, чтобы не рвать текст
// посередине предложения. Для каждого чанка запоминаем последний заголовок
// над ним — так результат поиска понятен и человеку, и агенту без открытия файла.
export function chunkMarkdown(text) {
  const lines = text.split('\n');
  let currentHeading = '';
  const blocks = [];
  let buffer = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) blocks.push({ heading: currentHeading, text: content });
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s/, '').trim();
    }
    buffer.push(line);
  }
  flush();

  const chunks = [];
  for (const block of blocks) {
    if (block.text.length <= MAX_CHARS) {
      chunks.push(block);
      continue;
    }
    let start = 0;
    while (start < block.text.length) {
      let end = Math.min(start + MAX_CHARS, block.text.length);
      if (end < block.text.length) {
        const lastBreak = block.text.lastIndexOf('\n\n', end);
        if (lastBreak > start + MAX_CHARS * 0.4) end = lastBreak;
      }
      const slice = block.text.slice(start, end).trim();
      if (slice) chunks.push({ heading: block.heading, text: slice });
      if (end >= block.text.length) break;
      start = end - OVERLAP;
    }
  }
  return chunks;
}
