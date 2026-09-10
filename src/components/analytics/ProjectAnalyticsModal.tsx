import React from 'react';
import {
  X,
  BarChart2,
  TrendingUp,
  CheckCircle2,
  Clock,
  GitCommit,
  GitBranch,
  FileCode,
  Tag,
  Target,
  Sparkles,
  Database,
  Layers,
  Activity,
  User
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectAnalyticsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const {
    selectedProject,
    tasks,
    milestones,
    gitLogs,
    gitRepoDetails
  } = useProjectStore();

  if (!isOpen || !selectedProject) return null;

  // Task Statistics
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === 'Done').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'In Progress').length;
  const reviewTasks = tasks.filter((t) => t.status === 'Review').length;
  const todoTasks = tasks.filter((t) => t.status === 'To Do').length;
  const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Acceptance Criteria Statistics
  let totalCriteria = 0;
  let completedCriteria = 0;
  for (const t of tasks) {
    if (t.acceptanceCriteria) {
      totalCriteria += t.acceptanceCriteria.length;
      completedCriteria += t.acceptanceCriteria.filter((c) => c.completed).length;
    }
  }
  const criteriaRate = totalCriteria > 0 ? Math.round((completedCriteria / totalCriteria) * 100) : 0;

  // Label Frequency
  const labelCounts: Record<string, number> = {};
  for (const t of tasks) {
    if (t.labels) {
      for (const l of t.labels) {
        labelCounts[l] = (labelCounts[l] || 0) + 1;
      }
    }
  }
  const sortedLabels = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Git Authors Statistics
  const authorCounts: Record<string, number> = {};
  for (const c of gitLogs) {
    const author = c.author_name || t.analytics.unknownAuthor;
    authorCounts[author] = (authorCounts[author] || 0) + 1;
  }
  const sortedAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);

  // Milestone Stats
  const completedMilestones = milestones.filter((m) => m.status === 'Completed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-[#141724] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#10131e]/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">{t.analytics.healthModalTitle}</h2>
                <span className="text-[10px] font-mono font-medium text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  {selectedProject.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {t.analytics.healthModalDesc}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#161922] border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>{t.analytics.taskReadiness}</span>
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-400">{completionRate}%</span>
                <span className="text-[10px] text-slate-500">
                  {doneTasks}/{totalTasks} {t.analytics.tasksClosed}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#161922] border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Acceptance Criteria</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-indigo-400">{criteriaRate}%</span>
                <span className="text-[10px] text-slate-500">
                  {completedCriteria}/{totalCriteria} {t.analytics.checkpoints}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${criteriaRate}%` }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#161922] border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>{t.milestones.title}</span>
                <Target className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-cyan-400">{completedMilestones}</span>
                <span className="text-[10px] text-slate-500">
                  {t.analytics.stagesCount.replace('{total}', String(milestones.length))}
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
                <div
                  className="h-full bg-cyan-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${milestones.length > 0 ? (completedMilestones / milestones.length) * 100 : 0}%`
                  }}
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#161922] border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>{t.analytics.gitHistory}</span>
                <GitCommit className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-purple-400">{gitLogs.length}</span>
                <span className="text-[10px] text-slate-500">{t.analytics.commitsInCache}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-3 truncate font-mono">
                {gitRepoDetails?.currentBranch || 'main'} ({gitRepoDetails?.isClean ? 'clean' : `${gitRepoDetails?.files.length} changed`})
              </div>
            </div>
          </div>

          {/* Detailed Sections Grid */}
          <div className="grid grid-cols-2 gap-6">
            {/* Task Status Breakdown */}
            <div className="p-5 rounded-xl bg-[#161922] border border-slate-800 flex flex-col gap-4">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                {t.analytics.tasksByStatus}
              </h3>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> {t.kanban.done}
                    </span>
                    <span className="font-mono text-slate-300">
                      {doneTasks} ({totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-purple-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> {t.kanban.review}
                    </span>
                    <span className="font-mono text-slate-300">
                      {reviewTasks} ({totalTasks > 0 ? Math.round((reviewTasks / totalTasks) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all duration-500"
                      style={{ width: `${totalTasks > 0 ? (reviewTasks / totalTasks) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-cyan-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> {t.kanban.inProgress}
                    </span>
                    <span className="font-mono text-slate-300">
                      {inProgressTasks} ({totalTasks > 0 ? Math.round((inProgressTasks / totalTasks) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 transition-all duration-500"
                      style={{ width: `${totalTasks > 0 ? (inProgressTasks / totalTasks) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" /> {t.kanban.todo}
                    </span>
                    <span className="font-mono text-slate-300">
                      {todoTasks} ({totalTasks > 0 ? Math.round((todoTasks / totalTasks) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-slate-600 transition-all duration-500"
                      style={{ width: `${totalTasks > 0 ? (todoTasks / totalTasks) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Popular Tags */}
            <div className="p-5 rounded-xl bg-[#161922] border border-slate-800 flex flex-col gap-4">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-indigo-400" />
                {t.analytics.tagsDistribution}
              </h3>

              {sortedLabels.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4 text-center">
                  {t.analytics.noTagsAssigned}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {sortedLabels.map(([label, count]) => {
                    const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                    return (
                      <div key={label} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono border border-slate-700/60">
                            {label}
                          </span>
                          <span className="text-slate-400">{count} {t.sidebar.tasksCount}</span>
                        </div>
                        <span className="font-mono text-slate-500">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Git Authors */}
            <div className="p-5 rounded-xl bg-[#161922] border border-slate-800 flex flex-col gap-4">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                {t.analytics.topContributors}
              </h3>

              {sortedAuthors.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4 text-center">
                  {t.analytics.commitsEmptyOrNotLoaded}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {sortedAuthors.map(([author, count]) => (
                    <div
                      key={author}
                      className="flex items-center justify-between p-2 rounded-lg bg-[#12151e] border border-slate-800 text-[11px]"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-[10px]">
                          {author.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-slate-200 font-medium">{author}</span>
                      </div>
                      <span className="text-slate-400 font-mono">{t.analytics.commitsCount.replace('{count}', String(count))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RAG Knowledge Base Stats */}
            <div className="p-5 rounded-xl bg-[#161922] border border-slate-800 flex flex-col gap-4">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                {t.analytics.ragStats}
              </h3>

              <div className="space-y-3 text-[11px]">
                <div className="flex justify-between p-2.5 rounded-lg bg-[#12151e] border border-slate-800">
                  <span className="text-slate-400">{t.analytics.ragIndexStatus}</span>
                  <span
                    className={`font-semibold ${
                      selectedProject.ragStatus?.ready ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {selectedProject.ragStatus?.ready ? t.analytics.ragActiveReady : t.analytics.ragBuildRequired}
                  </span>
                </div>

                <div className="flex justify-between p-2.5 rounded-lg bg-[#12151e] border border-slate-800">
                  <span className="text-slate-400">{t.analytics.ragChunksCount}</span>
                  <span className="font-mono text-slate-200 font-bold">
                    {selectedProject.ragStatus?.chunksCount ?? '—'}
                  </span>
                </div>

                <div className="flex justify-between p-2.5 rounded-lg bg-[#12151e] border border-slate-800">
                  <span className="text-slate-400">{t.analytics.ragEmbeddingModel}</span>
                  <span className="font-mono text-indigo-300">
                    {selectedProject.ragStatus?.model || 'BAAI/bge-small-en-v1.5'}
                  </span>
                </div>

                <div className="flex justify-between p-2.5 rounded-lg bg-[#12151e] border border-slate-800">
                  <span className="text-slate-400">{t.analytics.ragLastIndexedDate}</span>
                  <span className="font-mono text-slate-300">
                    {selectedProject.ragStatus?.builtAt || t.analytics.ragNeverIndexed}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-[#10131e]/90 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>{t.analytics.realtimeUpdateNotice}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
