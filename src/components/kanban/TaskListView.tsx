import React from 'react';
import {
  Calendar,
  Tag,
  Target,
  CheckCircle2,
  Clock,
  Activity,
  CheckCheck,
  CheckSquare,
  ArrowUpDown
} from 'lucide-react';
import type { BacklogTask } from '../../types/electron';

interface TaskListViewProps {
  tasks: BacklogTask[];
  onSelectTask: (task: BacklogTask) => void;
  onUpdateStatus: (taskId: string, newStatus: BacklogTask['status']) => void;
}

export const TaskListView: React.FC<TaskListViewProps> = ({
  tasks,
  onSelectTask,
  onUpdateStatus
}) => {
  const getStatusBadge = (status: BacklogTask['status']) => {
    switch (status) {
      case 'To Do':
        return 'bg-slate-800 text-slate-300 border-slate-700/60';
      case 'In Progress':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Review':
        return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
      case 'Done':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto rounded-xl bg-[#141724]/70 border border-slate-800/80">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-800 bg-[#161a2b]/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <th className="py-3 px-4 w-28">ID</th>
            <th className="py-3 px-4">Название задачи</th>
            <th className="py-3 px-4 w-40">Статус</th>
            <th className="py-3 px-4 w-48">Теги</th>
            <th className="py-3 px-4 w-32">Критерии</th>
            <th className="py-3 px-4 w-28">Дата</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-slate-300">
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-500">
                Задачи не найдены
              </td>
            </tr>
          ) : (
            tasks.map((task) => {
              const criteria = task.acceptanceCriteria || [];
              const completedCount = criteria.filter((c) => c.completed).length;

              return (
                <tr
                  key={task.id}
                  onClick={() => onSelectTask(task)}
                  className="hover:bg-[#181d2f]/80 transition cursor-pointer group"
                >
                  <td className="py-3 px-4 font-mono font-semibold text-indigo-400">
                    {task.id}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-100 group-hover:text-white transition">
                    <div className="flex items-center gap-2">
                      <span className="line-clamp-1">{task.title}</span>
                      {task.milestone && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                          <Target className="w-2.5 h-2.5" />
                          {task.milestone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={task.status || 'To Do'}
                      onChange={(e) => onUpdateStatus(task.id, e.target.value as any)}
                      className={`text-[11px] font-medium rounded-lg px-2.5 py-1 border focus:outline-none bg-[#10121d] ${getStatusBadge(
                        task.status || 'To Do'
                      )}`}
                    >
                      <option value="To Do">○ To Do</option>
                      <option value="In Progress">◒ In Progress</option>
                      <option value="Review">◆ Review</option>
                      <option value="Done">✔ Done</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {task.labels && task.labels.length > 0 ? (
                        task.labels.map((l) => (
                          <span
                            key={l}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50 flex items-center gap-0.5"
                          >
                            <Tag className="w-2 h-2 text-indigo-400" />
                            {l}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-600 text-[10px]">—</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {criteria.length > 0 ? (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                        <CheckSquare className="w-3 h-3 text-indigo-400" />
                        {completedCount}/{criteria.length}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-[10px]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                    {task.created || '—'}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
