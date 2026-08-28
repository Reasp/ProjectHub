import React from 'react';
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
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const Sidebar: React.FC = () => {
  const {
    projects,
    selectedProject,
    selectProject,
    fetchProjects,
    isLoading,
    searchQuery,
    setSearchQuery
  } = useProjectStore();

  const handleAddFolder = async () => {
    if (window.api) {
      const folder = await window.api.selectDirectory();
      if (folder) {
        const details = await window.api.getProjectDetails(folder);
        if (details) {
          useProjectStore.setState((s) => ({
            projects: [details, ...s.projects.filter((p) => p.path !== details.path)]
          }));
          selectProject(details);
        }
      }
    }
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="w-72 h-screen flex flex-col glass-panel border-r border-slate-800/80 bg-[#12151f]/90 shrink-0">
      {/* App Brand Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
              ProjectHub
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                PRO
              </span>
            </h1>
          </div>
        </div>

        <button
          onClick={() => fetchProjects()}
          title="Обновить проекты"
          disabled={isLoading}
          className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {/* Project Search Bar */}
      <div className="p-3 border-b border-slate-800/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск проектов..."
            className="w-full bg-[#181c2a] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/60 transition"
          />
        </div>
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Мои проекты ({filteredProjects.length})</span>
        </div>

        {filteredProjects.length === 0 && !isLoading && (
          <div className="p-4 text-center text-xs text-slate-500">
            Проектов не найдено.
            <br />
            Нажмите «Добавить папку» ниже.
          </div>
        )}

        {filteredProjects.map((project) => {
          const isSelected = selectedProject?.path === project.path;
          const todoCount = project.taskCounts?.todo || 0;
          const inProgressCount = project.taskCounts?.inProgress || 0;

          return (
            <button
              key={project.path}
              onClick={() => selectProject(project)}
              className={`w-full text-left p-2.5 rounded-lg transition group relative flex flex-col gap-1.5 ${
                isSelected
                  ? 'bg-indigo-600/15 border border-indigo-500/40 text-white shadow-sm'
                  : 'hover:bg-slate-800/50 border border-transparent text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderGit2
                    className={`w-4 h-4 shrink-0 ${
                      isSelected ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span className="font-medium text-xs truncate">{project.name}</span>
                </div>

                {project.hasGit && project.gitBranch && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-800/80">
                    <GitBranch className="w-2.5 h-2.5 text-indigo-400" />
                    {project.gitBranch}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate text-[10px] text-slate-500 max-w-[140px]" title={project.path}>
                  {project.path}
                </span>

                {project.taskCounts && (
                  <div className="flex items-center gap-1.5">
                    {inProgressCount > 0 && (
                      <span className="flex items-center gap-0.5 text-amber-400 text-[10px]" title="В работе">
                        <Clock className="w-2.5 h-2.5" />
                        {inProgressCount}
                      </span>
                    )}
                    {todoCount > 0 && (
                      <span className="flex items-center gap-0.5 text-slate-400 text-[10px]" title="К выполнению">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {todoCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
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
          Добавить папку
        </button>

        <button
          onClick={() => {
            alert('Мастер создания нового проекта (Task-4) будет доступен в следующем обновлении.');
          }}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          Создать из шаблона
        </button>
      </div>
    </aside>
  );
};
