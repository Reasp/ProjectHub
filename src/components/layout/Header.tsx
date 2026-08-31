import React from 'react';
import {
  Code,
  Terminal,
  FolderOpen,
  GitBranch,
  CircleDot,
  TerminalSquare,
  Sparkles,
  Play,
  Square,
  RefreshCw,
  HelpCircle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const Header: React.FC = () => {
  const {
    selectedProject,
    isTerminalOpen,
    toggleTerminal,
    setHotkeysHelpOpen,
    processes,
    startProcessAction,
    stopProcessAction
  } = useProjectStore();

  if (!selectedProject) {
    return (
      <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-[#12151f]/80">
        <span className="text-xs text-slate-500">Выберите проект в левой панели</span>
      </header>
    );
  }

  const devProcess = processes.find((p) => p.name === 'dev' && p.status === 'running');

  const handleOpenCode = () => {
    if (window.api && selectedProject) {
      window.api.openInCode(selectedProject.path);
    }
  };

  const handleOpenTerminal = () => {
    if (window.api && selectedProject) {
      window.api.openTerminal(selectedProject.path);
    }
  };

  const handleOpenExplorer = () => {
    if (window.api && selectedProject) {
      window.api.openInExplorer(selectedProject.path);
    }
  };

  return (
    <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-[#12151f]/80 backdrop-blur-md shrink-0">
      {/* Left: Project title & Git info */}
      <div className="flex items-center gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
            {selectedProject.name}
            {selectedProject.hasInfraConfig && (
              <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> ProjectTemplate
              </span>
            )}
          </h2>
          <p className="text-[11px] text-slate-400 font-mono truncate max-w-md">
            {selectedProject.path}
          </p>
        </div>

        {selectedProject.hasGit && selectedProject.gitBranch && (
          <div className="flex items-center gap-2 pl-3 border-l border-slate-800">
            <span className="flex items-center gap-1.5 text-xs text-slate-300 font-mono px-2 py-1 rounded bg-[#181c2b] border border-slate-800">
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              {selectedProject.gitBranch}
            </span>

            {selectedProject.uncommittedCount !== undefined && (
              <span
                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border font-mono ${
                  selectedProject.uncommittedCount === 0
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                }`}
                title={
                  selectedProject.uncommittedCount === 0
                    ? 'Рабочее дерево чисто'
                    : `Есть измененные файлы: ${selectedProject.uncommittedCount}`
                }
              >
                <CircleDot className="w-2.5 h-2.5" />
                {selectedProject.uncommittedCount === 0 ? 'clean' : `${selectedProject.uncommittedCount} dirty`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Actions & Process Controls */}
      <div className="flex items-center gap-2">
        {/* Quick Dev Server Control Button */}
        {devProcess ? (
          <button
            onClick={() => stopProcessAction(devProcess.id)}
            title="Остановить локальный dev-сервер"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 text-xs font-semibold text-rose-300 border border-rose-800/50 shadow-md shadow-rose-950/20 transition"
          >
            <Square className="w-3 h-3 text-rose-400 fill-rose-400" />
            Стоп Dev
          </button>
        ) : (
          <button
            onClick={() => startProcessAction('npm run dev', 'dev')}
            title="Запустить локальный dev-сервер"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 text-xs font-semibold text-emerald-300 border border-emerald-800/50 shadow-md shadow-emerald-950/20 transition"
          >
            <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
            Старт Dev
          </button>
        )}

        <button
          onClick={() => startProcessAction('npm run index-docs', 'index-docs')}
          title="Собрать векторный RAG-индекс документации"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition"
        >
          <RefreshCw className="w-3 h-3 text-indigo-400" />
          Индекс RAG
        </button>

        <div className="w-px h-6 bg-slate-800 mx-1" />

        <button
          onClick={handleOpenCode}
          title="Открыть в VS Code"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition"
        >
          <Code className="w-3.5 h-3.5 text-blue-400" />
          VS Code
        </button>

        <button
          onClick={handleOpenTerminal}
          title="Открыть внешний терминал"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition"
        >
          <Terminal className="w-3.5 h-3.5 text-amber-400" />
          Терминал
        </button>

        <button
          onClick={handleOpenExplorer}
          title="Открыть папку в проводнике"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition"
        >
          <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
          Папка
        </button>

        <div className="w-px h-6 bg-slate-800 mx-1" />

        <button
          onClick={toggleTerminal}
          title="Встроенная интерактивная консоль (Ctrl+\)"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
            isTerminalOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/60'
          }`}
        >
          <TerminalSquare className="w-3.5 h-3.5" />
          Терминал
        </button>

        <button
          onClick={() => setHotkeysHelpOpen(true)}
          title="Справка по горячим клавишам (?)"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};

