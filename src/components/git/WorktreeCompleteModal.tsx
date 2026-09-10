import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  GitMerge,
  GitBranch,
  Trash2,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Sparkles,
  FileDiff
} from 'lucide-react';
import type { GitWorktreeInfo } from '../../types/electron';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { SplitDiffViewer } from './SplitDiffViewer';

interface WorktreeCompleteModalProps {
  worktree: GitWorktreeInfo;
  onClose: () => void;
}

export const WorktreeCompleteModal: React.FC<WorktreeCompleteModalProps> = ({
  worktree,
  onClose
}) => {
  const { t } = useTranslation();
  const {
    selectedProject,
    gitRepoDetails,
    tasks,
    updateTaskStatusLocal,
    removeWorktreeAction,
    mergeWorktreeAction,
    getWorktreeDiffAction
  } = useProjectStore();

  const [targetBranch, setTargetBranch] = useState(
    gitRepoDetails?.currentBranch || (gitRepoDetails?.branches?.includes('master') ? 'master' : 'main')
  );
  const [deleteAfterMerge, setDeleteAfterMerge] = useState(true);
  const [updateTaskToReview, setUpdateTaskToReview] = useState(true);
  const [diffText, setDiffText] = useState<string>('');
  const [isLoadingDiff, setIsLoadingDiff] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const matchingTask = worktree.taskId
    ? tasks.find((t) => t.id.toLowerCase() === worktree.taskId?.toLowerCase())
    : null;

  useEffect(() => {
    let cancelled = false;
    const loadDiff = async () => {
      if (!worktree.branch) return;
      setIsLoadingDiff(true);
      try {
        const diff = await getWorktreeDiffAction(worktree.branch, targetBranch);
        if (!cancelled) setDiffText(diff);
      } catch (err: any) {
        if (!cancelled) setErrorMessage(err.message || 'Ошибка загрузки diff');
      } finally {
        if (!cancelled) setIsLoadingDiff(false);
      }
    };

    void loadDiff();
    return () => {
      cancelled = true;
    };
  }, [worktree.branch, targetBranch]);

  const handleMerge = async () => {
    if (!worktree.branch || !selectedProject) return;

    setIsMerging(true);
    setErrorMessage(null);
    try {
      const res = await mergeWorktreeAction(worktree.branch, targetBranch);
      if (!res.success) {
        setErrorMessage(res.error || 'Ошибка слияния ветки');
        return;
      }

      // Переводим связанную задачу в Review, если чекбокс включен
      if (updateTaskToReview && matchingTask && matchingTask.status !== 'Review' && matchingTask.status !== 'Done') {
        await updateTaskStatusLocal(matchingTask.id, 'Review');
      }

      // Удаляем worktree, если чекбокс включен
      if (deleteAfterMerge && !worktree.isMain) {
        await removeWorktreeAction(worktree.path, true);
      }

      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка операции слияния');
    } finally {
      setIsMerging(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121524] border border-slate-700/70 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#15192b] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <GitMerge className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span>{t.worktrees.completeTaskWorktree}</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#1d233c] text-indigo-300 border border-indigo-500/30">
                  {worktree.branch}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Просмотр изменений и безопасное слияние рабочей ветки в основную
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options Toolbar */}
        <div className="px-6 py-3 bg-[#171b30] border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0">
          {/* Target Branch Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-300">Слить ветку в:</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#0e111d] border border-slate-700">
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              <select
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="bg-transparent text-xs text-white font-medium focus:outline-none cursor-pointer"
              >
                {gitRepoDetails?.branches
                  ?.filter((b) => b !== worktree.branch)
                  .map((b) => (
                    <option key={b} value={b} className="bg-[#121524] text-white">
                      {b}
                    </option>
                  )) || <option value="master">master</option>}
              </select>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex items-center gap-4 text-xs text-slate-300">
            {matchingTask && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={updateTaskToReview}
                  onChange={(e) => setUpdateTaskToReview(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-[#0e111d]"
                />
                <span>Перевести задачу [{matchingTask.id}] в Review (Правило 5)</span>
              </label>
            )}

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteAfterMerge}
                onChange={(e) => setDeleteAfterMerge(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-[#0e111d]"
              />
              <span>Удалить Worktree после слияния</span>
            </label>
          </div>
        </div>

        {/* Diff Content Viewport */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#0c0e17]">
          {isLoadingDiff ? (
            <div className="flex-1 flex items-center justify-center p-8 text-slate-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
              <span className="text-xs">Загрузка диффа между {targetBranch} и {worktree.branch}...</span>
            </div>
          ) : diffText.trim() ? (
            <div className="flex-1 overflow-y-auto p-4">
              <SplitDiffViewer diff={diffText} filePath={worktree.branch || 'diff'} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-400 mb-2" />
              <p className="text-sm font-medium text-slate-200">Нет различий с веткой {targetBranch}</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                Ветка {worktree.branch} полностью синхронизирована с {targetBranch}, либо не содержит новых коммитов.
              </p>
            </div>
          )}
        </div>

        {/* Error message if any */}
        {errorMessage && (
          <div className="px-6 py-2.5 bg-rose-950/60 border-t border-rose-800/60 text-xs text-rose-300 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#15192b] flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-1.5 font-mono">
            <span>{worktree.branch}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-white font-semibold">{targetBranch}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              {t.common.cancel}
            </button>

            <button
              type="button"
              disabled={isMerging}
              onClick={handleMerge}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5 disabled:opacity-50"
            >
              {isMerging ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Слияние...</span>
                </>
              ) : (
                <>
                  <GitMerge className="w-3.5 h-3.5" />
                  <span>{t.worktrees.mergeInto.replace('{targetBranch}', targetBranch)}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
