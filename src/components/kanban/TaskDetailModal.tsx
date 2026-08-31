import React, { useState, useEffect } from 'react';
import {
  X,
  Tag,
  Calendar,
  CheckCircle2,
  Clock,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Save,
  Eye,
  Edit3,
  FileCode,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
import type { BacklogTask, TaskCriterion } from '../../types/electron';

interface TaskDetailModalProps {
  task: BacklogTask | null;
  onClose: () => void;
  onSave: (updatedTask: BacklogTask) => Promise<void>;
  onDelete: (filePath: string) => Promise<void>;
  onToggleCriterion: (filePath: string, index: number, completed: boolean) => Promise<void>;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  onClose,
  onSave,
  onDelete,
  onToggleCriterion
}) => {
  if (!task) return null;

  const [activeTab, setActiveTab] = useState<'editor' | 'raw'>('editor');
  const [previewMode, setPreviewMode] = useState(false);

  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState<BacklogTask['status']>(task.status);
  const [description, setDescription] = useState(task.description || '');
  const [labels, setLabels] = useState<string[]>(task.labels || []);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [criteria, setCriteria] = useState<TaskCriterion[]>(task.acceptanceCriteria || []);
  const [newCriterionInput, setNewCriterionInput] = useState('');
  const [rawContent, setRawContent] = useState(task.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setStatus(task.status);
    setDescription(task.description || '');
    setLabels(task.labels || []);
    setCriteria(task.acceptanceCriteria || []);
    setRawContent(task.content || '');
    setWarningMessage(null);
  }, [task]);

  const handleStatusChange = (newStatus: BacklogTask['status']) => {
    if (newStatus === 'Done' && (status === 'To Do' || status === 'In Progress')) {
      setWarningMessage(
        'Внимание (Правило 5 Backlog.md): Рекомендуется сначала перевести задачу в статус "Review" для проверки перед закрытием в "Done".'
      );
    } else {
      setWarningMessage(null);
    }
    setStatus(newStatus);
  };

  const handleAddLabel = () => {
    const trimmed = newLabelInput.trim();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
      setNewLabelInput('');
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    setLabels(labels.filter((l) => l !== labelToRemove));
  };

  const handleToggleCriterion = async (index: number) => {
    const updated = [...criteria];
    updated[index].completed = !updated[index].completed;
    setCriteria(updated);
    if (task.filePath) {
      await onToggleCriterion(task.filePath, index, updated[index].completed);
    }
  };

  const handleAddCriterion = () => {
    const trimmed = newCriterionInput.trim();
    if (trimmed) {
      setCriteria([...criteria, { text: trimmed, completed: false }]);
      setNewCriterionInput('');
    }
  };

  const handleRemoveCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated: BacklogTask = {
        ...task,
        title,
        status,
        labels,
        description,
        acceptanceCriteria: criteria
      };
      await onSave(updated);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirm(`Вы уверены, что хотите удалить задачу ${task.id}? Файл ${task.filePath} будет удален.`)) {
      await onDelete(task.filePath);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#131622] border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#171b2b]/70">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-1 rounded-md">
              {task.id}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="font-semibold text-sm text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 transition truncate max-w-md"
              placeholder="Название задачи"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#10121c] p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveTab('editor')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  activeTab === 'editor' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Редактор
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  activeTab === 'raw' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Raw Markdown
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warning Alert if any */}
        {warningMessage && (
          <div className="px-6 py-2.5 bg-amber-950/40 border-b border-amber-800/50 flex items-center gap-2.5 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{warningMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {activeTab === 'editor' ? (
            <>
              {/* Meta Row: Status & Labels */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[#171b2b]/50 border border-slate-800">
                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5">
                    Статус задачи
                  </label>
                  <select
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value as any)}
                    className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
                  >
                    <option value="To Do">○ To Do (К выполнению)</option>
                    <option value="In Progress">◒ In Progress (В работе)</option>
                    <option value="Review">◆ Review (На проверке)</option>
                    <option value="Done">✔ Done (Готово)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5">
                    Теги и лейблы
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {labels.map((l) => (
                      <span
                        key={l}
                        className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1 text-[11px]"
                      >
                        <Tag className="w-2.5 h-2.5 text-indigo-400" />
                        {l}
                        <button
                          type="button"
                          onClick={() => handleRemoveLabel(l)}
                          className="hover:text-rose-400 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newLabelInput}
                      onChange={(e) => setNewLabelInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLabel())}
                      placeholder="Добавить тег..."
                      className="bg-[#10121d] border border-slate-800 rounded-md px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 flex-1 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddLabel}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Acceptance Criteria Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                    Критерии приемки (Acceptance Criteria)
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Выполнено: {criteria.filter((c) => c.completed).length} / {criteria.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {criteria.length === 0 ? (
                    <div className="p-3 rounded-lg border border-dashed border-slate-800 text-center text-slate-500 text-xs">
                      Нет критериев приемки. Добавьте первый ниже.
                    </div>
                  ) : (
                    criteria.map((crit, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#161a29] border border-slate-800/80 group hover:border-slate-700 transition"
                      >
                        <div
                          onClick={() => handleToggleCriterion(index)}
                          className="flex items-center gap-2.5 flex-1 cursor-pointer select-none"
                        >
                          {crit.completed ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 group-hover:text-slate-400 shrink-0" />
                          )}
                          <span
                            className={`text-xs ${
                              crit.completed ? 'line-through text-slate-500' : 'text-slate-200'
                            }`}
                          >
                            {crit.text}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRemoveCriterion(index)}
                          className="p-1 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"
                          title="Удалить критерий"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add criterion input */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newCriterionInput}
                      onChange={(e) => setNewCriterionInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCriterion())}
                      placeholder="Новый критерий приемки (например: Добавлены unit-тесты)..."
                      className="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddCriterion}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Добавить
                    </button>
                  </div>
                </div>
              </div>

              {/* Description & Markdown Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                    Описание задачи (Markdown)
                  </label>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    <Eye className="w-3 h-3" />
                    {previewMode ? 'Редактировать' : 'Предпросмотр'}
                  </button>
                </div>

                {previewMode ? (
                  <div className="bg-[#0e111a] p-4 rounded-xl text-xs text-slate-300 border border-slate-800 min-h-[140px] leading-relaxed whitespace-pre-wrap">
                    {description || <span className="text-slate-600 italic">Нет описания</span>}
                  </div>
                ) : (
                  <textarea
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Подробное описание задачи, архитектурный контекст и шаги реализации..."
                    className="w-full bg-[#10121d] border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 leading-relaxed transition resize-y"
                  />
                )}
              </div>
            </>
          ) : (
            /* Raw Markdown source viewer */
            <div className="space-y-2">
              <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                Исходный файл .md
              </label>
              <pre className="bg-[#0e111a] p-4 rounded-xl text-xs text-slate-300 font-mono border border-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[50vh]">
                {rawContent}
              </pre>
            </div>
          )}

          {/* File location footer info */}
          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60 font-mono">
            <span className="truncate max-w-lg" title={task.filePath}>
              {task.filePath}
            </span>
            {task.created && <span>Создано: {task.created}</span>}
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#171b2b]/70 flex items-center justify-between">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-900/40 transition text-xs font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Удалить задачу
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium transition text-xs"
            >
              Отмена
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
