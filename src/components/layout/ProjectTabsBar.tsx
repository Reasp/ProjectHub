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
import { VoiceBadge } from '../voice/VoiceBadge';

export const ProjectTabsBar: React.FC = () => {
  const { t, language } = useTranslation();
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
        {activeProjects.map((project, idx) => {
          const isSelected = selectedProject?.path === project.path;
          const agentStatus = projectAgentStatuses[project.path];
          const uncommitted = project.uncommittedCount;
          const tabNumber = idx + 1;

          return (
            <div
              key={project.path}
              onClick={() => selectProject(project)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition relative group border max-w-[220px] shrink-0 ${
                isSelected
                  ? 'bg-indigo-600/20 text-white border-indigo-500/40 shadow-sm'
                  : 'bg-[#141724]/60 hover:bg-[#181d2f] text-slate-400 hover:text-slate-200 border-slate-800/60'
              }`}
              title={t.projectTabs.tabVoiceTitle.replace('{name}', project.name).replace('{number}', String(tabNumber))}
            >
              {/* Voice / Tab Order Badge */}
              <span
                className={`text-[10px] font-mono px-1 py-0.2 rounded border transition ${
                  isSelected
                    ? 'bg-indigo-500/30 text-indigo-200 border-indigo-500/50 font-bold'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700/60 group-hover:text-slate-200'
                }`}
                title={t.projectTabs.tabVoiceNumberTooltip.replace(/\{number\}/g, String(tabNumber))}
              >
                {tabNumber}
              </span>

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

              {/* Project Name & Voice Alias */}
              <div className="flex items-center gap-1 truncate flex-1 min-w-0">
                <span className="truncate font-semibold">{project.name}</span>
                {project.voiceAlias && (
                  <span
                    className="text-[9px] font-mono px-1 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 shrink-0"
                    title={t.projectTabs.voiceAliasTooltip.replace('{alias}', project.voiceAlias)}
                  >
                    «{project.voiceAlias}»
                  </span>
                )}
                <VoiceBadge
                  command={t.projectTabs.tabVoiceCommand.replace('{number}', String(tabNumber))}
                  altCommand={project.voiceAlias}
                  variant={isSelected ? 'emerald' : 'indigo'}
                />
              </div>

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

      {/* Right Action / Counter Info with Voice Hints */}
      <div className="flex items-center gap-2 pl-2 border-l border-slate-800/60 text-[11px] font-mono text-slate-500 shrink-0">
        <VoiceBadge command={t.voice.voiceBadges.nextProject} />
        <VoiceBadge command={t.voice.voiceBadges.closeProject} variant="amber" />
        <span title={t.projectTabs.activeProjectsCount.replace('{count}', String(activeProjects.length))}>
          {activeProjects.length} {t.sidebar.activeOnly.toLowerCase()}
        </span>
      </div>
    </div>
  );
};
