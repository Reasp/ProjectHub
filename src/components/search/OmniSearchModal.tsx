import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  X,
  BookOpen,
  FileText,
  CheckSquare,
  Sparkles,
  ExternalLink,
  FolderGit2,
  BrainCircuit,
  ArrowRight,
  Layers,
  GitBranch,
  Home
} from 'lucide-react';
import { useProjectStore, samePath } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useTimers } from '../../hooks/useTimeoutState';
import type { RagSearchResult } from '../../types/electron';

interface OmniSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OmniSearchModal: React.FC<OmniSearchModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { selectedProject, selectProject, projects, setActiveTab, worktrees, workspaceRoot, setActiveWorktree } =
    useProjectStore();

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'vector' | 'text'>('all');
  const [isGlobal, setIsGlobal] = useState(true);
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  // Отложенный фокус: таймер снимается при размонтировании (TASK-50)
  const { setTimer } = useTimers();

  useEffect(() => {
    if (isOpen) {
      setTimer(() => inputRef.current?.focus(), 50);
      setSelectedResultIndex(0);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen, setTimer]);

  // Debounced search
  useEffect(() => {
    if (!isOpen || !query.trim() || !window.api) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await window.api.searchDocs({
          projectPath: isGlobal ? undefined : selectedProject?.path,
          query: query.trim(),
          mode,
          global: isGlobal,
          limit: 20
        });
        setResults(found);
        setSelectedResultIndex(0);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, mode, isGlobal, isOpen, selectedProject]);

  // Keyboard navigation (Arrow keys, Enter, Esc)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedResultIndex((prev) => (prev + 1) % Math.max(results.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedResultIndex((prev) => (prev - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === 'Enter' && results[selectedResultIndex]) {
      handleSelectResult(results[selectedResultIndex]);
    }
  };

  const handleSelectResult = (item: RagSearchResult) => {
    const proj = projects.find((p) => p.path === item.projectPath);
    if (proj) {
      selectProject(proj);
      if (item.category === 'task') {
        setActiveTab('kanban');
      } else {
        setActiveTab('docs');
      }
    }
    onClose();
  };

  /**
   * Переключение рабочего дерева прямо из палитры (TASK-62, AC #1): совпадение по ветке,
   * пути или id задачи; при пустом запросе показываются все деревья проекта.
   */
  const q = query.trim().toLowerCase();
  const worktreeMatches = selectedProject
    ? [
        {
          path: selectedProject.path,
          label: t.worktrees.mainTreeOption,
          hint: selectedProject.path,
          isMain: true,
          taskId: undefined as string | undefined
        },
        ...worktrees
          .filter((w) => !w.isMain)
          .map((w) => ({
            path: w.path,
            label: w.branch || w.head.slice(0, 7),
            hint: w.path,
            isMain: false,
            taskId: w.taskId
          }))
      ].filter(
        (w) =>
          q === '' ||
          w.label.toLowerCase().includes(q) ||
          w.hint.toLowerCase().includes(q) ||
          (w.taskId ? w.taskId.toLowerCase().includes(q) : false)
      )
    : [];

  const handleSwitchWorktree = async (path: string, isMain: boolean) => {
    onClose();
    await setActiveWorktree(isMain ? null : path);
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-100 select-none"
    >
      <div className="bg-[#121520] border border-slate-700/80 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Search Input Header */}
        <div className="p-4 border-b border-slate-800 bg-[#151928]/80 flex items-center gap-3">
          <Search className="w-5 h-5 text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search.placeholder}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none font-medium"
          />

          {isSearching && (
            <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}

          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500 bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-700/50">
            ESC {t.common.cancel}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="px-4 py-2 bg-[#0e111a] border-b border-slate-800/60 flex items-center justify-between text-xs flex-wrap gap-2">
          {/* Mode switch */}
          <div className="flex items-center gap-1 bg-[#151928] p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setMode('all')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                mode === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.common.all}
            </button>
            <button
              onClick={() => setMode('vector')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition flex items-center gap-1 ${
                mode === 'vector' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-amber-300" />
              Vector RAG
            </button>
            <button
              onClick={() => setMode('text')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                mode === 'text' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Text
            </button>
          </div>

          {/* Scope switch */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsGlobal(true)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                isGlobal
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.search.globalScope} ({projects.length})
            </button>
            {selectedProject && (
              <button
                onClick={() => setIsGlobal(false)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition truncate max-w-[180px] ${
                  !isGlobal
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Only ${selectedProject.name}`}
              >
                {t.search.projectScope}: {selectedProject.name}
              </button>
            )}
          </div>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {/* Активное рабочее дерево проекта (TASK-62) */}
          {worktreeMatches.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold px-1">
                {t.worktrees.switcherTitle}
              </p>
              {worktreeMatches.map((w) => {
                const isActive = samePath(w.path, workspaceRoot);
                return (
                  <button
                    key={w.path}
                    type="button"
                    onClick={() => void handleSwitchWorktree(w.path, w.isMain)}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center gap-2 ${
                      isActive
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                        : 'bg-[#151928]/50 border-slate-800/80 text-slate-300 hover:bg-[#181d2e] hover:border-slate-700'
                    }`}
                  >
                    {w.isMain ? (
                      <Home className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <GitBranch className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold truncate">{w.label}</span>
                      <span className="block text-[10px] font-mono text-slate-500 truncate">{w.hint}</span>
                    </span>
                    {w.taskId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0">
                        {w.taskId}
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 shrink-0">
                        {t.worktrees.activeBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {query.trim() === '' && (
            <div className="py-12 text-center text-xs text-slate-500 space-y-2">
              <BrainCircuit className="w-8 h-8 mx-auto text-slate-600" />
              <p>{t.search.placeholder}</p>
            </div>
          )}

          {query.trim() !== '' && results.length === 0 && !isSearching && (
            <div className="py-12 text-center text-xs text-slate-500">
              {t.search.noResults} «{query}»
            </div>
          )}

          {results.map((item, idx) => {
            const isSelected = selectedResultIndex === idx;

            return (
              <div
                key={`${item.filePath}::${idx}`}
                onClick={() => handleSelectResult(item)}
                onMouseEnter={() => setSelectedResultIndex(idx)}
                className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500/50 shadow-md ring-1 ring-indigo-500/30'
                    : 'bg-[#151928]/50 border-slate-800/80 hover:bg-[#181d2e] hover:border-slate-700'
                }`}
              >
                {/* Result Meta Bar */}
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 truncate flex-1">
                    {/* Category Icon */}
                    {item.category === 'task' ? (
                      <CheckSquare className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    ) : item.category === 'decision' ? (
                      <BrainCircuit className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    ) : (
                      <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    )}

                    <span className="font-semibold text-slate-200 truncate">
                      {item.heading || item.fileRelative}
                    </span>

                    <span className="text-[10px] text-slate-500 font-mono">
                      • {item.fileRelative}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-mono">
                      {item.projectName}
                    </span>

                    {item.type === 'vector' ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 text-[10px] font-mono">
                        <Sparkles className="w-2.5 h-2.5" />
                        {Math.round(item.score * 100)}%
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40 text-[10px] font-mono">
                        text
                      </span>
                    )}
                  </div>
                </div>

                {/* Snippet */}
                <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed font-sans pl-5">
                  {item.snippet}
                </p>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#10131e] border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ {t.search.navigate}</span>
            <span>↵ {t.search.select}</span>
          </div>
          <span>{t.search.matchesFound}: {results.length}</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
