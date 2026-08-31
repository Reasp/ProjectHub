import React, { useState, useMemo } from 'react';
import {
  Plus,
  Tag,
  Target,
  Calendar,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  CheckSquare,
  Sparkles,
  AlertCircle,
  X
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { BacklogTask } from '../../types/electron';
import { TaskDetailModal } from './TaskDetailModal';
import { TaskListView } from './TaskListView';

const COLUMNS: { status: BacklogTask['status']; label: string; color: string; bg: string; borderHover: string }[] = [
  { status: 'To Do', label: 'К выполнению', color: 'text-slate-400', bg: 'border-slate-700/60', borderHover: 'border-slate-500' },
  { status: 'In Progress', label: 'В работе', color: 'text-amber-400', bg: 'border-amber-500/40', borderHover: 'border-amber-500' },
  { status: 'Review', label: 'На проверке', color: 'text-indigo-400', bg: 'border-indigo-500/40', borderHover: 'border-indigo-500' },
  { status: 'Done', label: 'Готово', color: 'text-emerald-400', bg: 'border-emerald-500/40', borderHover: 'border-emerald-500' }
];

export const KanbanBoard: React.FC = () => {
  const {
    tasks,
    milestones,
    selectedProject,
    taskViewMode,
    setTaskViewMode,
    selectedLabelFilter,
    setSelectedLabelFilter,
    selectedMilestoneFilter,
    setSelectedMilestoneFilter,
    updateTaskStatusLocal,
    saveFullTaskLocal,
    deleteTaskLocal,
    toggleCriterionLocal,
    loadProjectData
  } = useProjectStore();

  const [selectedTask, setSelectedTask] = useState<BacklogTask | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLabels, setNewLabels] = useState('');
  const [searchTaskQuery, setSearchTaskQuery] = useState('');
  const [dragOverColumn, setDragOverColumn] = useState<BacklogTask['status'] | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  // Extract all unique labels
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.labels) {
        for (const l of t.labels) set.add(l);
      }
    }
    return Array.from(set);
  }, [tasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const matchQuery =
        t.title.toLowerCase().includes(searchTaskQuery.toLowerCase()) ||
        t.id.toLowerCase().includes(searchTaskQuery.toLowerCase()) ||
        (t.description && t.description.toLowerCase().includes(searchTaskQuery.toLowerCase()));
      if (!matchQuery) return false;
      if (selectedLabelFilter && (!t.labels || !t.labels.includes(selectedLabelFilter))) {
        return false;
      }
      if (selectedMilestoneFilter) {
        const mKey = selectedMilestoneFilter.toLowerCase();
        const tMilestone = t.milestone?.toLowerCase();
        const matchedM = milestones.find((m) => m.id.toLowerCase() === mKey);
        const matches =
          tMilestone === mKey ||
          (matchedM && tMilestone === matchedM.title.toLowerCase());
        if (!matches) return false;
      }
      return true;
    });
  }, [tasks, searchTaskQuery, selectedLabelFilter, selectedMilestoneFilter, milestones]);

  // Progress metrics
  const doneCount = tasks.filter((t) => t.status === 'Done').length;
  const progressPercent = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  // Drag & Drop handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, colStatus: BacklogTask['status']) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumn !== colStatus) {
      setDragOverColumn(colStatus);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: BacklogTask['status']) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDraggingTaskId(null);

    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const targetTask = tasks.find((t) => t.id === taskId);
    if (!targetTask || targetTask.status === targetStatus) return;

    // Rule 5 check: moving to Done directly
    if (targetStatus === 'Done' && (targetTask.status === 'To Do' || targetTask.status === 'In Progress')) {
      const proceed = confirm(
        `Правило 5 Backlog.md рекомендует сначала перевести задачу в статус "Review" для проверки перед "Done".\n\nВы точно хотите перевести задачу ${targetTask.id} сразу в "Done"?`
      );
      if (!proceed) {
        // Move to Review instead
        updateTaskStatusLocal(taskId, 'Review');
        return;
      }
    }

    updateTaskStatusLocal(taskId, targetStatus);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !selectedProject || !window.api) return;

    const labels = newLabels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);

    const created = await window.api.createTask(selectedProject.path, {
      title: newTitle.trim(),
      description: newDesc.trim(),
      labels
    });

    if (created) {
      setIsCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      setNewLabels('');
      loadProjectData(selectedProject);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 select-none">
      {/* Top Header Controls */}
      <div className="flex flex-col gap-4 mb-5 shrink-0">
        <div className="flex items-center justify-between flex-nowrap gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white tracking-tight flex items-center gap-2 truncate">
              <span>Задачи проекта</span>
              <span className="text-xs font-normal text-slate-400 font-mono shrink-0 whitespace-nowrap">
                ({doneCount} из {tasks.length} выполнено • {progressPercent}%)
              </span>
            </h3>
            {/* Progress bar */}
            <div className="w-64 max-w-full h-1.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-nowrap">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-[#141724] p-1 rounded-lg border border-slate-800 shrink-0">
              <button
                onClick={() => setTaskViewMode('kanban')}
                title="Вид: Канбан-доска"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition whitespace-nowrap ${
                  taskViewMode === 'kanban'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Доска</span>
              </button>
              <button
                onClick={() => setTaskViewMode('list')}
                title="Вид: Табличный список задач"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition whitespace-nowrap ${
                  taskViewMode === 'list'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Список</span>
              </button>
            </div>

            <button
              onClick={() => setIsCreateOpen(true)}
              title="Создать новую задачу в Backlog"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Новая задача</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex items-center gap-3 flex-nowrap overflow-x-auto no-scrollbar shrink-0 py-0.5">
          <div className="relative w-64 shrink-0">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchTaskQuery}
              onChange={(e) => setSearchTaskQuery(e.target.value)}
              placeholder="Поиск по задачам и критериям..."
              className="w-full bg-[#141724] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Tag Chips */}
          <div className="flex items-center gap-1.5 shrink-0 flex-nowrap overflow-x-auto no-scrollbar">
            <button
              onClick={() => setSelectedLabelFilter(null)}
              title="Показать все задачи без фильтра по тегам"
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition whitespace-nowrap shrink-0 ${
                selectedLabelFilter === null
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'bg-[#141724] text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              Все теги
            </button>

            {allLabels.map((label) => (
              <button
                key={label}
                onClick={() =>
                  setSelectedLabelFilter(selectedLabelFilter === label ? null : label)
                }
                title={`Фильтровать по тегу "${label}"`}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition whitespace-nowrap shrink-0 ${
                  selectedLabelFilter === label
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-[#141724] text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <Tag className="w-2.5 h-2.5 shrink-0" />
                {label}
              </button>
            ))}
          </div>

          {/* Milestone Filter Dropdown */}
          {milestones.length > 0 && (
            <div className="flex items-center gap-1.5 ml-auto shrink-0 whitespace-nowrap" title="Фильтрация задач по майлстоуну">
              <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1 shrink-0">
                <Target className="w-3 h-3 text-indigo-400 shrink-0" />
                Этап:
              </span>
              <select
                value={selectedMilestoneFilter || ''}
                onChange={(e) => setSelectedMilestoneFilter(e.target.value || null)}
                className="bg-[#141724] border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Все этапы</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}: {m.title}
                  </option>
                ))}
              </select>
              {selectedMilestoneFilter && (
                <button
                  onClick={() => setSelectedMilestoneFilter(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  title="Сбросить фильтр этапа"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area: Kanban Board or List View */}
      {taskViewMode === 'list' ? (
        <TaskListView
          tasks={filteredTasks}
          onSelectTask={setSelectedTask}
          onUpdateStatus={updateTaskStatusLocal}
        />
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-4 overflow-hidden">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter(
              (t) => (t.status || 'To Do') === col.status
            );
            const isTarget = dragOverColumn === col.status;

            return (
              <div
                key={col.status}
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.status)}
                className={`flex flex-col h-full rounded-xl bg-[#141724]/70 border transition-all duration-150 overflow-hidden ${
                  isTarget
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-[#171b2d]'
                    : 'border-slate-800/80'
                }`}
              >
                {/* Column Header */}
                <div
                  className={`p-3 border-b border-slate-800 flex items-center justify-between ${col.bg}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        col.status === 'To Do'
                          ? 'bg-slate-400'
                          : col.status === 'In Progress'
                          ? 'bg-amber-400'
                          : col.status === 'Review'
                          ? 'bg-indigo-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <span className={`text-xs font-semibold ${col.color}`}>{col.label}</span>
                  </div>
                  <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {colTasks.length}
                  </span>
                </div>

                {/* Column Task Cards with DnD */}
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                  {colTasks.length === 0 && (
                    <div className="h-28 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-lg">
                      Перетащите задачу сюда
                    </div>
                  )}

                  {colTasks.map((task) => {
                    const criteria = task.acceptanceCriteria || [];
                    const completedCriteria = criteria.filter((c) => c.completed).length;
                    const isDraggingThis = draggingTaskId === task.id;

                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onClick={() => setSelectedTask(task)}
                        className={`p-3 rounded-xl glass-card cursor-grab active:cursor-grabbing transition group relative flex flex-col gap-2 border border-slate-800/80 hover:border-slate-700 ${
                          isDraggingThis ? 'opacity-40 scale-95' : 'hover:shadow-lg'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <span className="text-indigo-400 font-bold tracking-tight">
                            {task.id}
                          </span>
                          {task.created && (
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Calendar className="w-2.5 h-2.5" />
                              {task.created}
                            </span>
                          )}
                        </div>

                        <h4 className="text-xs font-semibold text-slate-100 group-hover:text-white line-clamp-2 leading-relaxed">
                          {task.title}
                        </h4>

                        {/* Acceptance Criteria Progress Badge */}
                        {criteria.length > 0 && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono pt-1">
                            <CheckSquare className="w-3 h-3 text-indigo-400" />
                            <span>
                              {completedCriteria}/{criteria.length} критериев
                            </span>
                          </div>
                        )}

                        {/* Milestone Badge */}
                        {task.milestone && (
                          <div className="flex items-center gap-1 text-[9px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded w-fit">
                            <Target className="w-2.5 h-2.5 text-indigo-400" />
                            <span>{task.milestone}</span>
                          </div>
                        )}

                        {/* Labels */}
                        {task.labels && task.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {task.labels.map((l) => (
                              <span
                                key={l}
                                className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 flex items-center gap-0.5 border border-slate-700/50"
                              >
                                <Tag className="w-2 h-2 text-indigo-400" />
                                {l}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Card Footer Info */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                          <span className="text-[10px] text-slate-500">Подробнее →</span>
                          <span className="text-[9px] font-mono text-slate-600 truncate max-w-[100px]">
                            {task.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task Details Modal */}
      <TaskDetailModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSave={saveFullTaskLocal}
        onDelete={deleteTaskLocal}
        onToggleCriterion={toggleCriterionLocal}
      />

      {/* Create Task Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form
            onSubmit={handleCreateTask}
            className="w-full max-w-lg bg-[#141724] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#161a2b]/70">
              <h3 className="text-sm font-semibold text-white">Создать новую задачу Backlog</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-slate-300 font-medium block mb-1">
                  Название задачи *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Например: Модуль визуализации Git-графа"
                  className="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="text-slate-300 font-medium block mb-1">
                  Описание (Description)
                </label>
                <textarea
                  rows={4}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Краткое описание проблемы и контекста..."
                  className="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="text-slate-300 font-medium block mb-1">
                  Теги (через запятую)
                </label>
                <input
                  type="text"
                  value={newLabels}
                  onChange={(e) => setNewLabels(e.target.value)}
                  placeholder="ui, git, backend, search"
                  className="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-[#10121d]">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                Отмена
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition"
              >
                Создать задачу
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

