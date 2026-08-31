import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  BrainCircuit,
  FileText,
  RefreshCw,
  Sparkles,
  Search,
  CheckCircle2,
  ExternalLink,
  Layers,
  ChevronRight,
  Clock,
  Terminal,
  Database
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const DocsRagView: React.FC = () => {
  const { selectedProject, startProcessAction, loadProjectData } = useProjectStore();

  const [docsList, setDocsList] = useState<Array<{ name: string; path: string; category: string }>>([]);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string>('');
  const [ragStats, setRagStats] = useState<{ hasIndex: boolean; chunksCount: number; lastModified?: string }>({
    hasIndex: false,
    chunksCount: 0
  });
  const [isReindexing, setIsReindexing] = useState(false);
  const [filterDocQuery, setFilterDocQuery] = useState('');

  // Load project docs and RAG stats
  const fetchDocsAndStats = async () => {
    if (!selectedProject || !window.api) return;

    try {
      const stats = await window.api.getRagStats(selectedProject.path);
      setRagStats(stats);

      // Search all docs
      const allDocs = await window.api.searchDocs({
        projectPath: selectedProject.path,
        query: 'a', // match all
        mode: 'text',
        global: false,
        limit: 100
      });

      const list = allDocs
        .filter((d) => d.category === 'doc' || d.category === 'decision')
        .map((d) => ({
          name: d.heading || d.fileRelative,
          path: d.filePath,
          category: d.category === 'decision' ? 'Архитектурные решения (ADR)' : 'Документация'
        }));

      // Deduplicate by path
      const uniqueMap = new Map<string, { name: string; path: string; category: string }>();
      for (const item of list) {
        if (!uniqueMap.has(item.path)) {
          uniqueMap.set(item.path, item);
        }
      }

      const uniqueList = Array.from(uniqueMap.values());
      setDocsList(uniqueList);

      if (!selectedDocPath && uniqueList.length > 0) {
        handleSelectDoc(uniqueList[0].path);
      }
    } catch (e) {
      console.error('Failed to fetch docs and stats:', e);
    }
  };

  useEffect(() => {
    fetchDocsAndStats();
  }, [selectedProject]);

  const handleSelectDoc = async (filePath: string) => {
    setSelectedDocPath(filePath);
    if (window.api) {
      try {
        const found = await window.api.searchDocs({
          projectPath: selectedProject?.path,
          query: filePath,
          mode: 'text',
          limit: 1
        });
        if (found.length > 0) {
          setDocContent(found[0].snippet);
        } else {
          setDocContent('Документ загружается...');
        }
      } catch (e) {
        setDocContent('Не удалось загрузить содержимое документа.');
      }
    }
  };

  const handleReindex = async () => {
    if (!selectedProject) return;
    setIsReindexing(true);
    await startProcessAction('npm run index-docs', 'index-docs');
    setTimeout(() => {
      setIsReindexing(false);
      fetchDocsAndStats();
    }, 4000);
  };

  const filteredDocs = docsList.filter((d) =>
    d.name.toLowerCase().includes(filterDocQuery.toLowerCase()) ||
    d.path.toLowerCase().includes(filterDocQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 select-none">
      {/* Top Banner: RAG Stats & Indexer */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-[#141828] to-[#171b2d] border border-slate-800 shadow-xl mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              LanceDB Vector RAG База знаний
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                {ragStats.hasIndex ? `Индекс готов (${ragStats.chunksCount} чанков)` : 'Индекс не собран'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Модель эмбеддингов: <span className="font-mono text-indigo-300">Xenova/all-MiniLM-L6-v2 (384d)</span>
              {ragStats.lastModified && (
                <span> • Обновлен: {new Date(ragStats.lastModified).toLocaleDateString()}</span>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={handleReindex}
          disabled={isReindexing}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isReindexing ? 'animate-spin' : ''}`} />
          {isReindexing ? 'Индексация...' : 'Пересобрать RAG-индекс'}
        </button>
      </div>

      {/* Main Split: Left Docs List, Right Viewer */}
      <div className="flex-1 flex gap-5 overflow-hidden">
        {/* Left Column: Docs List */}
        <div className="w-72 bg-[#141724]/70 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={filterDocQuery}
                onChange={(e) => setFilterDocQuery(e.target.value)}
                placeholder="Фильтр документов..."
                className="w-full bg-[#10121d] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredDocs.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-500">
                Документы не найдены
              </div>
            )}

            {filteredDocs.map((doc) => {
              const isSelected = selectedDocPath === doc.path;
              return (
                <div
                  key={doc.path}
                  onClick={() => handleSelectDoc(doc.path)}
                  className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500/40 text-white'
                      : 'bg-[#10121d]/50 border-transparent text-slate-300 hover:bg-[#181c2d]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs font-medium block truncate">
                        {doc.name}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate block">
                        {doc.category}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Markdown Document Content */}
        <div className="flex-1 bg-[#141724]/70 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-[#111422]">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-semibold text-white truncate max-w-lg">
                {selectedDocPath || 'Выберите документ'}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 select-text">
            {selectedDocPath ? (
              <div className="prose prose-invert max-w-none text-xs text-slate-300 leading-relaxed font-mono whitespace-pre-wrap">
                {docContent || 'Загрузка содержимого документа...'}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Выберите документ в списке слева для просмотра
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
