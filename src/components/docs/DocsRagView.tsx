import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  ShieldCheck,
  FileText,
  RefreshCw,
  Search,
  CheckCircle2,
  ChevronRight,
  Database,
  Plus,
  Save,
  Eye,
  Edit3,
  Columns,
  Tag,
  Clock,
  Sparkles,
  Bold,
  Italic,
  Heading,
  Code,
  List,
  Quote,
  AlertCircle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { CreateDocModal } from './CreateDocModal';
import { MarkdownViewer } from '../common/MarkdownViewer';
import type { DocItem } from '../../types/electron';

export const DocsRagView: React.FC = () => {
  const {
    selectedProject,
    startProcessAction,
    docsList,
    selectedDoc,
    docContent,
    isDocLoading,
    isDocSaving,
    isDocDirty,
    fetchDocs,
    selectDoc,
    setDocContent,
    saveDocAction
  } = useProjectStore();

  const [ragStats, setRagStats] = useState<{ hasIndex: boolean; chunksCount: number; lastModified?: string }>({
    hasIndex: false,
    chunksCount: 0
  });
  const [isReindexing, setIsReindexing] = useState(false);
  const [filterDocQuery, setFilterDocQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'decision' | 'doc'>('all');
  const [viewMode, setViewMode] = useState<'preview' | 'edit' | 'split'>('split');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch RAG stats
  const fetchStats = async () => {
    if (!selectedProject || !window.api) return;
    try {
      const stats = await window.api.getRagStats(selectedProject.path);
      setRagStats(stats);
    } catch (e) {
      console.error('Failed to get RAG stats:', e);
    }
  };

  useEffect(() => {
    if (selectedProject) {
      fetchDocs(selectedProject.path);
      fetchStats();
    }
  }, [selectedProject]);

  // Keyboard shortcut: Ctrl + S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDocDirty, docContent, selectedDoc]);

  const handleSave = async () => {
    if (!selectedDoc) return;
    const ok = await saveDocAction();
    if (ok) {
      setSaveSuccessNotice(true);
      setTimeout(() => setSaveSuccessNotice(false), 3000);
    }
  };

  const handleReindex = async () => {
    if (!selectedProject) return;
    setIsReindexing(true);
    await startProcessAction('npm run index-docs', 'index-docs');
    setTimeout(() => {
      setIsReindexing(false);
      fetchStats();
    }, 4000);
  };

  const insertSnippet = (before: string, after: string = '') => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = docContent.substring(start, end);
    const replacement = `${before}${selected || 'текст'}${after}`;
    const newContent = docContent.substring(0, start) + replacement + docContent.substring(end);
    setDocContent(newContent);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + replacement.length - after.length);
    }, 10);
  };

  const filteredDocs = docsList.filter((d) => {
    const matchesCategory = categoryFilter === 'all' || d.category === categoryFilter;
    const query = filterDocQuery.toLowerCase();
    const matchesQuery =
      !query ||
      d.title.toLowerCase().includes(query) ||
      d.fileRelative.toLowerCase().includes(query) ||
      d.tags.some((t) => t.toLowerCase().includes(query));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 select-none">
      {/* Top Banner: RAG Stats, Indexer & Create Doc */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-[#141828] to-[#171b2d] border border-slate-800 shadow-xl mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              База знаний и Архитектурные решения (ADR)
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {ragStats.hasIndex ? `RAG готов (${ragStats.chunksCount} чанков)` : 'RAG не собран'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Всего документов: <span className="font-semibold text-slate-200">{docsList.length}</span> (
              {docsList.filter((d) => d.category === 'decision').length} ADR,{' '}
              {docsList.filter((d) => d.category === 'doc').length} Док)
              {ragStats.lastModified && (
                <span> • Индекс обновлен: {new Date(ragStats.lastModified).toLocaleDateString()}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition"
          >
            <Plus className="w-4 h-4" />
            Создать документ / ADR
          </button>

          <button
            onClick={handleReindex}
            disabled={isReindexing}
            title="Пересобрать векторный индекс LanceDB (npm run index-docs)"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin text-indigo-400' : ''}`} />
            {isReindexing ? 'Индексация...' : 'Пересобрать RAG'}
          </button>
        </div>
      </div>

      {/* Main Split: Left Docs List, Right Editor / Viewer */}
      <div className="flex-1 flex gap-5 overflow-hidden">
        {/* Left Column: Docs List */}
        <div className="w-80 bg-[#141724]/70 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
          {/* Filter & Category Tabs */}
          <div className="p-3 border-b border-slate-800 space-y-2.5 bg-[#111422]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={filterDocQuery}
                onChange={(e) => setFilterDocQuery(e.target.value)}
                placeholder="Поиск по документам и тегам..."
                className="w-full bg-[#10121d] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1 bg-[#10121d] p-1 rounded-lg border border-slate-800 text-[11px]">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`flex-1 py-1 rounded-md font-medium transition ${
                  categoryFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Все ({docsList.length})
              </button>
              <button
                onClick={() => setCategoryFilter('decision')}
                className={`flex-1 py-1 rounded-md font-medium transition ${
                  categoryFilter === 'decision' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ADR ({docsList.filter((d) => d.category === 'decision').length})
              </button>
              <button
                onClick={() => setCategoryFilter('doc')}
                className={`flex-1 py-1 rounded-md font-medium transition ${
                  categoryFilter === 'doc' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Доки ({docsList.filter((d) => d.category === 'doc').length})
              </button>
            </div>
          </div>

          {/* Docs Scroll List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {filteredDocs.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                Документы не найдены
              </div>
            )}

            {filteredDocs.map((doc) => {
              const isSelected = selectedDoc?.filePath === doc.filePath;
              const isDecision = doc.category === 'decision';

              return (
                <div
                  key={doc.id}
                  onClick={() => selectDoc(doc)}
                  className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500/50 text-white shadow-sm'
                      : 'bg-[#10121d]/40 border-slate-800/60 text-slate-300 hover:bg-[#181c2d]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isDecision ? (
                        <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                      )}
                      <span className="text-xs font-semibold truncate block">
                        {doc.title}
                      </span>
                    </div>

                    {doc.status && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 border ${
                          doc.status === 'Accepted'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : doc.status === 'Proposed'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {doc.status}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className="font-mono truncate max-w-[140px]">{doc.fileRelative}</span>
                    {doc.date && <span>{doc.date}</span>}
                  </div>

                  {doc.tags && doc.tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap pt-0.5">
                      {doc.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Editor & Markdown View */}
        <div className="flex-1 bg-[#141724]/70 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
          {selectedDoc ? (
            <>
              {/* Editor Header Bar */}
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-[#111422] gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {selectedDoc.category === 'decision' ? (
                    <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-sky-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate max-w-md">
                        {selectedDoc.title}
                      </span>
                      {isDocDirty && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                          Не сохранено
                        </span>
                      )}
                      {saveSuccessNotice && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Сохранено
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-slate-500 block truncate">
                      {selectedDoc.filePath}
                    </span>
                  </div>
                </div>

                {/* View Mode Switcher & Save Button */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center bg-[#10121d] p-1 rounded-xl border border-slate-800 text-xs">
                    <button
                      onClick={() => setViewMode('preview')}
                      className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition ${
                        viewMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Режим предпросмотра"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Просмотр
                    </button>
                    <button
                      onClick={() => setViewMode('split')}
                      className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition ${
                        viewMode === 'split' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Разделенный режим (Редактор + Предпросмотр)"
                    >
                      <Columns className="w-3.5 h-3.5" />
                      Split
                    </button>
                    <button
                      onClick={() => setViewMode('edit')}
                      className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition ${
                        viewMode === 'edit' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title="Режим только редактора"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Редактор
                    </button>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={isDocSaving || !isDocDirty}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition disabled:opacity-40 disabled:hover:bg-indigo-600"
                    title="Сохранить изменения (Ctrl + S)"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {isDocSaving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </div>

              {/* Formatting Toolbar (Only in Edit or Split mode) */}
              {viewMode !== 'preview' && (
                <div className="px-3 py-1.5 border-b border-slate-800 bg-[#121522] flex items-center gap-1 text-slate-400">
                  <button
                    onClick={() => insertSnippet('**', '**')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Жирный текст (**text**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertSnippet('*', '*')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Курсив (*text*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-[1px] h-4 bg-slate-800 mx-1" />
                  <button
                    onClick={() => insertSnippet('## ')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Заголовок 2 (## Title)"
                  >
                    <Heading className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertSnippet('```typescript\n', '\n```')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Блок кода (```)"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertSnippet('- ')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Список (- Item)"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertSnippet('> ')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition"
                    title="Цитата (> Quote)"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => insertSnippet('> [!NOTE]\n> ')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition text-xs font-mono"
                    title="GitHub Alert Note"
                  >
                    [!NOTE]
                  </button>
                  <button
                    onClick={() => insertSnippet('> [!IMPORTANT]\n> ')}
                    className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition text-xs font-mono text-indigo-400"
                    title="GitHub Alert Important"
                  >
                    [!IMPORTANT]
                  </button>
                </div>
              )}

              {/* Editor / Preview Content Area */}
              <div className="flex-1 flex overflow-hidden">
                {/* Editor Pane */}
                {(viewMode === 'edit' || viewMode === 'split') && (
                  <div className={`flex-1 flex flex-col h-full ${viewMode === 'split' ? 'border-r border-slate-800' : ''}`}>
                    <textarea
                      ref={textareaRef}
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      placeholder="Введите markdown текст документа..."
                      className="flex-1 w-full p-4 bg-[#0d0f17] text-slate-200 font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-indigo-600/40"
                      spellCheck={false}
                    />
                  </div>
                )}

                {/* Live Markdown Preview Pane */}
                {(viewMode === 'preview' || viewMode === 'split') && (
                  <div className="flex-1 overflow-y-auto p-6 bg-[#10121d] select-text">
                    <MarkdownViewer content={docContent} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
              <BookOpen className="w-10 h-10 text-slate-600" />
              <p className="text-xs">Выберите архитектурное решение (ADR) или документ из списка слева</p>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-xs hover:bg-indigo-600/30 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Создать первый документ
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal for creating new ADR / Doc */}
      <CreateDocModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
};
