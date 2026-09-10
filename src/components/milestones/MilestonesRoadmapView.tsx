import React, { useState } from 'react';
import {
  Target,
  Plus,
  Calendar,
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  ChevronRight,
  ListTodo,
  Kanban,
  Flag,
  AlertCircle,
  Sparkles,
  BarChart2
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { CreateMilestoneModal } from './CreateMilestoneModal';
import type { Milestone } from '../../types/electron';

export const MilestonesRoadmapView: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    selectedProject,
    milestones,
    tasks,
    isLoadingMilestones,
    setSelectedMilestoneFilter,
    setActiveTab,
    deleteMilestoneAction
  } = useProjectStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null);
  const [expandedMilestoneId, setExpandedMilestoneId] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setEditingMilestone(null);
    setIsModalOpen(true);
  };

  const handleEdit = (m: Milestone) => {
    setEditingMilestone(m);
    setIsModalOpen(true);
  };

  const handleDelete = async (m: Milestone) => {
    if (
      await dialog.confirm({
        message: t.milestones.confirmDelete.replace('{title}', m.title),
        danger: true
      })
    ) {
      await deleteMilestoneAction(m.filePath);
    }
  };

  const handleViewOnKanban = (m: Milestone) => {
    setSelectedMilestoneFilter(m.id);
    setActiveTab('kanban');
  };

  const getStatusBadge = (status: Milestone['status']) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            {t.milestones.statusCompleted}
          </span>
        );
      case 'In Progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Clock className="w-3 h-3" />
            {t.milestones.statusInProgress}
          </span>
        );
      case 'Deferred':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3 h-3" />
            {t.milestones.statusDeferred}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Target className="w-3 h-3" />
            {t.milestones.statusPlanning}
          </span>
        );
    }
  };

  if (!selectedProject) return null;

  // Calculate project-wide milestone statistics
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter((m) => m.status === 'Completed').length;
  const inProgressMilestones = milestones.filter((m) => m.status === 'In Progress').length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0f1117]">
      {/* Header Bar */}
      <div className="px-6 py-4 border-b border-slate-800/80 bg-[#12151f]/60 flex items-center justify-between gap-4 shrink-0 flex-nowrap overflow-hidden">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Target className="w-5 h-5 shrink-0" />
          </div>
          <div className="min-w-0 truncate">
            <div className="flex items-center gap-2 truncate">
              <h2 className="text-sm font-semibold text-white truncate">{t.milestones.title}</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0 whitespace-nowrap">
                {totalMilestones}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {t.milestones.subtitle}
            </p>
          </div>
        </div>

        <button
          onClick={handleOpenCreate}
          title={t.milestones.newMilestone}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20 shrink-0 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{t.milestones.newMilestone}</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {/* Summary Stats Cards */}
        {milestones.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-[#161922]/80 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">{t.common.all}</p>
                <p className="text-xl font-bold text-white mt-1">{totalMilestones}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                <Flag className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#161922]/80 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">{t.kanban.inProgress}</p>
                <p className="text-xl font-bold text-cyan-400 mt-1">{inProgressMilestones}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#161922]/80 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-400 font-medium">{t.kanban.done}</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{completedMilestones}</p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
          </div>
        )}

        {/* Milestones List */}
        {milestones.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-[#161922]/40">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">
              <Target className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">{t.milestones.noMilestones}</h3>
            <p className="text-xs text-slate-400 max-w-sm mb-4">
              {t.milestones.subtitle}
            </p>
            <button
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-lg shadow-indigo-600/20"
            >
              <Plus className="w-3.5 h-3.5" />
              {t.milestones.newMilestone}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {milestones.map((m) => {
              const mTasks = tasks.filter(
                (taskItem) =>
                  taskItem.milestone?.toLowerCase() === m.id.toLowerCase() ||
                  taskItem.milestone?.toLowerCase() === m.title.toLowerCase()
              );

              const totalCount = mTasks.length;
              const doneCount = mTasks.filter((taskItem) => taskItem.status === 'Done').length;
              const inProgressCount = mTasks.filter((taskItem) => taskItem.status === 'In Progress').length;
              const reviewCount = mTasks.filter((taskItem) => taskItem.status === 'Review').length;
              const todoCount = mTasks.filter((taskItem) => taskItem.status === 'To Do').length;

              const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
              const isExpanded = expandedMilestoneId === m.id;

              return (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-800/90 bg-[#161922] shadow-sm hover:border-slate-700/80 transition overflow-hidden"
                >
                  {/* Card Main Header */}
                  <div className="p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5">
                          <Target className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <span className="text-[11px] font-mono font-medium text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                              {m.id}
                            </span>
                            <h3 className="text-sm font-semibold text-white">{m.title}</h3>
                            {getStatusBadge(m.status)}
                          </div>
                          {m.description && (
                            <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                              {m.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleViewOnKanban(m)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                          title="Open Kanban board filtered by this milestone"
                        >
                          <Kanban className="w-3 h-3 text-indigo-400" />
                          {t.milestones.viewOnBoard}
                        </button>
                        <button
                          onClick={() => handleEdit(m)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                          title={t.common.edit}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar & Target Date */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                          {m.targetDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                              {t.milestones.dueDate}: <span className="text-slate-200 font-mono">{m.targetDate}</span>
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <ListTodo className="w-3.5 h-3.5 text-slate-400" />
                            {doneCount} / {totalCount} {t.kanban.done.toLowerCase()}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-semibold text-emerald-400">
                          {percent}%
                        </span>
                      </div>

                      {/* Multi-segment progress bar */}
                      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                        {doneCount > 0 && (
                          <div
                            className="bg-emerald-500 transition-all duration-500"
                            style={{ width: `${(doneCount / totalCount) * 100}%` }}
                            title={`Done: ${doneCount}`}
                          />
                        )}
                        {reviewCount > 0 && (
                          <div
                            className="bg-purple-500 transition-all duration-500"
                            style={{ width: `${(reviewCount / totalCount) * 100}%` }}
                            title={`Review: ${reviewCount}`}
                          />
                        )}
                        {inProgressCount > 0 && (
                          <div
                            className="bg-cyan-500 transition-all duration-500"
                            style={{ width: `${(inProgressCount / totalCount) * 100}%` }}
                            title={`In Progress: ${inProgressCount}`}
                          />
                        )}
                        {todoCount > 0 && (
                          <div
                            className="bg-slate-700 transition-all duration-500"
                            style={{ width: `${(todoCount / totalCount) * 100}%` }}
                            title={`To Do: ${todoCount}`}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Toggle Task List Drawer */}
                  <div className="px-5 py-2.5 bg-[#12151e]/60 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <button
                      onClick={() => setExpandedMilestoneId(isExpanded ? null : m.id)}
                      className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition font-medium"
                    >
                      <ChevronRight
                        className={`w-3.5 h-3.5 transition-transform ${
                          isExpanded ? 'rotate-90 text-indigo-400' : ''
                        }`}
                      />
                      {isExpanded ? t.milestones.hideTasks : `${t.milestones.showTasks} (${totalCount})`}
                    </button>

                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      {todoCount > 0 && <span className="text-slate-400">To Do: {todoCount}</span>}
                      {inProgressCount > 0 && <span className="text-cyan-400">In Progress: {inProgressCount}</span>}
                      {reviewCount > 0 && <span className="text-purple-400">Review: {reviewCount}</span>}
                      {doneCount > 0 && <span className="text-emerald-400">Done: {doneCount}</span>}
                    </div>
                  </div>

                  {/* Expanded Task List */}
                  {isExpanded && (
                    <div className="p-4 bg-[#10131b] border-t border-slate-800/80 flex flex-col gap-2">
                      {mTasks.length === 0 ? (
                        <p className="text-xs text-slate-500 italic py-2 text-center">
                          {t.kanban.noTasks}
                        </p>
                      ) : (
                        mTasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-[#161922] border border-slate-800/80 hover:border-slate-700 transition text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                {task.id}
                              </span>
                              <span
                                className={`font-medium ${
                                  task.status === 'Done' ? 'line-through text-slate-500' : 'text-slate-200'
                                }`}
                              >
                                {task.title}
                              </span>
                            </div>

                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                task.status === 'Done'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : task.status === 'In Progress'
                                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                  : task.status === 'Review'
                                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {task.status}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      <CreateMilestoneModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        milestoneToEdit={editingMilestone}
      />
    </div>
  );
};
