import React, { useState, useEffect, useRef } from 'react';
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
  Bot,
  SlidersHorizontal,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  AlertTriangle,
  FolderPlus,
  Star,
  FolderGit2,
  ArrowRight,
  PanelLeft,
  X
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
import { ProcessesView } from '../processes/ProcessesView';
import { useWorkspaceTabs, type WorkspaceTabId } from '../../hooks/useWorkspaceTabs';
import { WorkspaceTabsConfigModal } from './WorkspaceTabsConfigModal';
import { NewProjectWizardModal } from './NewProjectWizardModal';
import { VoiceBadge } from '../voice/VoiceBadge';

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  tabId: WorkspaceTabId | null;
}

export const ProjectWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const {
    selectedProject,
    activeTab,
    setActiveTab,
    projects,
    selectProject,
    isSidebarOpen,
    setSidebarOpen,
    addProjectByPath,
    removedProjectNotice,
    clearRemovedProjectNotice
  } = useProjectStore();

  const {
    tabsConfig,
    visibleTabs,
    hiddenTabs,
    toggleTabVisibility,
    reorderTabs,
    moveTab,
    resetToDefault,
    showAllTabs
  } = useWorkspaceTabs();

  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isHiddenDropdownOpen, setIsHiddenDropdownOpen] = useState(false);
  const [draggedTabId, setDraggedTabId] = useState<WorkspaceTabId | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<WorkspaceTabId | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    tabId: null
  });
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const hiddenDropdownRef = useRef<HTMLDivElement>(null);

  // If the active tab becomes hidden, automatically select the first visible tab
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((vt) => vt.id === activeTab)) {
      setActiveTab(visibleTabs[0].id as any);
    }
  }, [visibleTabs, activeTab, setActiveTab]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (hiddenDropdownRef.current && !hiddenDropdownRef.current.contains(e.target as Node)) {
        setIsHiddenDropdownOpen(false);
      }
      setContextMenu((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
    };

    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const tabDefs: Record<
    WorkspaceTabId,
    { label: string; shortLabel: string; hotkey?: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    kanban: { label: t.tabs.tasks, shortLabel: t.tabs.tasks.split(' ')[0], hotkey: 'Ctrl+B', icon: Kanban },
    milestones: { label: t.tabs.milestones, shortLabel: t.tabs.milestones.split(' ')[0], hotkey: 'Ctrl+M', icon: Target },
    git: { label: t.tabs.git, shortLabel: 'Git', hotkey: 'Ctrl+G', icon: GitBranch },
    files: { label: t.tabs.files, shortLabel: 'Files', hotkey: 'Ctrl+E', icon: FolderTree },
    prs: { label: t.tabs.prs, shortLabel: 'PR', hotkey: 'Ctrl+P', icon: GitPullRequest },
    docs: { label: t.tabs.docs, shortLabel: 'Docs', hotkey: 'Ctrl+D', icon: BookOpen },
    analytics: { label: t.tabs.analytics, shortLabel: 'Analytics', hotkey: 'Ctrl+A', icon: BarChart2 },
    ai: { label: t.tabs.ai, shortLabel: 'Claude Studio', hotkey: 'Ctrl+I', icon: Sparkles },
    'claude-cli': { label: t.tabs.claudeCli, shortLabel: 'Claude CLI', hotkey: 'Ctrl+T', icon: Bot },
    processes: { label: t.tabs.processes, shortLabel: 'Processes', icon: Cpu }
  };

  const voiceCommandMap: Record<WorkspaceTabId, string> = {
    kanban: t.voice.voiceBadges.tasks,
    milestones: t.voice.voiceBadges.milestones,
    git: t.voice.voiceBadges.git,
    files: t.voice.voiceBadges.files,
    prs: t.voice.voiceBadges.prs,
    docs: t.voice.voiceBadges.docs,
    analytics: t.voice.voiceBadges.analytics,
    ai: t.voice.voiceBadges.studio,
    'claude-cli': t.voice.voiceBadges.claudeCli,
    processes: t.voice.voiceBadges.processes
  };

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 text-center overflow-y-auto bg-[#0f111a] select-none">
        {/* Warning Banner if previously selected project was removed or not found */}
        {removedProjectNotice && (
          <div className="w-full max-w-2xl mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-4 text-left shadow-2xl animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-amber-200 tracking-wide">
                  {t.emptyState?.removedNoticeTitle || 'Ранее открытый проект больше недоступен или был удален'}
                </h4>
                <p className="text-[11px] text-amber-300/80 font-mono mt-1 break-all bg-black/30 px-2 py-1 rounded-md border border-amber-500/20">
                  {removedProjectNotice}
                </p>
                <p className="text-[11px] text-slate-400 mt-2">
                  {t.emptyState?.removedNoticeHint || 'Каталог проекта не найден на диске. Выберите другой проект из доступных или добавьте новую папку.'}
                </p>
              </div>
            </div>
            <button
              onClick={clearRemovedProjectNotice}
              className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-400 hover:text-white transition shrink-0"
              title={t.common.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Central Logo & Welcome Message */}
        <div className="relative mb-5">
          <div className="absolute -inset-3 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-cyan-500/20 rounded-3xl blur-2xl opacity-60" />
          <div className="relative w-20 h-20 rounded-2xl bg-[#141726] border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-2xl">
            <Layers className="w-10 h-10" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
          {t.emptyState?.title || t.header.selectProjectHint || 'Проект не выбран'}
        </h2>
        <p className="text-xs text-slate-400 max-w-lg mb-8 leading-relaxed">
          {t.emptyState?.subtitle || 'Выберите проект из списка ниже, откройте боковое меню проектов или создайте новый по шаблону ProjectTemplate.'}
        </p>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
          {!isSidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 shadow-md hover:border-slate-600 transition cursor-pointer"
            >
              <PanelLeft className="w-4 h-4 text-indigo-400" />
              <span>{t.sidebar.showSidebar || 'Открыть меню проектов'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              if (window.api) {
                const folder = await window.api.selectDirectory();
                if (folder) await addProjectByPath(folder);
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 shadow-md hover:border-slate-600 transition cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 text-cyan-400" />
            <span>{t.sidebar.addProject || 'Добавить папку'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>{t.sidebar.newFromTemplate || 'Создать по шаблону'}</span>
          </button>
        </div>

        {/* List of Available Projects in Registry */}
        {projects.length > 0 && (
          <div className="w-full max-w-3xl text-left">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t.emptyState?.availableProjects || 'Доступные проекты в реестре'} ({projects.length})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[42vh] overflow-y-auto pr-1">
              {projects.map((p) => (
                <div
                  key={p.path}
                  onClick={() => selectProject(p)}
                  className="p-3.5 rounded-xl bg-[#141724]/80 hover:bg-[#181c2d] border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition-all duration-150 group flex flex-col justify-between shadow-sm hover:shadow-md"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderGit2 className="w-4 h-4 text-indigo-400 shrink-0 group-hover:text-indigo-300 transition" />
                        <span className="font-semibold text-xs text-slate-100 group-hover:text-white truncate">
                          {p.name}
                        </span>
                      </div>
                      {p.favorite && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate mb-2" title={p.path}>
                      {p.path}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[10px] text-slate-400">
                    <span>
                      {p.taskCounts && p.taskCounts.total > 0
                        ? `${p.taskCounts.total} ${t.emptyState?.tasksCount || 'задач'}`
                        : (t.emptyState?.noTasks || 'нет задач')}
                    </span>
                    <span className="text-indigo-400 font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      {t.emptyState?.openProject || 'Открыть'} <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project Template Wizard Modal */}
        <NewProjectWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
        />
      </div>
    );
  }

  // Handle Drag & Drop reordering on the main tab strip
  const handleDragStart = (e: React.DragEvent, id: WorkspaceTabId) => {
    setDraggedTabId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: WorkspaceTabId) => {
    e.preventDefault();
    if (draggedTabId && draggedTabId !== id) {
      setDragOverTabId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: WorkspaceTabId) => {
    e.preventDefault();
    if (draggedTabId && draggedTabId !== targetId) {
      const fromIndex = tabsConfig.findIndex((t) => t.id === draggedTabId);
      const toIndex = tabsConfig.findIndex((t) => t.id === targetId);
      if (fromIndex !== -1 && toIndex !== -1) {
        reorderTabs(fromIndex, toIndex);
      }
    }
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: WorkspaceTabId) => {
    e.preventDefault();
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      tabId: id
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0f1117]">
      {/* Navigation Sub-header with Customizable Tabs */}
      <div className="px-6 border-b border-slate-800/80 bg-[#12151f]/40 flex items-center justify-between shrink-0">
        {/* Main Tab Strip */}
        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto custom-scrollbar flex-1 py-0.5">
          {visibleTabs.map((tabItem) => {
            const def = tabDefs[tabItem.id];
            if (!def) return null;
            const Icon = def.icon;
            const isActive = activeTab === tabItem.id;
            const isDragOver = dragOverTabId === tabItem.id;

            return (
              <button
                key={tabItem.id}
                draggable
                onDragStart={(e) => handleDragStart(e, tabItem.id)}
                onDragOver={(e) => handleDragOver(e, tabItem.id)}
                onDragLeave={() => {
                  if (dragOverTabId === tabItem.id) setDragOverTabId(null);
                }}
                onDrop={(e) => handleDrop(e, tabItem.id)}
                onContextMenu={(e) => handleContextMenu(e, tabItem.id)}
                onClick={() => setActiveTab(tabItem.id as any)}
                title={`${def.label}${def.hotkey ? ` (${def.hotkey})` : ''} · ${t.tabs.dragHint}`}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition relative shrink-0 whitespace-nowrap select-none group cursor-pointer ${
                  isActive
                    ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                } ${isDragOver ? 'border-l-2 border-l-indigo-400 pl-2 bg-indigo-500/10' : ''}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline">{def.label}</span>
                <span className="hidden md:inline xl:hidden">{def.shortLabel}</span>

                {/* Voice Command Marker Badge */}
                {voiceCommandMap[tabItem.id] && (
                  <VoiceBadge
                    command={voiceCommandMap[tabItem.id]}
                    variant={tabItem.id === 'ai' ? 'purple' : 'indigo'}
                  />
                )}

                {/* Subtle drag grip handle on hover */}
                <span className="opacity-0 group-hover:opacity-40 transition -mr-1">
                  <GripVertical className="w-3 h-3 text-slate-400" />
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Controls: Hidden Tabs Dropdown & Customize Tabs Button */}
        <div className="flex items-center gap-1.5 shrink-0 pl-3 border-l border-slate-800/60 py-1.5">
          {/* Hidden Tabs Dropdown (if any tabs are hidden) */}
          {hiddenTabs.length > 0 && (
            <div className="relative" ref={hiddenDropdownRef}>
              <button
                type="button"
                onClick={() => setIsHiddenDropdownOpen(!isHiddenDropdownOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 text-[11px] font-medium transition"
                title={t.tabs.hiddenTabsHeader}
              >
                <EyeOff className="w-3 h-3 text-amber-400" />
                <span className="hidden sm:inline">{t.tabs.more}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-900 font-mono text-[9px] text-amber-300">
                  {hiddenTabs.length}
                </span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {isHiddenDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-[#121522] border border-slate-700/80 rounded-xl shadow-2xl py-1.5 z-50 animate-in fade-in slide-in-from-top-1 text-xs">
                  <div className="px-3 py-1 text-[10px] uppercase font-bold tracking-wider text-slate-500 border-b border-slate-800 mb-1">
                    {t.tabs.hiddenTabsHeader}
                  </div>
                  {hiddenTabs.map((hTab) => {
                    const def = tabDefs[hTab.id];
                    if (!def) return null;
                    const Icon = def.icon;
                    return (
                      <div
                        key={hTab.id}
                        className="flex items-center justify-between px-3 py-1.5 hover:bg-slate-800/70 transition group"
                      >
                        <button
                          onClick={() => {
                            setActiveTab(hTab.id as any);
                            setIsHiddenDropdownOpen(false);
                          }}
                          className="flex items-center gap-2 text-slate-300 hover:text-white flex-1 text-left truncate"
                        >
                          <Icon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">{def.label}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTabVisibility(hTab.id);
                          }}
                          title={t.tabs.restoreTab}
                          className="p-1 rounded text-slate-500 hover:text-emerald-300 hover:bg-slate-700 transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <div className="border-t border-slate-800/80 mt-1 pt-1 px-1">
                    <button
                      onClick={() => {
                        setIsHiddenDropdownOpen(false);
                        setIsConfigModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-indigo-300 hover:bg-indigo-600/20 transition font-medium"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{t.tabs.customizeAll}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Customize Tabs Button */}
          <button
            type="button"
            onClick={() => setIsConfigModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181c2b] hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-[11px] font-medium transition"
            title={t.tabs.modalDesc}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline">{t.tabs.customize}</span>
          </button>
        </div>
      </div>

      {/* Tab Context Menu */}
      {contextMenu.isOpen && contextMenu.tabId && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-[10000] w-48 bg-[#121522] border border-slate-700/80 rounded-xl shadow-2xl py-1 text-xs text-slate-200 animate-in fade-in duration-75 select-none"
        >
          <button
            onClick={() => {
              if (contextMenu.tabId) {
                toggleTabVisibility(contextMenu.tabId);
              }
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
            }}
            disabled={visibleTabs.length <= 1}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition disabled:opacity-40 text-left"
          >
            <EyeOff className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.tabs.hideTab}</span>
          </button>
          <div className="h-px bg-slate-800 my-1" />
          <button
            onClick={() => {
              setContextMenu((prev) => ({ ...prev, isOpen: false }));
              setIsConfigModalOpen(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:bg-slate-800 hover:text-white transition text-left"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.tabs.customizeTabs}</span>
          </button>
        </div>
      )}

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

        {activeTab === 'processes' && <ProcessesView />}
      </div>

      {/* Workspace Tabs Settings Modal */}
      <WorkspaceTabsConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        tabsConfig={tabsConfig}
        onToggleVisibility={toggleTabVisibility}
        onReorder={reorderTabs}
        onMoveTab={moveTab}
        onReset={resetToDefault}
        onShowAll={showAllTabs}
      />
    </div>
  );
};
