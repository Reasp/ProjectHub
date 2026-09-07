import React, { useState } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { parseMarkdownBlocks, type MarkdownBlock } from './markdownBlocks';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Lightbulb, Flame } from 'lucide-react';

interface MarkdownViewerProps {
  content: string;
  className?: string;
  emptyMessage?: string | null;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  className = '',
  emptyMessage = 'Документ пуст'
}) => {
  if (!content || !content.trim()) {
    if (emptyMessage === null) return null;
    return <div className="text-xs text-slate-500 italic p-4">{emptyMessage}</div>;
  }

  // Parse markdown into high-level blocks
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`space-y-3.5 text-xs text-slate-200 leading-relaxed font-sans select-text ${className}`}>
      {blocks.map((block, idx) => (
        <BlockRenderer key={idx} block={block} />
      ))}
    </div>
  );
};

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

  // Split by markdown images: ![alt](url) OR html img tags: <img src="..." />
  const imageRegex = /(!\[([^\]]*)\]\(([^)]+)\)|<img\s+([^>]+?)\/?>)/gi;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match;

  while ((match = imageRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(renderFormattedText(text.substring(lastIdx, match.index), parts.length));
    }

    if (match[0].startsWith('![')) {
      // Markdown style: ![alt](url)
      const alt = match[2] || '';
      const src = match[3] || '';
      parts.push(
        <img
          key={`md-img-${match.index}`}
          src={src}
          alt={alt}
          className="inline-block max-w-full rounded-xl border border-slate-800 shadow-lg my-1.5 object-contain"
          style={{ maxHeight: '360px' }}
        />
      );
    } else {
      // HTML style: <img src="..." ... />
      const attrString = match[4] || '';
      const srcMatch = attrString.match(/src=["']([^"']+)["']/i);
      const altMatch = attrString.match(/alt=["']([^"']+)["']/i);
      const widthMatch = attrString.match(/width=["']?(\d+)(?:px)?["']?/i);
      const heightMatch = attrString.match(/height=["']?(\d+)(?:px)?["']?/i);

      const src = srcMatch ? srcMatch[1] : '';
      const alt = altMatch ? altMatch[1] : 'Image';
      const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
      const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;

      parts.push(
        <img
          key={`html-img-${match.index}`}
          src={src}
          alt={alt}
          width={width}
          height={height}
          className="inline-block max-w-full rounded-lg border border-slate-800/80 shadow-md my-1 object-contain"
          style={{
            width: width ? `${width}px` : undefined,
            height: height ? `${height}px` : undefined,
            maxHeight: '360px'
          }}
        />
      );
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(renderFormattedText(text.substring(lastIdx), parts.length));
  }

  return <>{parts}</>;
};

/**
 * Ссылка из markdown: никакого target="_blank" (открывало бы внешний сайт в окне Electron с preload
 * и доступом к window.api). http/https/mailto уходят в системный браузер через window.api.openExternal,
 * остальные схемы и относительные пути не открываются вовсе (TASK-30).
 */
const ExternalLink: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => {
  const isOpenable = /^(https?:|mailto:)/i.test(href.trim());
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (isOpenable) {
      void window.api.openExternal(href.trim());
    }
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      title={isOpenable ? href : undefined}
      className={`underline underline-offset-2 ${
        isOpenable
          ? 'text-cyan-400 hover:text-cyan-300 decoration-cyan-500/40 cursor-pointer'
          : 'text-slate-400 decoration-slate-600 cursor-default'
      }`}
    >
      {children}
    </a>
  );
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
            <ExternalLink key={idx} href={linkMatch[2]}>
              {linkMatch[1]}
            </ExternalLink>
          );
        }
        return token;
      })}
    </span>
  );
}
