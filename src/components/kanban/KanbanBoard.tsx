import React, { useState } from 'react';
import {
  Plus,
  Tag,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  CheckCheck,
  FileText,
  X
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { BacklogTask } from '../../types/electron';

const COLUMNS: { status: BacklogTask['status']; label: string; color: string; bg: string }[] = [
  { status: 'To Do', label: 'К выполнению', color: 'text-slate-400', bg: 'border-slate-700/60' },
  { status: 'In Progress', label: 'В работе', color: 'text-amber-400', bg: 'border-amber-500/40' },
  { status: 'Review', label: 'На проверке', color: 'text-indigo-400', bg: 'border-indigo-500/40' },
  { status: 'Done', label: 'Готово', color: 'text-emerald-400', bg: 'border-emerald-500/40' }
];

export const KanbanBoard: React.FC = () => {
  const { tasks, selectedProject, updateTaskStatusLocal, loadProjectData } = useProjectStore();
  const [selectedTask, setSelectedTask] = useState<BacklogTask | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLabels, setNewLabels] = useState('');

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !selectedProject || !window.api) return;

    const labels = newLabels.split(',').map((l) => l.trim()).filter(Boolean);
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
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6">
      {/* Top Bar with Add button */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-white tracking-tight">
            Доска задач Backlog.md
          </h3>
          <p className="text-xs text-slate-400">
            Всего задач: {tasks.length}
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-md shadow-indigo-600/20 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Создать задачу
        </button>
      </div>

      {/* 4 Kanban Columns */}
      <div className="flex-1 grid grid-cols-4 gap-4 overflow-hidden">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => (t.status || 'To Do') === col.status);

          return (
            <div
              key={col.status}
              className="flex flex-col h-full rounded-xl bg-[#141724]/70 border border-slate-800/80 overflow-hidden"
            >
              {/* Column Header */}
              <div className={`p-3 border-b border-slate-800 flex items-center justify-between ${col.bg}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    col.status === 'To Do' ? 'bg-slate-400' :
                    col.status === 'In Progress' ? 'bg-amber-400' :
                    col.status === 'Review' ? 'bg-indigo-400' : 'bg-emerald-400'
                  }`} />
                  <span className={`text-xs font-semibold ${col.color}`}>{col.label}</span>
                </div>
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                  {colTasks.length}
                </span>
              </div>

              {/* Column Task Cards */}
              <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                {colTasks.length === 0 && (
                  <div className="h-28 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800/80 rounded-lg">
                    Нет задач
                  </div>
                )}

                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTask(task)}
                    className="p-3 rounded-lg glass-card cursor-pointer transition group relative flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span className="text-indigo-400 font-semibold">{task.id}</span>
                      {task.created && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-500">
                          <Calendar className="w-2.5 h-2.5" />
                          {task.created}
                        </span>
                      )}
                    </div>

                    <h4 className="text-xs font-medium text-slate-200 line-clamp-2 leading-relaxed">
                      {task.title}
                    </h4>

                    {task.labels && task.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {task.labels.map((l) => (
                          <span
                            key={l}
                            className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 flex items-center gap-0.5"
                          >
                            <Tag className="w-2 h-2 text-indigo-400" />
                            {l}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Quick Move Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 mt-1">
                      <select
                        value={task.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateTaskStatusLocal(task.id, e.target.value as any)}
                        className="bg-[#10131d] text-[10px] font-medium text-slate-300 rounded px-1.5 py-0.5 border border-slate-700/60 focus:outline-none"
                      >
                        <option value="To Do">To Do</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Review">Review</option>
                        <option value="Done">Done</option>
                      </select>

                      <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition">
                        Открыть →
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl bg-[#141724] border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">
                  {selectedTask.id}
                </span>
                <h3 className="text-sm font-semibold text-white truncate max-w-md">
                  {selectedTask.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400 font-medium">Статус:</label>
                <select
                  value={selectedTask.status}
                  onChange={(e) => {
                    const newStatus = e.target.value as any;
                    setSelectedTask({ ...selectedTask, status: newStatus });
                    updateTaskStatusLocal(selectedTask.id, newStatus);
                  }}
                  className="bg-[#1c2133] text-xs font-medium text-white rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none"
                >
                  <option value="To Do">To Do</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Review">Review</option>
                  <option value="Done">Done</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-medium block mb-1.5">
                  Содержимое файла задачи:
                </label>
                <pre className="bg-[#0e111a] p-4 rounded-xl text-xs text-slate-300 font-mono overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
                  {selectedTask.content || 'Нет описания'}
                </pre>
              </div>

              <div className="text-[11px] text-slate-500 font-mono">
                Путь к файлу: {selectedTask.filePath}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Task Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form
            onSubmit={handleCreateTask}
            className="w-full max-w-lg bg-[#141724] border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Создать новую задачу Backlog</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Название задачи *
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Например: Реализация модуля аналитики"
                  className="w-full bg-[#181c2a] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Описание (Description)
                </label>
                <textarea
                  rows={4}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Краткое описание проблемы и контекста..."
                  className="w-full bg-[#181c2a] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-medium block mb-1">
                  Теги (через запятую)
                </label>
                <input
                  type="text"
                  value={newLabels}
                  onChange={(e) => setNewLabels(e.target.value)}
                  placeholder="frontend, auth, api"
                  className="w-full bg-[#181c2a] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2 bg-[#10131d]">
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
