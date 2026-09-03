import React, { useRef } from 'react';
import {
  FolderGit2,
  Folder,
  X,
  Plus,
  GitBranch,
  Layers,
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

export const ProjectTabsBar: React.FC = () => {
  const { t } = useTranslation();
  const {
    projects,
    activeProjectPaths,
    selectedProject,
    selectProject,
    deactivateProject,
    projectAgentStatuses
  } = useProjectStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter projects list to only those currently active
  const activeProjects = projects.filter((p) => activeProjectPaths.includes(p.path));

  // If no projects are open in tabs, do not render empty bar
  if (activeProjects.length === 0) return null;

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleCloseTab = (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation();
    deactivateProject(projectPath);
  };

  return (
    <div className="flex items-center bg-[#0d101a] border-b border-slate-800/80 px-2 select-none shrink-0 h-10 overflow-hidden relative">
      {/* Scrollable Tabs List */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 h-full py-1 scroll-smooth"
      >
        {activeProjects.map((project) => {
          const isSelected = selectedProject?.path === project.path;
          const agentStatus = projectAgentStatuses[project.path];
          const uncommitted = project.uncommittedCount;

          return (
            <div
              key={project.path}
              onClick={() => selectProject(project)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition relative group border max-w-[200px] shrink-0 ${
                isSelected
                  ? 'bg-indigo-600/20 text-white border-indigo-500/40 shadow-sm'
                  : 'bg-[#141724]/60 hover:bg-[#181d2f] text-slate-400 hover:text-slate-200 border-slate-800/60'
              }`}
              title={`${project.name} (${project.path})`}
            >
              {/* Project Icon */}
              {project.hasGit ? (
                <FolderGit2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'
                  }`}
                />
              ) : (
                <Folder
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSelected ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'
                  }`}
                />
              )}

              {/* Project Name */}
              <span className="truncate flex-1 font-semibold">{project.name}</span>

              {/* Git Uncommitted Badge */}
              {uncommitted !== undefined && uncommitted > 0 && (
                <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                  +{uncommitted}
                </span>
              )}

              {/* Agent Active Indicator */}
              {agentStatus?.status === 'running' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
              )}

              {/* Close Tab Button */}
              <button
                type="button"
                onClick={(e) => handleCloseTab(e, project.path)}
                className={`p-0.5 rounded-md hover:bg-slate-700/60 transition shrink-0 ${
                  isSelected
                    ? 'text-indigo-300 hover:text-white'
                    : 'text-slate-500 hover:text-slate-300 opacity-60 group-hover:opacity-100'
                }`}
                title={t.projectTabs.closeTab}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Right Action / Counter Info */}
      <div className="flex items-center gap-2 pl-2 border-l border-slate-800/60 text-[11px] font-mono text-slate-500 shrink-0">
        <span title={t.projectTabs.activeProjectsCount.replace('{count}', String(activeProjects.length))}>
          {activeProjects.length} {t.sidebar.activeOnly.toLowerCase()}
        </span>
      </div>
    </div>
  );
};
