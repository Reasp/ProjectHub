import React, { useState, useEffect, useRef } from 'react';
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
  Layers
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import type { RagSearchResult } from '../../types/electron';

interface OmniSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OmniSearchModal: React.FC<OmniSearchModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { selectedProject, selectProject, projects, setActiveTab } = useProjectStore();

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'vector' | 'text'>('all');
  const [isGlobal, setIsGlobal] = useState(true);
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedResultIndex(0);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  return (
    <div
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-100 select-none"
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
    </div>
  );
};
