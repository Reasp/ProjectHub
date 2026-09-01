import React from 'react';
import {
  Kanban,
  Target,
  GitBranch,
  FolderTree,
  GitPullRequest,
  BookOpen,
  Cpu,
  Layers,
  Sparkles,
  BarChart2,
  Bot
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { KanbanBoard } from '../kanban/KanbanBoard';
import { MilestonesRoadmapView } from '../milestones/MilestonesRoadmapView';
import { GitInspector } from '../git/GitInspector';
import { FileExplorer } from '../explorer/FileExplorer';
import { PullRequestView } from '../pr/PullRequestView';
import { DocsRagView } from '../docs/DocsRagView';
import { ProjectAnalyticsView } from '../analytics/ProjectAnalyticsView';
import { AIStudioView } from '../ai/AIStudioView';
import { ClaudeCliView } from '../claude/ClaudeCliView';

export const ProjectWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const { selectedProject, activeTab, setActiveTab } = useProjectStore();

  const tabs = [
    { id: 'kanban', label: t.tabs.tasks, shortLabel: t.tabs.tasks.split(' ')[0], hotkey: 'Ctrl+B', icon: Kanban },
    { id: 'milestones', label: t.tabs.milestones, shortLabel: t.tabs.milestones.split(' ')[0], hotkey: 'Ctrl+M', icon: Target },
    { id: 'git', label: t.tabs.git, shortLabel: 'Git', hotkey: 'Ctrl+G', icon: GitBranch },
    { id: 'files', label: t.tabs.files, shortLabel: 'Files', hotkey: 'Ctrl+E', icon: FolderTree },
    { id: 'prs', label: t.tabs.prs, shortLabel: 'PR', hotkey: 'Ctrl+P', icon: GitPullRequest },
    { id: 'docs', label: t.tabs.docs, shortLabel: 'Docs', hotkey: 'Ctrl+D', icon: BookOpen },
    { id: 'analytics', label: t.tabs.analytics, shortLabel: 'Analytics', hotkey: 'Ctrl+A', icon: BarChart2 },
    { id: 'ai', label: t.tabs.ai, shortLabel: 'Claude Studio', hotkey: 'Ctrl+I', icon: Sparkles },
    { id: 'claude-cli', label: t.tabs.claudeCli, shortLabel: 'Claude CLI', hotkey: 'Ctrl+T', icon: Bot },
    { id: 'processes', label: t.tabs.processes, shortLabel: 'Processes', hotkey: 'Ctrl+\\', icon: Cpu }
  ] as const;

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
          <Layers className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">{t.header.selectProjectHint}</h2>
        <p className="text-xs text-slate-400 max-w-md mb-6">
          {t.sidebar.noProjectsFound}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0f1117]">
      {/* Navigation Sub-header */}
      <div className="px-6 border-b border-slate-800/80 bg-[#12151f]/40 flex items-center gap-1 shrink-0 flex-nowrap overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              title={`${tab.label} (${tab.hotkey})`}
              className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition relative shrink-0 whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline">{tab.label}</span>
              <span className="hidden md:inline xl:hidden">{tab.shortLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Tab View Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === 'kanban' && <KanbanBoard />}
        {activeTab === 'milestones' && <MilestonesRoadmapView />}
        {activeTab === 'git' && <GitInspector />}
        {activeTab === 'files' && <FileExplorer />}
        {activeTab === 'prs' && <PullRequestView />}
        {activeTab === 'docs' && <DocsRagView />}
        {activeTab === 'analytics' && <ProjectAnalyticsView />}
        {activeTab === 'ai' && <AIStudioView />}
        {activeTab === 'claude-cli' && <ClaudeCliView />}

        {activeTab === 'processes' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <Cpu className="w-12 h-12 text-indigo-400/40 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">{t.terminal.processLogs}</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              {t.terminal.welcomeDesc}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
