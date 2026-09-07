/**
 * Разбор markdown на верхнеуровневые блоки для MarkdownViewer (чистая функция без React —
 * вынесена из компонента, чтобы покрыть тестами, TASK-49).
 */
export interface MarkdownBlock {
  type: 'heading' | 'code' | 'mermaid' | 'alert' | 'table' | 'list' | 'blockquote' | 'paragraph' | 'hr';
  level?: number;
  lang?: string;
  code?: string;
  alertType?: 'note' | 'tip' | 'important' | 'warning' | 'caution';
  alertTitle?: string;
  alertContent?: string;
  rows?: string[][];
  headers?: string[];
  items?: string[];
  ordered?: boolean;
  raw?: string;
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  // Strip YAML frontmatter if present
  let cleanText = text;
  if (cleanText.startsWith('---')) {
    const endMatch = cleanText.indexOf('\n---', 3);
    if (endMatch !== -1) {
      cleanText = cleanText.substring(endMatch + 4).trim();
    }
  }

  const lines = cleanText.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const isHeading = (line: string) => /^(#{1,6})\s+(.*)$/.test(line);
  const isHr = (line: string) => /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim());
  const isCodeBlock = (line: string) => line.trim().startsWith('```');
  const isAlertOrQuote = (line: string) => line.trim().startsWith('>');
  const isList = (line: string) => /^(\*|-|\+|\d+\.)\s+/.test(line.trim());
  const isTable = (line: string, nextLine?: string) => Boolean(
    line.trim().startsWith('|') &&
    line.trim().endsWith('|') &&
    nextLine &&
    nextLine.includes('---')
  );

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (isHr(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 3. Fenced Code Block / Mermaid
    if (isCodeBlock(trimmed)) {
      const lang = trimmed.substring(3).trim().toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing ```
      }

      const codeContent = codeLines.join('\n');
      if (lang === 'mermaid') {
        blocks.push({ type: 'mermaid', code: codeContent });
      } else {
        blocks.push({ type: 'code', lang: lang || 'text', code: codeContent });
      }
      continue;
    }

    // 4. Headings (#, ##, ###, ####)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        raw: headingMatch[2].trim()
      });
      i++;
      continue;
    }

    // 5. GitHub Style Alerts (> [!NOTE], > [!TIP], etc)
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (alertMatch) {
      const aType = alertMatch[1].toLowerCase() as any;
      const firstLineText = alertMatch[2];
      const alertLines: string[] = [];
      if (firstLineText) alertLines.push(firstLineText);

      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        alertLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }

      blocks.push({
        type: 'alert',
        alertType: aType,
        alertTitle: alertMatch[1].toUpperCase(),
        alertContent: alertLines.join('\n').trim()
      });
      continue;
    }

    // 6. Blockquote
    if (isAlertOrQuote(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        raw: quoteLines.join('\n').trim()
      });
      continue;
    }

    // 7. Markdown Table (| col 1 | col 2 |)
    if (isTable(trimmed, lines[i + 1])) {
      const headers = trimmed.split('|').slice(1, -1).map((s) => s.trim());
      i += 2; // skip header and delimiter row
      const rows: string[][] = [];

      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const rowCells = lines[i].trim().split('|').slice(1, -1).map((s) => s.trim());
        rows.push(rowCells);
        i++;
      }

      blocks.push({
        type: 'table',
        headers,
        rows
      });
      continue;
    }

    // 8. Lists (Unordered - or *, Ordered 1.)
    if (isList(trimmed)) {
      const items: string[] = [];
      const isOrdered = /^\d+\./.test(trimmed);

      while (i < lines.length && isList(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^(\*|-|\+|\d+\.)\s+/, ''));
        i++;
      }

      blocks.push({
        type: 'list',
        items,
        ordered: isOrdered
      });
      continue;
    }

    // 9. Standard Paragraph (always consumes at least current line, then continues until next block)
    const paragraphLines: string[] = [lines[i]];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isHeading(lines[i]) &&
      !isCodeBlock(lines[i]) &&
      !isAlertOrQuote(lines[i]) &&
      !isHr(lines[i]) &&
      !isList(lines[i]) &&
      !isTable(lines[i], lines[i + 1])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    blocks.push({
      type: 'paragraph',
      raw: paragraphLines.join('\n')
    });
  }

  return blocks;
}
