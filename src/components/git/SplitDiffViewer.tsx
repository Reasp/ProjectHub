import React, { useState, useMemo } from 'react';
import { Columns, AlignJustify, Copy, Check, ChevronDown, ChevronRight, FileCode } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useTimeoutState } from '../../hooks/useTimeoutState';

interface ParsedHunkLine {
  type: 'context' | 'added' | 'deleted' | 'header' | 'hunk-header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

interface ParsedHunk {
  header: string;
  lines: ParsedHunkLine[];
}

interface SplitRow {
  oldLine?: { number?: number; content: string; type: 'context' | 'deleted' | 'empty' };
  newLine?: { number?: number; content: string; type: 'context' | 'added' | 'empty' };
}

function parseUnifiedDiff(rawDiff: string): { fileHeader: string[]; hunks: ParsedHunk[] } {
  const lines = rawDiff.split('\n');
  const fileHeader: string[] = [];
  const hunks: ParsedHunk[] = [];

  let currentHunk: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      fileHeader.push(line);
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      currentHunk = {
        header: line,
        lines: []
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      if (line.trim()) fileHeader.push(line);
      continue;
    }

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'added',
        newLineNumber: newLine++,
        content: line.slice(1)
      });
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'deleted',
        oldLineNumber: oldLine++,
        content: line.slice(1)
      });
    } else if (line.startsWith('\\ No newline at end of file')) {
      // ignore or append meta
    } else {
      currentHunk.lines.push({
        type: 'context',
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
        content: line.startsWith(' ') ? line.slice(1) : line
      });
    }
  }

  return { fileHeader, hunks };
}

function buildSplitRows(hunk: ParsedHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'context') {
      rows.push({
        oldLine: { number: line.oldLineNumber, content: line.content, type: 'context' },
        newLine: { number: line.newLineNumber, content: line.content, type: 'context' }
      });
      i++;
    } else if (line.type === 'deleted') {
      // Look ahead for paired additions
      const deletes: ParsedHunkLine[] = [];
      while (i < lines.length && lines[i].type === 'deleted') {
        deletes.push(lines[i]);
        i++;
      }
      const adds: ParsedHunkLine[] = [];
      while (i < lines.length && lines[i].type === 'added') {
        adds.push(lines[i]);
        i++;
      }

      const maxLen = Math.max(deletes.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        const del = deletes[k];
        const add = adds[k];
        rows.push({
          oldLine: del
            ? { number: del.oldLineNumber, content: del.content, type: 'deleted' }
            : { content: '', type: 'empty' },
          newLine: add
            ? { number: add.newLineNumber, content: add.content, type: 'added' }
            : { content: '', type: 'empty' }
        });
      }
    } else if (line.type === 'added') {
      rows.push({
        oldLine: { content: '', type: 'empty' },
        newLine: { number: line.newLineNumber, content: line.content, type: 'added' }
      });
      i++;
    } else {
      i++;
    }
  }

  return rows;
}

interface SplitDiffViewerProps {
  diff: string;
  filePath?: string;
  defaultMode?: 'unified' | 'split';
}

export const SplitDiffViewer: React.FC<SplitDiffViewerProps> = ({
  diff,
  filePath,
  defaultMode = 'split'
}) => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'unified' | 'split'>(defaultMode);
  // Индикатор «скопировано» гаснет сам; таймер снимается при размонтировании (TASK-50)
  const [copied, showCopied] = useTimeoutState(false, 2000);

  const { fileHeader, hunks } = useMemo(() => parseUnifiedDiff(diff || ''), [diff]);

  const handleCopy = () => {
    if (!diff) return;
    navigator.clipboard.writeText(diff);
    showCopied(true);
  };

  if (!diff || hunks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-xs text-slate-500 italic p-6 text-center">
        <FileCode className="w-8 h-8 text-slate-700 mb-2" />
        <span>{t.git.diffViewerNoChanges}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0b0d14] text-slate-300 font-mono text-[12px] select-text">
      {/* Diff Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-xs shrink-0 select-none">
        <div className="flex items-center gap-2 overflow-hidden">
          {filePath && (
            <span className="font-semibold text-slate-200 truncate" title={filePath}>
              {filePath}
            </span>
          )}
          <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
            {hunks.length} {hunks.length === 1 ? t.git.diffViewerHunk : t.git.diffViewerHunks}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700/60">
            <button
              onClick={() => setViewMode('unified')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                viewMode === 'unified'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t.git.diffViewerUnifiedTooltip}
            >
              <AlignJustify className="w-3 h-3" />
              <span>Unified</span>
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                viewMode === 'split'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t.git.diffViewerSplitTooltip}
            >
              <Columns className="w-3 h-3" />
              <span>Split</span>
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition"
            title={t.git.diffViewerCopyTooltip}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? t.common.copied : 'Diff'}</span>
          </button>
        </div>
      </div>

      {/* Main Diff Content Container */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'split' ? (
          /* ─── SPLIT / SIDE-BY-SIDE VIEW ─── */
          <div className="w-full">
            {hunks.map((hunk, hIdx) => {
              const rows = buildSplitRows(hunk);
              return (
                <div key={hIdx} className="border-b border-slate-800/80 last:border-b-0">
                  {/* Hunk Header */}
                  <div className="bg-cyan-950/20 text-cyan-400 px-3 py-1 text-[11px] border-y border-cyan-900/30 flex items-center gap-2 font-mono select-none sticky top-0 z-10 backdrop-blur-md">
                    <span>{hunk.header}</span>
                  </div>

                  {/* Split Table */}
                  <div className="divide-y divide-slate-900/40">
                    {rows.map((row, rIdx) => (
                      <div key={rIdx} className="grid grid-cols-2 text-[11px] leading-5 font-mono">
                        {/* Left Side: Old / Deletion */}
                        <div
                          className={`flex border-r border-slate-800/80 overflow-hidden ${
                            row.oldLine?.type === 'deleted'
                              ? 'bg-rose-950/25 text-rose-300'
                              : row.oldLine?.type === 'empty'
                              ? 'bg-slate-950/40 opacity-40'
                              : 'bg-transparent text-slate-400'
                          }`}
                        >
                          <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 bg-slate-950/30 border-r border-slate-800/50">
                            {row.oldLine?.number ?? ''}
                          </span>
                          <span className="w-4 shrink-0 select-none text-center text-rose-500 font-bold">
                            {row.oldLine?.type === 'deleted' ? '-' : ''}
                          </span>
                          <span className="flex-1 pl-1 pr-2 whitespace-pre overflow-x-auto">
                            {row.oldLine?.content || ' '}
                          </span>
                        </div>

                        {/* Right Side: New / Addition */}
                        <div
                          className={`flex overflow-hidden ${
                            row.newLine?.type === 'added'
                              ? 'bg-emerald-950/25 text-emerald-300'
                              : row.newLine?.type === 'empty'
                              ? 'bg-slate-950/40 opacity-40'
                              : 'bg-transparent text-slate-400'
                          }`}
                        >
                          <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 bg-slate-950/30 border-r border-slate-800/50">
                            {row.newLine?.number ?? ''}
                          </span>
                          <span className="w-4 shrink-0 select-none text-center text-emerald-500 font-bold">
                            {row.newLine?.type === 'added' ? '+' : ''}
                          </span>
                          <span className="flex-1 pl-1 pr-2 whitespace-pre overflow-x-auto">
                            {row.newLine?.content || ' '}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ─── UNIFIED VIEW ─── */
          <div className="w-full">
            {hunks.map((hunk, hIdx) => (
              <div key={hIdx} className="border-b border-slate-800/80 last:border-b-0">
                {/* Hunk Header */}
                <div className="bg-cyan-950/20 text-cyan-400 px-3 py-1 text-[11px] border-y border-cyan-900/30 select-none sticky top-0 z-10 backdrop-blur-md">
                  {hunk.header}
                </div>

                {/* Unified Lines */}
                <div className="divide-y divide-slate-900/40">
                  {hunk.lines.map((line, lIdx) => {
                    let bg = 'bg-transparent text-slate-400';
                    let sign = ' ';
                    let signCls = 'text-transparent';

                    if (line.type === 'added') {
                      bg = 'bg-emerald-950/25 text-emerald-300';
                      sign = '+';
                      signCls = 'text-emerald-400 font-bold';
                    } else if (line.type === 'deleted') {
                      bg = 'bg-rose-950/25 text-rose-300';
                      sign = '-';
                      signCls = 'text-rose-400 font-bold';
                    }

                    return (
                      <div key={lIdx} className={`flex text-[11px] leading-5 font-mono ${bg}`}>
                        <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 bg-slate-950/30 border-r border-slate-800/50">
                          {line.oldLineNumber ?? ''}
                        </span>
                        <span className="w-10 shrink-0 select-none text-right pr-2 text-slate-600 bg-slate-950/30 border-r border-slate-800/50">
                          {line.newLineNumber ?? ''}
                        </span>
                        <span className={`w-4 shrink-0 select-none text-center ${signCls}`}>
                          {sign}
                        </span>
                        <span className="flex-1 pl-1 pr-3 whitespace-pre overflow-x-auto">
                          {line.content || ' '}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
