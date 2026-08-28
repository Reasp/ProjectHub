import React from 'react';
import {
  Code,
  Terminal,
  FolderOpen,
  GitBranch,
  CircleDot,
  TerminalSquare,
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const Header: React.FC = () => {
  const { selectedProject, isTerminalOpen, toggleTerminal } = useProjectStore();

  if (!selectedProject) {
    return (
      <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-[#12151f]/80">
        <span className="text-xs text-slate-500">Выберите проект в левой панели</span>
      </header>
    );
  }

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

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
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
          title="Встроенная консоль логов"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
            isTerminalOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/60'
          }`}
        >
          <TerminalSquare className="w-3.5 h-3.5" />
          Логи
        </button>
      </div>
    </header>
  );
};
