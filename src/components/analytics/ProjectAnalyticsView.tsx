import React from 'react';
import {
  BarChart2,
  TrendingUp,
  CheckCircle2,
  GitCommit,
  Tag,
  Target,
  Database,
  Activity,
  User,
  Calendar,
  Layers,
  Sparkles,
  CheckCircle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

export const ProjectAnalyticsView: React.FC = () => {
  const { t } = useTranslation();
  const {
    selectedProject,
    tasks,
    milestones,
    gitLogs,
    gitRepoDetails
  } = useProjectStore();

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <BarChart2 className="w-12 h-12 text-indigo-400/40 mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">Проект не выбран</h3>
        <p className="text-xs text-slate-400 max-w-sm">
          Выберите проект в левой панели для просмотра аналитики и метрик.
        </p>
      </div>
    );
  }

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
  const sortedLabels = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Git Authors Statistics
  const authorCounts: Record<string, number> = {};
  for (const c of gitLogs) {
    const author = c.author_name || 'Неизвестный';
    authorCounts[author] = (authorCounts[author] || 0) + 1;
  }
  const sortedAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);

  // Milestone Stats
  const completedMilestones = milestones.filter((m) => m.status === 'Completed').length;
  const milestoneProgressRate = milestones.length > 0 ? Math.round((completedMilestones / milestones.length) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-[#0f1117] p-6 space-y-6 text-xs">
      {/* Header Banner */}
      <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-r from-[#161926] via-[#141724] to-[#12151e] border border-slate-800/80 shadow-lg shrink-0 flex-nowrap overflow-hidden gap-4">
        <div className="flex items-center gap-4 min-w-0 flex-1 overflow-hidden">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner shrink-0">
            <BarChart2 className="w-6 h-6 shrink-0" />
          </div>
          <div className="min-w-0 truncate">
            <div className="flex items-center gap-2.5 truncate">
              <h1 className="text-base font-bold text-white tracking-tight truncate">{t.analytics.title}</h1>
              <span className="text-[11px] font-mono font-medium text-indigo-300 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20 flex items-center gap-1 shrink-0 whitespace-nowrap" title={selectedProject.name}>
                <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="truncate max-w-[150px]">{selectedProject.name}</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">
              {t.analytics.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
          <div className="text-right">
            <span className="text-[10px] uppercase font-semibold text-slate-500 tracking-wider block">{t.milestones.progress}</span>
            <span className="text-lg font-bold text-emerald-400 font-mono">{completionRate}%</span>
          </div>
        </div>
      </div>

      {/* Top 4 KPI Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Task Readiness */}
        <div className="p-4 rounded-xl bg-[#141724] border border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-700/80 transition">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="font-medium">{t.analytics.taskCompletionRate}</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-400 tracking-tight">{completionRate}%</span>
            <span className="text-[11px] text-slate-400 font-mono">
              {doneTasks} / {totalTasks} {t.kanban.done.toLowerCase()}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>

        {/* Card 2: Acceptance Criteria */}
        <div className="p-4 rounded-xl bg-[#141724] border border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-700/80 transition">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="font-medium">{t.analytics.criteriaCompleted}</span>
            <CheckCircle2 className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-indigo-400 tracking-tight">{criteriaRate}%</span>
            <span className="text-[11px] text-slate-400 font-mono">
              {completedCriteria}/{totalCriteria} {t.kanban.criteriaCount}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${criteriaRate}%` }}
            />
          </div>
        </div>

        {/* Card 3: Milestones Roadmap */}
        <div className="p-4 rounded-xl bg-[#141724] border border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-700/80 transition">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="font-medium">{t.analytics.tasksByMilestone}</span>
            <Target className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-cyan-400 tracking-tight">{completedMilestones}</span>
            <span className="text-[11px] text-slate-400 font-mono">
              / {milestones.length} ({milestoneProgressRate}%)
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-3 overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-500"
              style={{ width: `${milestoneProgressRate}%` }}
            />
          </div>
        </div>

        {/* Card 4: Git Activity */}
        <div className="p-4 rounded-xl bg-[#141724] border border-slate-800/80 shadow-sm flex flex-col justify-between hover:border-slate-700/80 transition">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span className="font-medium">{t.analytics.gitActivity}</span>
            <GitCommit className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-purple-400 tracking-tight">{gitLogs.length}</span>
            <span className="text-[11px] text-slate-400 font-mono">commits</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-3 truncate font-mono flex items-center justify-between">
            <span>{t.git.branches}: <strong className="text-slate-200">{gitRepoDetails?.currentBranch || 'main'}</strong></span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] ${gitRepoDetails?.isClean ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
              {gitRepoDetails?.isClean ? 'clean' : `${gitRepoDetails?.files.length} dirty`}
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Status Breakdown, Tags, Git Contributors, RAG, Milestones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Task Status Breakdown */}
        <div className="p-5 rounded-2xl bg-[#141724] border border-slate-800/80 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-400" />
              {t.analytics.tasksByStatus}
            </h3>
            <span className="text-[11px] font-mono text-slate-400">{t.common.all}: {totalTasks}</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block shadow-sm shadow-emerald-400/50" /> {t.kanban.done}
                </span>
                <span className="font-mono text-slate-300">
                  {doneTasks} ({totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-purple-400 font-medium flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400 inline-block shadow-sm shadow-purple-400/50" /> {t.kanban.review}
                </span>
                <span className="font-mono text-slate-300">
                  {reviewTasks} ({totalTasks > 0 ? Math.round((reviewTasks / totalTasks) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${totalTasks > 0 ? (reviewTasks / totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-cyan-400 font-medium flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block shadow-sm shadow-cyan-400/50" /> {t.kanban.inProgress}
                </span>
                <span className="font-mono text-slate-300">
                  {inProgressTasks} ({totalTasks > 0 ? Math.round((inProgressTasks / totalTasks) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-500"
                  style={{ width: `${totalTasks > 0 ? (inProgressTasks / totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" /> {t.kanban.todo}
                </span>
                <span className="font-mono text-slate-300">
                  {todoTasks} ({totalTasks > 0 ? Math.round((todoTasks / totalTasks) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-slate-600 transition-all duration-500"
                  style={{ width: `${totalTasks > 0 ? (todoTasks / totalTasks) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 2. Popular Tags */}
        <div className="p-5 rounded-2xl bg-[#141724] border border-slate-800/80 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Tag className="w-4 h-4 text-indigo-400" />
              {t.analytics.tasksByTag}
            </h3>
            <span className="text-[11px] font-mono text-slate-400">{Object.keys(labelCounts).length} tags</span>
          </div>

          {sortedLabels.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 italic py-6">
              {t.kanban.noTasks}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sortedLabels.map(([label, count]) => {
                const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                return (
                  <div
                    key={label}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#10131e] border border-slate-800/80 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 font-mono text-[10px] border border-indigo-500/20 truncate">
                        #{label}
                      </span>
                      <span className="text-slate-400 truncate">{count}</span>
                    </div>
                    <span className="font-mono text-slate-500 font-medium shrink-0 ml-2">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Git Authors / Contributors */}
        <div className="p-5 rounded-2xl bg-[#141724] border border-slate-800/80 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-400" />
              {t.analytics.topContributors}
            </h3>
            <span className="text-[11px] font-mono text-slate-400">{sortedAuthors.length}</span>
          </div>

          {sortedAuthors.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 italic py-6">
              {t.git.noChanges}
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortedAuthors.map(([author, count]) => (
                <div
                  key={author}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-[#10131e] border border-slate-800/80 text-[11px]"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                      {author.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-slate-200 font-semibold">{author}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {Math.round((count / (gitLogs.length || 1)) * 100)}%
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-mono text-[11px] font-semibold border border-slate-700/60">
                    {count} commits
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. RAG Knowledge Base Stats */}
        <div className="p-5 rounded-2xl bg-[#141724] border border-slate-800/80 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              {t.rag.title}
            </h3>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                selectedProject.ragStatus?.ready
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              }`}
            >
              {selectedProject.ragStatus?.ready ? t.rag.ready : t.rag.notIndexed}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div className="p-3 rounded-xl bg-[#10131e] border border-slate-800/80 flex flex-col justify-between">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">{t.rag.chunksCount}</span>
              <span className="text-xl font-bold font-mono text-slate-100 mt-1">
                {selectedProject.ragStatus?.chunksCount ?? '—'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#10131e] border border-slate-800/80 flex flex-col justify-between">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Model</span>
              <span className="text-xs font-mono text-indigo-300 truncate mt-1" title={selectedProject.ragStatus?.model || 'BAAI/bge-small-en-v1.5'}>
                {selectedProject.ragStatus?.model || 'bge-small-en-v1.5'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#10131e] border border-slate-800/80 flex flex-col justify-between sm:col-span-2">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">{t.rag.lastIndexed}</span>
              <span className="text-xs font-mono text-slate-300 mt-1">
                {selectedProject.ragStatus?.builtAt || t.rag.notIndexed}
              </span>
            </div>
          </div>
        </div>

        {/* 5. Milestones Progress Breakdown */}
        {milestones.length > 0 && (
          <div className="p-5 rounded-2xl bg-[#141724] border border-slate-800/80 flex flex-col gap-4 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                {t.milestones.title}
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                {completedMilestones} / {milestones.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {milestones.map((m) => {
                const milestoneTasks = tasks.filter((t) => t.milestone === m.id);
                const doneMTasks = milestoneTasks.filter((t) => t.status === 'Done').length;
                const mPct = milestoneTasks.length > 0 ? Math.round((doneMTasks / milestoneTasks.length) * 100) : (m.status === 'Completed' ? 100 : 0);

                return (
                  <div key={m.id} className="p-3.5 rounded-xl bg-[#10131e] border border-slate-800/80 flex flex-col justify-between gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-white truncate">{m.title}</h4>
                        <span className="text-[10px] text-slate-400 font-mono">ID: {m.id}</span>
                      </div>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-full font-semibold border shrink-0 ${
                          m.status === 'Completed'
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20'
                        }`}
                      >
                        {m.status}
                      </span>
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1 font-mono">
                        <span>{doneMTasks}/{milestoneTasks.length}</span>
                        <span>{mPct}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            m.status === 'Completed' ? 'bg-emerald-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${mPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
