import React from 'react';
import {
  Kanban,
  GitBranch,
  GitPullRequest,
  BookOpen,
  Cpu,
  Layers,
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { KanbanBoard } from '../kanban/KanbanBoard';
import { GitInspector } from '../git/GitInspector';
import { PullRequestView } from '../pr/PullRequestView';
import { DocsRagView } from '../docs/DocsRagView';

const TABS = [
  { id: 'kanban', label: 'Задачи & Backlog', icon: Kanban },
  { id: 'git', label: 'Git Репозиторий', icon: GitBranch },
  { id: 'prs', label: 'Pull / Merge Requests', icon: GitPullRequest },
  { id: 'docs', label: 'Документация & RAG', icon: BookOpen },
  { id: 'processes', label: 'Процессы & Окружение', icon: Cpu }
] as const;

export const ProjectWorkspace: React.FC = () => {
  const { selectedProject, activeTab, setActiveTab } = useProjectStore();

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
          <Layers className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Выберите проект для начала работы</h2>
        <p className="text-xs text-slate-400 max-w-md mb-6">
          Выберите проект из списка слева или добавьте существующую папку с репозиторием.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0f1117]">
      {/* Navigation Sub-header */}
      <div className="px-6 border-b border-slate-800/80 bg-[#12151f]/40 flex items-center gap-1 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition relative ${
                isActive
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab View Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'kanban' && <KanbanBoard />}
        {activeTab === 'git' && <GitInspector />}
        {activeTab === 'prs' && <PullRequestView />}
        {activeTab === 'docs' && <DocsRagView />}

        {activeTab === 'processes' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <Cpu className="w-12 h-12 text-indigo-400/40 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Управление процессами и окружением</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              Управление фоновыми процессами и живой терминал логов доступны в нижней панели терминала и в заголовке проекта.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

