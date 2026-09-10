import React, { useState } from 'react';
import {
  FolderGit2,
  Plus,
  RefreshCw,
  Search,
  Layers,
  FolderPlus,
  GitBranch,
  CheckCircle2,
  Clock,
  Sparkles,
  Star,
  FolderSearch,
  Trash2,
  Cpu,
  BookOpen,
  Activity,
  FileCode,
  MoreVertical,
  Zap,
  Power,
  Mic,
  PanelLeftClose
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { ScanSettingsModal } from '../projects/ScanSettingsModal';
import { NewProjectWizardModal } from '../projects/NewProjectWizardModal';
import { VoiceBadge } from '../voice/VoiceBadge';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    projects,
    selectedProject,
    selectProject,
    fetchProjects,
    isLoading,
    isScanning,
    toggleSidebar,
    searchQuery,
    setSearchQuery,
    filterOnlyFavorites,
    setFilterOnlyFavorites,
    activeProjectPaths,
    filterOnlyActive,
    setFilterOnlyActive,
    toggleProjectActive,
    addProjectByPath,
    removeProjectFromCatalog,
    toggleFavoriteProject,
    refreshSingleProject,
    setProjectVoiceAlias,
    projectAgentStatuses
  } = useProjectStore();

  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const handleEditVoiceAlias = async (e: React.MouseEvent, project: any) => {
    e.stopPropagation();
    const promptText = t.sidebar.promptVoiceAlias;
    const current = project.voiceAlias || '';
    const newAlias = await dialog.prompt({
      message: promptText,
      defaultValue: current,
      title: t.sidebar.voiceAlias
    });
    if (newAlias !== null) {
      await setProjectVoiceAlias(project.path, newAlias);
    }
  };

  const handleAddFolder = async () => {
    if (window.api) {
      const folder = await window.api.selectDirectory();
      if (folder) {
        await addProjectByPath(folder);
      }
    }
  };

  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterOnlyFavorites && !p.favorite) return false;
    if (filterOnlyActive && !activeProjectPaths.includes(p.path)) return false;
    return true;
  });

  return (
    <>
      <aside className="w-80 h-screen flex flex-col glass-panel border-r border-slate-800/80 bg-[#12151f]/90 shrink-0 select-none">
        {/* App Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/60 bg-[#141724]/60">
          <div className="flex items-center gap-2.5">
            <img
              src="./icon.png"
              alt="ProjectHub"
              className="w-8 h-8 rounded-lg shadow-lg shadow-cyan-500/20 object-cover border border-cyan-500/30"
              onError={(e) => {
                // Fallback if icon.png isn't available
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div>
              <h1 className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
                ProjectHub
                <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  DESKTOP
                </span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsScanModalOpen(true)}
              title={t.sidebar.scanRootsConfig}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            >
              <FolderSearch className="w-4 h-4" />
            </button>

            <button
              onClick={() => fetchProjects()}
              title={t.common.refresh}
              disabled={isLoading || isScanning}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading || isScanning ? 'animate-spin text-indigo-400' : ''}`}
              />
            </button>

            {/* Collapse Sidebar Button */}
            <button
              onClick={toggleSidebar}
              title={t.sidebar.hideSidebar}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Project Search & Filter Bar */}
        <div className="p-3 border-b border-slate-800/40 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.sidebar.searchProjects}
              className="w-full bg-[#181c2a] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/60 transition"
            />
          </div>

          <div className="flex items-center justify-between pt-0.5 gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilterOnlyFavorites(!filterOnlyFavorites)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  filterOnlyFavorites
                    ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                    : 'bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 text-slate-400'
                }`}
                title={filterOnlyFavorites ? t.common.all : t.sidebar.favoritesOnly}
              >
                <Star
                  className={`w-3 h-3 ${filterOnlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`}
                />
                <span className="hidden sm:inline">{filterOnlyFavorites ? t.sidebar.favoritesOnly : t.common.all}</span>
              </button>

              <button
                onClick={() => setFilterOnlyActive(!filterOnlyActive)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
                  filterOnlyActive
                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-sm'
                    : 'bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 text-slate-400'
                }`}
                title={filterOnlyActive ? t.common.all : t.sidebar.activeOnly}
              >
                <Zap
                  className={`w-3 h-3 ${filterOnlyActive ? 'fill-emerald-400 text-emerald-400' : 'text-slate-400'}`}
                />
                <span>{t.sidebar.activeOnly}</span>
                {activeProjectPaths.length > 0 && (
                  <span className={`px-1 py-0.2 rounded-full text-[9px] font-mono ${
                    filterOnlyActive ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-900 text-slate-400'
                  }`}>
                    {activeProjectPaths.length}
                  </span>
                )}
              </button>
            </div>

            <span className="text-[11px] text-slate-500 font-mono shrink-0">
              {filteredProjects.length} / {projects.length}
            </span>
          </div>
        </div>

        {/* Voice Control Hints Banner */}
        <div className="px-3 py-1.5 border-b border-slate-800/40 bg-[#141827]/40">
          <div
            className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-indigo-200"
            title={t.sidebar.voiceHintDetails}
          >
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <Mic className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="truncate text-[10px] text-slate-300 font-medium">
                {t.sidebar.voiceHint}
              </span>
            </div>
            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-900 text-indigo-300 shrink-0 border border-slate-700/60" title={t.sidebar.toggleMenu}>
              Ctrl+[
            </span>
          </div>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {filteredProjects.length === 0 && !isLoading && (
            <div className="p-6 text-center text-xs text-slate-500 space-y-2">
              <p>{t.sidebar.noProjectsFound}</p>
              <button
                onClick={() => setIsScanModalOpen(true)}
                className="text-indigo-400 hover:text-indigo-300 underline text-xs"
              >
                {t.sidebar.scanRootsConfig}
              </button>
            </div>
          )}

          {filteredProjects.map((project, index) => {
            const isSelected = selectedProject?.path === project.path;
            const isSessionActive = activeProjectPaths.includes(project.path);
            const todoCount = project.taskCounts?.todo || 0;
            const inProgressCount = project.taskCounts?.inProgress || 0;
            const reviewCount = project.taskCounts?.review || 0;
            const doneCount = project.taskCounts?.done || 0;
            const activeProcs = project.processStatus?.runningCount || 0;
            const hasRagReady = project.ragStatus?.ready;
            const agentStatus = projectAgentStatuses[project.path];

            return (
              <div
                key={project.path}
                className={`w-full rounded-xl transition group relative flex flex-col gap-1.5 p-2.5 border cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500/40 shadow-sm'
                    : 'bg-[#151825]/60 hover:bg-[#191d2d] border-slate-800/80 hover:border-slate-700/80'
                }`}
                onClick={() => selectProject(project)}
              >
                {/* Top Row: Name, Star, and Actions */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {/* Project Index Number */}
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800/90 text-slate-400 group-hover:text-slate-200'
                      }`}
                      title={t.sidebar.voiceProjectCmd.replace('{number}', String(index + 1))}
                    >
                      #{index + 1}
                    </span>

                    <div className="relative shrink-0">
                      <FolderGit2
                        className={`w-4 h-4 ${
                          isSelected ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                        }`}
                      />
                      {isSessionActive && (
                        <span
                          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400"
                          title={t.sidebar.projectActive}
                        />
                      )}
                    </div>
                    <span
                      className={`font-semibold text-xs truncate ${
                        isSelected ? 'text-white' : 'text-slate-200'
                      }`}
                      title={project.name}
                    >
                      {project.name}
                    </span>

                    {/* Voice Badge (Alias or project number command) */}
                    {project.voiceAlias ? (
                      <span
                        className="text-[9px] font-mono px-1 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 shrink-0 flex items-center gap-1"
                        title={`${t.sidebar.voiceAlias}: «${project.voiceAlias}»`}
                      >
                        <Mic className="w-2.5 h-2.5 text-indigo-400" />
                        «{project.voiceAlias}»
                      </span>
                    ) : (
                      <VoiceBadge
                        command={t.projectTabs.tabVoiceCommand.replace('{number}', String(index + 1))}
                        variant="indigo"
                        className="shrink-0 text-[9px]"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Session Activate / Deactivate Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleProjectActive(project);
                      }}
                      className={`p-1 rounded hover:bg-slate-800 transition ${
                        isSessionActive
                          ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-500/40'
                          : 'text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100'
                      }`}
                      title={isSessionActive ? t.sidebar.deactivateProject : t.sidebar.activateProject}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>

                    {/* Voice Alias Quick Edit Button */}
                    <button
                      onClick={(e) => handleEditVoiceAlias(e, project)}
                      className={`p-1 rounded hover:bg-slate-800 transition ${
                        project.voiceAlias
                          ? 'text-indigo-400 opacity-100'
                          : 'text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100'
                      }`}
                      title={project.voiceAlias ? `${t.sidebar.changeVoiceAlias}: «${project.voiceAlias}»` : t.sidebar.setVoiceAlias}
                    >
                      <Mic className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavoriteProject(project.path);
                      }}
                      className={`p-1 rounded hover:bg-slate-800 transition ${
                        project.favorite
                          ? 'text-amber-400'
                          : 'text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100'
                      }`}
                      title={project.favorite ? t.sidebar.inFavorites : t.sidebar.addToFavorites}
                    >
                      <Star className={`w-3.5 h-3.5 ${project.favorite ? 'fill-amber-400' : ''}`} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshSingleProject(project.path);
                      }}
                      className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition opacity-0 group-hover:opacity-100"
                      title={t.sidebar.refreshMetadata}
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>

                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (
                          await dialog.confirm({
                            message: t.sidebar.confirmRemoveProject.replace('{name}', project.name),
                            danger: true
                          })
                        ) {
                          removeProjectFromCatalog(project.path);
                        }
                      }}
                      className="p-1 rounded hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 transition opacity-0 group-hover:opacity-100"
                      title={t.sidebar.removeFromCatalog}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Second Row: Git Status & Status Badges */}
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  {project.hasGit && project.gitBranch ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/50">
                        <GitBranch className="w-2.5 h-2.5 text-indigo-400" />
                        {project.gitBranch}
                      </span>

                      {project.uncommittedCount !== undefined && project.uncommittedCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                          +{project.uncommittedCount}
                        </span>
                      ) : (
                        <span className="text-emerald-400/80 font-mono text-[9px]">clean</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-500 italic text-[10px]">{t.sidebar.noGit}</span>
                  )}

                  {/* Processes and RAG */}
                  <div className="flex items-center gap-1.5">
                    {activeProcs > 0 && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono text-[9px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {activeProcs} proc
                      </span>
                    )}

                    {hasRagReady && (
                      <span
                        className="p-0.5 rounded text-indigo-400"
                        title={t.sidebar.ragReadyTooltip.replace('{count}', String(project.ragStatus?.chunksCount || 0))}
                      >
                        <BookOpen className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Claude Agent Live Status Alert */}
                {agentStatus && agentStatus.status !== 'idle' && (
                  <div className="pt-0.5">
                    {agentStatus.status === 'waiting_approval' ? (
                      <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/60 text-amber-200 text-[10px] font-medium shadow-sm animate-pulse">
                        <span className="flex items-center gap-1">
                          <span className="text-amber-400 font-bold">⚠️</span>
                          <span className="font-bold">{t.sidebar.requiresDecisionExclamation}</span>
                        </span>
                        <span className="text-[9px] bg-amber-500/30 text-amber-200 px-1 py-0.2 rounded font-mono">
                          Human-in-the-loop
                        </span>
                      </div>
                    ) : agentStatus.status === 'running' ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-indigo-300 text-[10px]">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                        <span className="font-bold text-amber-400">✳</span>
                        <span className="truncate">{agentStatus.lastMessage || t.sidebar.agentWorking}</span>
                      </div>
                    ) : agentStatus.status === 'done' ? (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-800/50 text-emerald-300 text-[10px]">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{t.sidebar.claudeFinishedTask}</span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Bottom Row: Path & Backlog Task Breakdown */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 border-t border-slate-800/40">
                  <span className="truncate text-[10px] text-slate-500 max-w-[130px] font-mono" title={project.path}>
                    {project.path}
                  </span>

                  {project.taskCounts && project.taskCounts.total > 0 ? (
                    <div className="flex items-center gap-1.5">
                      {inProgressCount > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-400 font-medium" title={t.sidebar.inProgressTooltip}>
                          <Clock className="w-2.5 h-2.5" />
                          {inProgressCount}
                        </span>
                      )}
                      {todoCount > 0 && (
                        <span className="flex items-center gap-0.5 text-slate-400" title={t.sidebar.toDoTooltip}>
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          {todoCount}
                        </span>
                      )}
                      {reviewCount > 0 && (
                        <span className="flex items-center gap-0.5 text-purple-400" title={t.sidebar.reviewTooltip}>
                          <Activity className="w-2.5 h-2.5" />
                          {reviewCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-600">{t.sidebar.noTasks}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Action Footer */}
        <div className="p-3 border-t border-slate-800/60 bg-[#141724]/90 space-y-2">
          <button
            onClick={handleAddFolder}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition border border-slate-700/60"
          >
            <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
            {t.sidebar.addProject}
          </button>

          <button
            onClick={() => setIsWizardOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {t.sidebar.newFromTemplate}
          </button>
        </div>
      </aside>

      {/* Modal: Scan & Registry Settings */}
      <ScanSettingsModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
      />

      {/* Modal: Project Template Wizard */}
      <NewProjectWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
      />
    </>
  );
};


