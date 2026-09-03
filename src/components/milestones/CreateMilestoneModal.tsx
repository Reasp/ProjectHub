import React, { useState } from 'react';
import { X, Target, Calendar, AlignLeft, CheckCircle } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import type { Milestone, CreateMilestoneParams } from '../../types/electron';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  milestoneToEdit?: Milestone | null;
}

export const CreateMilestoneModal: React.FC<Props> = ({ isOpen, onClose, milestoneToEdit }) => {
  const { t } = useTranslation();
  const { createMilestoneAction, saveMilestoneAction } = useProjectStore();

  const [title, setTitle] = useState(milestoneToEdit?.title || '');
  const [description, setDescription] = useState(milestoneToEdit?.description || '');
  const [targetDate, setTargetDate] = useState(milestoneToEdit?.targetDate || '');
  const [status, setStatus] = useState<Milestone['status']>(milestoneToEdit?.status || 'Planning');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Укажите название майлстоуна');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (milestoneToEdit) {
        const ok = await saveMilestoneAction(milestoneToEdit.filePath, {
          title: title.trim(),
          description: description.trim(),
          targetDate: targetDate || undefined,
          status
        });
        if (ok) {
          onClose();
        } else {
          setError('Не удалось сохранить изменения');
        }
      } else {
        const created = await createMilestoneAction({
          title: title.trim(),
          description: description.trim(),
          targetDate: targetDate || undefined,
          status
        });
        if (created) {
          onClose();
        } else {
          setError('Не удалось создать майлстоун');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Произошла ошибка');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#161922] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#12151e]/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Target className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {milestoneToEdit ? t.milestones.editMilestone : t.milestones.createMilestoneTitle}
              </h2>
              <p className="text-[11px] text-slate-400">
                {t.milestones.subtitle}
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              {t.milestones.milestoneTitle} <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder={t.milestones.milestoneTitlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Target Date & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {t.milestones.dueDate}
              </label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                {t.milestones.status}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="Planning">{t.milestones.statusPlanning}</option>
                <option value="In Progress">{t.milestones.statusInProgress}</option>
                <option value="Completed">{t.milestones.statusCompleted}</option>
                <option value="Deferred">{t.milestones.statusDeferred}</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <AlignLeft className="w-3.5 h-3.5 text-slate-400" />
              {t.milestones.description}
            </label>
            <textarea
              rows={4}
              placeholder={t.milestones.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/90 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none font-sans"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-lg shadow-indigo-600/20"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {isSubmitting ? t.common.loading : milestoneToEdit ? t.common.save : t.milestones.createMilestoneButton}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
