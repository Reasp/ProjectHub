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
  MoreVertical
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { ScanSettingsModal } from '../projects/ScanSettingsModal';
import { NewProjectWizardModal } from '../projects/NewProjectWizardModal';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const {
    projects,
    selectedProject,
    selectProject,
    fetchProjects,
    isLoading,
    isScanning,
    searchQuery,
    setSearchQuery,
    filterOnlyFavorites,
    setFilterOnlyFavorites,
    addProjectByPath,
    removeProjectFromCatalog,
    toggleFavoriteProject,
    refreshSingleProject
  } = useProjectStore();

  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

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

          <div className="flex items-center justify-between pt-0.5">
            <button
              onClick={() => setFilterOnlyFavorites(!filterOnlyFavorites)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                filterOnlyFavorites
                  ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                  : 'bg-slate-800/60 hover:bg-slate-800 border border-slate-700/40 text-slate-400'
              }`}
            >
              <Star
                className={`w-3 h-3 ${filterOnlyFavorites ? 'fill-amber-400 text-amber-400' : ''}`}
              />
              {filterOnlyFavorites ? t.sidebar.favoritesOnly : t.common.all}
            </button>

            <span className="text-[11px] text-slate-500 font-mono">
              {filteredProjects.length} / {projects.length}
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

          {filteredProjects.map((project) => {
            const isSelected = selectedProject?.path === project.path;
            const todoCount = project.taskCounts?.todo || 0;
            const inProgressCount = project.taskCounts?.inProgress || 0;
            const reviewCount = project.taskCounts?.review || 0;
            const doneCount = project.taskCounts?.done || 0;
            const activeProcs = project.processStatus?.runningCount || 0;
            const hasRagReady = project.ragStatus?.ready;

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
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FolderGit2
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span
                      className={`font-semibold text-xs truncate ${
                        isSelected ? 'text-white' : 'text-slate-200'
                      }`}
                      title={project.name}
                    >
                      {project.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
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
                      title={project.favorite ? 'В избранном' : 'Добавить в избранное'}
                    >
                      <Star className={`w-3.5 h-3.5 ${project.favorite ? 'fill-amber-400' : ''}`} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        refreshSingleProject(project.path);
                      }}
                      className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition opacity-0 group-hover:opacity-100"
                      title="Обновить метаданные проекта"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Удалить проект "${project.name}" из каталога Hub? (Файлы на диске затронуты не будут)`)) {
                          removeProjectFromCatalog(project.path);
                        }
                      }}
                      className="p-1 rounded hover:bg-rose-950/40 text-slate-500 hover:text-rose-400 transition opacity-0 group-hover:opacity-100"
                      title="Удалить из каталога"
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
                    <span className="text-slate-500 italic text-[10px]">без git</span>
                  )}

                  {/* Micro Indicators: Dev process & RAG */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeProcs > 0 && (
                      <span
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-700/50 font-mono"
                        title={`Запущено процессов: ${activeProcs}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <Activity className="w-2.5 h-2.5" />
                        {activeProcs}
                      </span>
                    )}

                    {hasRagReady && (
                      <span
                        className="flex items-center gap-0.5 text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-1 py-0.5 rounded"
                        title={`RAG Индекс готов: ${project.ragStatus?.chunksCount || 0} чанков`}
                      >
                        <BookOpen className="w-2.5 h-2.5 text-indigo-400" />
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Row: Path & Backlog Task Breakdown */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 border-t border-slate-800/40">
                  <span className="truncate text-[10px] text-slate-500 max-w-[130px] font-mono" title={project.path}>
                    {project.path}
                  </span>

                  {project.taskCounts && project.taskCounts.total > 0 ? (
                    <div className="flex items-center gap-1.5">
                      {inProgressCount > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-400 font-medium" title="В работе (In Progress)">
                          <Clock className="w-2.5 h-2.5" />
                          {inProgressCount}
                        </span>
                      )}
                      {todoCount > 0 && (
                        <span className="flex items-center gap-0.5 text-slate-400" title="К выполнению (To Do)">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          {todoCount}
                        </span>
                      )}
                      {reviewCount > 0 && (
                        <span className="flex items-center gap-0.5 text-purple-400" title="На проверке (Review)">
                          <Activity className="w-2.5 h-2.5" />
                          {reviewCount}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] text-slate-600">нет задач</span>
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


