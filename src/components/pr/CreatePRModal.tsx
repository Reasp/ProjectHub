import React, { useState, useEffect } from 'react';
import { X, GitPullRequest, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { generatePRDraft } from '../../services/aiAssistantService';

interface CreatePRModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreatePRModal: React.FC<CreatePRModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const {
    selectedProject,
    gitRepoDetails,
    tasks,
    createPRAction
  } = useProjectStore();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('main');
  const [isDraft, setIsDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fill defaults when opened
  useEffect(() => {
    if (isOpen && selectedProject) {
      const current = gitRepoDetails?.currentBranch || selectedProject.gitBranch || '';
      setSourceBranch(current);

      // Auto-detect target branch
      const hasMaster = gitRepoDetails?.branches.includes('master');
      setTargetBranch(hasMaster ? 'master' : 'main');

      // Check if current branch corresponds to a Backlog task
      const match = current.match(/task-(\d+)/i);
      if (match) {
        const taskId = `task-${match[1]}`.toLowerCase();
        const matchedTask = tasks.find((t) => t.id.toLowerCase() === taskId);
        if (matchedTask) {
          setTitle(`feat(${matchedTask.id}): ${matchedTask.title}`);
          let templateBody = `## Описание изменений\n${matchedTask.description || matchedTask.title}\n\n`;
          if (matchedTask.acceptanceCriteria && matchedTask.acceptanceCriteria.length > 0) {
            templateBody += `## Критерии приемки (Backlog)\n`;
            matchedTask.acceptanceCriteria.forEach((c) => {
              templateBody += `- [${c.completed ? 'x' : ' '}] ${c.text}\n`;
            });
          }
          templateBody += `\nCloses #${matchedTask.id}`;
          setBody(templateBody);
          return;
        }
      }

      setTitle(current ? `Changes for ${current}` : '');
      setBody('## Описание\nКраткое описание внесенных изменений.\n');
    }
  }, [isOpen, selectedProject, gitRepoDetails, tasks]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !sourceBranch.trim()) {
      setError('Заполните заголовок и исходную ветку');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await createPRAction({
        title: title.trim(),
        body: body.trim(),
        sourceBranch: sourceBranch.trim(),
        targetBranch: targetBranch.trim() || 'main',
        draft: isDraft
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка создания Pull Request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#161922] border border-slate-700/70 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#12151f]">
          <div className="flex items-center gap-2.5 text-indigo-400">
            <GitPullRequest className="w-5 h-5" />
            <h2 className="text-sm font-semibold text-white">{t.pr.createPRTitle}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 flex-1 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2.5 text-red-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 font-mono text-[11px] leading-relaxed">{error}</div>
            </div>
          )}

          {/* Branches Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 font-medium mb-1.5">
                {t.pr.headBranch}
              </label>
              <input
                type="text"
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                placeholder="feat/task-1"
                className="w-full px-3 py-2 bg-[#0d0f15] border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                required
              />
            </div>
            <div>
              <label className="block text-slate-400 font-medium mb-1.5">
                {t.pr.baseBranch}
              </label>
              <input
                type="text"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 bg-[#0d0f15] border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                required
              />
            </div>
          </div>

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-400 font-medium">{t.pr.prTitle}</label>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="feat(task-1): Title"
              className="w-full px-3 py-2 bg-[#0d0f15] border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 text-xs"
              required
            />
          </div>

          {/* Body / Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-slate-400 font-medium">
                {t.pr.description} (Markdown)
              </label>
              <button
                type="button"
                onClick={async () => {
                  const activeTask = tasks.find(taskItem => taskItem.status === 'In Progress') || tasks[0];
                  const draft = await generatePRDraft(activeTask?.id, activeTask?.title, activeTask?.description, sourceBranch);
                  if (!title) setTitle(draft.title);
                  setBody(draft.description);
                }}
                className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 transition"
                title="AI Generate PR draft"
              >
                <Sparkles className="w-3 h-3" />
                AI Draft
              </button>
            </div>
            <textarea
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="PR description..."
              className="w-full px-3 py-2 bg-[#0d0f15] border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Options */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isDraft"
              checked={isDraft}
              onChange={(e) => setIsDraft(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <label htmlFor="isDraft" className="text-slate-300 cursor-pointer select-none">
              {t.pr.draft}
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Backlog → <b className="text-amber-400">Review</b>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t.common.loading}
                  </>
                ) : (
                  <>
                    <GitPullRequest className="w-3.5 h-3.5" />
                    {t.pr.createPRButton}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
