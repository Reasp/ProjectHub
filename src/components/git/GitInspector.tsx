import React from 'react';
import { GitBranch, GitCommit as GitCommitIcon, Calendar, User, CheckCircle, Clock } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const GitInspector: React.FC = () => {
  const { gitLogs, selectedProject } = useProjectStore();

  if (!selectedProject?.hasGit) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <GitBranch className="w-12 h-12 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">Git-репозиторий не инициализирован</h3>
        <p className="text-xs text-slate-400 max-w-sm">
          В этой папке нет каталога .git. Вы можете инициализировать git репозиторий командой <code>git init</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6">
      {/* Header Info */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-indigo-400" />
            История коммитов и ветка: <span className="font-mono text-indigo-400">{selectedProject.gitBranch}</span>
          </h3>
          <p className="text-xs text-slate-400">
            Всего последних коммитов: {gitLogs.length}
          </p>
        </div>
      </div>

      {/* Commit List / Graph */}
      <div className="flex-1 overflow-y-auto rounded-xl bg-[#141724]/70 border border-slate-800/80 p-4 space-y-3">
        {gitLogs.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-xs text-slate-500">
            В репозитории пока нет коммитов.
          </div>
        ) : (
          gitLogs.map((commit, idx) => (
            <div
              key={commit.hash}
              className="p-3.5 rounded-lg glass-card flex items-start gap-3 transition group relative"
            >
              {/* Visual Graph Dot */}
              <div className="flex flex-col items-center shrink-0 mt-0.5">
                <div className="w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-indigo-500/20" />
                {idx !== gitLogs.length - 1 && (
                  <div className="w-0.5 h-12 bg-slate-800 my-1" />
                )}
              </div>

              {/* Commit Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    {commit.message}
                  </span>
                  <span className="font-mono text-[11px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 shrink-0">
                    {commit.hash.slice(0, 7)}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3 text-slate-500" />
                    {commit.author_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-500" />
                    {new Date(commit.date).toLocaleString('ru-RU')}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
