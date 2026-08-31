import React, { useState } from 'react';
import { X, BookOpen, ShieldCheck, Tag, FileText, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

interface CreateDocModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateDocModal: React.FC<CreateDocModalProps> = ({ isOpen, onClose }) => {
  const { createDocAction, selectedProject } = useProjectStore();

  const [type, setType] = useState<'doc' | 'decision'>('decision');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'Proposed' | 'Accepted' | 'Rejected'>('Accepted');
  const [tagsInput, setTagsInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !selectedProject) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Укажите название документа или решения');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    try {
      const created = await createDocAction({
        type,
        title: title.trim(),
        status: type === 'decision' ? status : undefined,
        tags: tags.length > 0 ? tags : undefined
      });

      if (created) {
        onClose();
        setTitle('');
        setTagsInput('');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка создания документа');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121522] border border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-[#171b2d] to-[#141828]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Создать документ / ADR</h2>
              <p className="text-[11px] text-slate-400">Проект: {selectedProject.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Type Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300">Тип документа</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('decision')}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition ${
                  type === 'decision'
                    ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                    : 'bg-[#10121d] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold">Архитектурное решение (ADR)</span>
                </div>
                <span className="text-[10px] text-slate-500">
                  Сохраняется в <code className="font-mono text-indigo-300/80">backlog/decisions/</code>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setType('doc')}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition ${
                  type === 'doc'
                    ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                    : 'bg-[#10121d] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-semibold">Документация</span>
                </div>
                <span className="text-[10px] text-slate-500">
                  Сохраняется в <code className="font-mono text-indigo-300/80">backlog/docs/</code>
                </span>
              </button>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              Заголовок <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === 'decision'
                  ? 'например: Выбор стека Electron и Tailwind v4'
                  : 'например: Архитектура модулей и IPC'
              }
              className="w-full bg-[#10121d] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Decision Status if ADR */}
          {type === 'decision' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Статус решения</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Accepted', 'Proposed', 'Rejected'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatus(st)}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium border transition ${
                      status === st
                        ? st === 'Accepted'
                          ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                          : st === 'Proposed'
                          ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                          : 'bg-rose-600/20 border-rose-500/40 text-rose-300'
                        : 'bg-[#10121d] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'Accepted' ? 'Принято (Accepted)' : st === 'Proposed' ? 'Предложено' : 'Отклонено'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-slate-400" />
              Теги (через запятую)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="architecture, electron, storage, api"
              className="w-full bg-[#10121d] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-800 text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSubmitting ? 'Создание...' : 'Создать документ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
