import React, { useState } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Lightbulb, Flame } from 'lucide-react';

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content, className = '' }) => {
  if (!content || !content.trim()) {
    return <div className="text-xs text-slate-500 italic p-4">Документ пуст</div>;
  }

  // Parse markdown into high-level blocks
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`space-y-4 text-xs text-slate-200 leading-relaxed font-sans select-text ${className}`}>
      {blocks.map((block, idx) => (
        <BlockRenderer key={idx} block={block} />
      ))}
    </div>
  );
};

interface MarkdownBlock {
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

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
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

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 3. Fenced Code Block / Mermaid
    if (trimmed.startsWith('```')) {
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
    if (trimmed.startsWith('>')) {
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
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
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
    if (/^(\*|-|\+|\d+\.)\s+/.test(trimmed)) {
      const items: string[] = [];
      const isOrdered = /^\d+\./.test(trimmed);

      while (i < lines.length && /^(\*|-|\+|\d+\.)\s+/.test(lines[i].trim())) {
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

    // 9. Standard Paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !/^(\*|-|\+|\d+\.)\s+/.test(lines[i].trim()) &&
      !/^(\-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        raw: paragraphLines.join('\n')
      });
    }
  }

  return blocks;
}

const BlockRenderer: React.FC<{ block: MarkdownBlock }> = ({ block }) => {
  switch (block.type) {
    case 'hr':
      return <hr className="my-6 border-slate-800" />;

    case 'heading': {
      const text = block.raw || '';
      if (block.level === 1) {
        return (
          <h1 className="text-xl font-bold text-white tracking-tight pb-2 border-b border-slate-800 mt-6 mb-4 flex items-center gap-2">
            <span className="w-1.5 h-5 rounded-full bg-indigo-500" />
            <InlineMarkdown text={text} />
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 className="text-base font-semibold text-slate-100 mt-6 mb-3 pb-1 border-b border-slate-800/60 flex items-center gap-2">
            <span className="w-1 h-3.5 rounded-full bg-cyan-500" />
            <InlineMarkdown text={text} />
          </h2>
        );
      }
      if (block.level === 3) {
        return (
          <h3 className="text-sm font-semibold text-indigo-300 mt-4 mb-2">
            <InlineMarkdown text={text} />
          </h3>
        );
      }
      return (
        <h4 className="text-xs font-semibold text-slate-200 mt-3 mb-1 uppercase tracking-wider text-slate-400">
          <InlineMarkdown text={text} />
        </h4>
      );
    }

    case 'mermaid':
      return <MermaidDiagram chart={block.code || ''} />;

    case 'code':
      return <CodeBlock lang={block.lang || 'text'} code={block.code || ''} />;

    case 'alert':
      return <AlertBlock type={block.alertType || 'note'} title={block.alertTitle} content={block.alertContent || ''} />;

    case 'table':
      return <TableBlock headers={block.headers || []} rows={block.rows || []} />;

    case 'list':
      return (
        <ul className={`space-y-1.5 my-3 pl-4 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-indigo-400`}>
          {(block.items || []).map((item, idx) => {
            const isTask = item.startsWith('[ ]') || item.startsWith('[x]') || item.startsWith('[X]');
            if (isTask) {
              const isChecked = !item.startsWith('[ ]');
              const taskText = item.replace(/^\[[ xX]\]\s*/, '');
              return (
                <li key={idx} className="list-none -ml-4 flex items-start gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    readOnly
                    className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 cursor-default"
                  />
                  <span className={isChecked ? 'line-through text-slate-500' : ''}>
                    <InlineMarkdown text={taskText} />
                  </span>
                </li>
              );
            }
            return (
              <li key={idx} className="text-slate-300">
                <InlineMarkdown text={item} />
              </li>
            );
          })}
        </ul>
      );

    case 'blockquote':
      return (
        <blockquote className="my-3 pl-4 border-l-2 border-indigo-500/60 bg-indigo-950/10 py-2 pr-3 rounded-r-lg text-slate-300 italic">
          <InlineMarkdown text={block.raw || ''} />
        </blockquote>
      );

    case 'paragraph':
      return (
        <p className="my-2.5 text-slate-300 leading-relaxed">
          <InlineMarkdown text={block.raw || ''} />
        </p>
      );

    default:
      return null;
  }
};

const CodeBlock: React.FC<{ lang: string; code: string }> = ({ lang, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl border border-slate-800 bg-[#0d0f18] overflow-hidden shadow-lg group">
      <div className="px-4 py-1.5 bg-[#141724] border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <span className="uppercase text-indigo-400 font-semibold">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition px-2 py-0.5 rounded hover:bg-slate-700/50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[11px] font-mono text-slate-200 leading-relaxed selection:bg-indigo-500/30">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const AlertBlock: React.FC<{ type: 'note' | 'tip' | 'important' | 'warning' | 'caution'; title?: string; content: string }> = ({
  type,
  title,
  content
}) => {
  const config = {
    note: { icon: Info, border: 'border-blue-500/40', bg: 'bg-blue-950/20', text: 'text-blue-400', label: 'NOTE' },
    tip: { icon: Lightbulb, border: 'border-emerald-500/40', bg: 'bg-emerald-950/20', text: 'text-emerald-400', label: 'TIP' },
    important: { icon: Flame, border: 'border-indigo-500/40', bg: 'bg-indigo-950/20', text: 'text-indigo-400', label: 'IMPORTANT' },
    warning: { icon: AlertTriangle, border: 'border-amber-500/40', bg: 'bg-amber-950/20', text: 'text-amber-400', label: 'WARNING' },
    caution: { icon: AlertCircle, border: 'border-red-500/40', bg: 'bg-red-950/20', text: 'text-red-400', label: 'CAUTION' }
  }[type] || { icon: Info, border: 'border-blue-500/40', bg: 'bg-blue-950/20', text: 'text-blue-400', label: 'NOTE' };

  const IconComp = config.icon;

  return (
    <div className={`my-4 p-4 rounded-xl border ${config.border} ${config.bg} flex items-start gap-3 shadow-md`}>
      <IconComp className={`w-4 h-4 shrink-0 mt-0.5 ${config.text}`} />
      <div className="flex-1 space-y-1">
        <div className={`text-[11px] font-bold uppercase tracking-wider ${config.text}`}>
          {title || config.label}
        </div>
        <div className="text-xs text-slate-300 leading-relaxed">
          <InlineMarkdown text={content} />
        </div>
      </div>
    </div>
  );
};

const TableBlock: React.FC<{ headers: string[]; rows: string[][] }> = ({ headers, rows }) => {
  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-slate-800 shadow-md">
      <table className="w-full text-left border-collapse text-xs">
        {headers.length > 0 && (
          <thead>
            <tr className="bg-[#141724] border-b border-slate-800 text-slate-200">
              {headers.map((h, idx) => (
                <th key={idx} className="px-4 py-2.5 font-semibold">
                  <InlineMarkdown text={h} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-slate-800/60 bg-[#0e111d]">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-slate-800/30 transition">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-4 py-2.5 text-slate-300 align-middle">
                  <InlineMarkdown text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const InlineMarkdown: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return null;

  // Split by markdown images: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match;

  while ((match = imageRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(renderFormattedText(text.substring(lastIdx, match.index), parts.length));
    }
    const alt = match[1];
    const src = match[2];
    parts.push(
      <img
        key={`img-${match.index}`}
        src={src}
        alt={alt}
        className="inline-block max-w-full rounded-xl border border-slate-800 shadow-lg my-2 object-contain"
        style={{ maxHeight: '360px' }}
      />
    );
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(renderFormattedText(text.substring(lastIdx), parts.length));
  }

  return <>{parts}</>;
};

function renderFormattedText(str: string, keyPrefix: number): React.ReactNode {
  // Replace bold, italic, inline code, links
  const tokens = str.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);

  return (
    <span key={`ftext-${keyPrefix}`}>
      {tokens.map((token, idx) => {
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code key={idx} className="px-1.5 py-0.5 rounded bg-slate-800/80 text-indigo-300 font-mono text-[11px] border border-slate-700/40">
              {token.slice(1, -1)}
            </code>
          );
        }
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={idx} className="font-semibold text-white">{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('*') && token.endsWith('*')) {
          return <em key={idx} className="italic text-slate-300">{token.slice(1, -1)}</em>;
        }
        const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <a
              key={idx}
              href={linkMatch[2]}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-500/40"
            >
              {linkMatch[1]}
            </a>
          );
        }
        return token;
      })}
    </span>
  );
}
