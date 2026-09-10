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
  FileDiff,
  FolderOpen
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
    getWorktreeDiffAction,
    checkoutWorktreeFilesAction,
    setActiveTab
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
  const [conflictFiles, setConflictFiles] = useState<string[] | null>(null);
  const [appliedFileMessage, setAppliedFileMessage] = useState<string | null>(null);
  const [isApplyingFile, setIsApplyingFile] = useState(false);

  const matchingTask = worktree.taskId
    ? tasks.find((t) => t.id.toLowerCase() === worktree.taskId?.toLowerCase())
    : null;

  useEffect(() => {
    let cancelled = false;
    const loadDiff = async () => {
      if (!worktree.branch) return;
      setIsLoadingDiff(true);
      try {
        const diff = await getWorktreeDiffAction(worktree.branch, targetBranch, worktree.path);
        if (!cancelled) setDiffText(diff);
      } catch (err: any) {
        if (!cancelled) setErrorMessage(err.message || t.worktrees.diffLoadError);
      } finally {
        if (!cancelled) setIsLoadingDiff(false);
      }
    };

    void loadDiff();
    return () => {
      cancelled = true;
    };
  }, [worktree.branch, targetBranch, worktree.path]);

  const changedFiles = React.useMemo(() => {
    if (!diffText) return [];
    const files: string[] = [];
    const lines = diffText.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const parts = line.split(' ');
        if (parts[2]) {
          files.push(parts[2].replace(/^a\//, ''));
        }
      }
    }
    return Array.from(new Set(files));
  }, [diffText]);

  const handleApplySingleFile = async (filePath: string) => {
    if (!worktree.branch) return;
    setIsApplyingFile(true);
    setAppliedFileMessage(null);
    try {
      const res = await checkoutWorktreeFilesAction(worktree.branch, [filePath]);
      if (res.success) {
        setAppliedFileMessage(`${t.worktrees.fileAppliedSuccess}: ${filePath}`);
        // reload diff
        const newDiff = await getWorktreeDiffAction(worktree.branch, targetBranch, worktree.path);
        setDiffText(newDiff);
      } else {
        setErrorMessage(res.error || 'Failed to apply file');
      }
    } finally {
      setIsApplyingFile(false);
    }
  };

  const handleMerge = async () => {
    if (!worktree.branch || !selectedProject) return;

    setIsMerging(true);
    setErrorMessage(null);
    setConflictFiles(null);
    try {
      const res = await mergeWorktreeAction(worktree.branch, targetBranch);
      if (!res.success) {
        if (res.conflictedFiles && res.conflictedFiles.length > 0) {
          setConflictFiles(res.conflictedFiles);
        }
        setErrorMessage(res.error || t.worktrees.mergeError);
        return;
      }

      // Update linked task to Review if checkbox is checked
      if (updateTaskToReview && matchingTask && matchingTask.status !== 'Review' && matchingTask.status !== 'Done') {
        await updateTaskStatusLocal(matchingTask.id, 'Review');
      }

      // Remove worktree if checkbox is checked
      if (deleteAfterMerge && !worktree.isMain) {
        await removeWorktreeAction(worktree.path, true);
      }

      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || t.worktrees.mergeOpError);
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
                {t.worktrees.completeSubtitle}
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
            <span className="text-xs font-medium text-slate-300">{t.worktrees.mergeIntoLabel}</span>
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
                <span>{t.worktrees.moveToReviewCheckbox.replace('{taskId}', matchingTask.id)}</span>
              </label>
            )}

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={deleteAfterMerge}
                onChange={(e) => setDeleteAfterMerge(e.target.checked)}
                className="rounded border-slate-700 text-indigo-600 focus:ring-0 focus:ring-offset-0 bg-[#0e111d]"
              />
              <span>{t.worktrees.deleteAfterMergeCheckbox}</span>
            </label>
          </div>
        </div>

        {/* Conflict Resolution Banner if merge failed with conflicts */}
        {conflictFiles && conflictFiles.length > 0 && (
          <div className="p-4 bg-rose-950/50 border-b border-rose-800/60 flex flex-col gap-3 shrink-0">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-rose-200">{t.worktrees.mergeConflictDetected}</h4>
                <p className="text-xs text-rose-300/90 mt-0.5">{t.worktrees.mergeAbortedSafe}</p>
                <div className="mt-2 text-xs font-mono bg-black/50 p-2 rounded border border-rose-900/60 max-h-32 overflow-y-auto space-y-1">
                  {conflictFiles.map((file) => (
                    <div key={file} className="text-rose-300 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      <span>{file}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => window.api.openInExplorer(worktree.path)}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/90 hover:bg-slate-700 text-xs text-slate-200 transition flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                <span>{t.worktrees.openInEditor}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  setActiveTab('prs');
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition flex items-center gap-1.5"
              >
                <span>{t.worktrees.createPrInstead}</span>
              </button>
            </div>
          </div>
        )}

        {/* Applied file notification */}
        {appliedFileMessage && (
          <div className="px-6 py-2 bg-emerald-950/60 border-b border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2 shrink-0">
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{appliedFileMessage}</span>
          </div>
        )}

        {/* Changed Files Toolbar for partial checkout */}
        {changedFiles.length > 0 && (
          <div className="px-6 py-2 bg-[#13172b] border-b border-slate-800 flex items-center gap-3 overflow-x-auto text-xs text-slate-300 shrink-0">
            <span className="text-slate-400 font-medium shrink-0 flex items-center gap-1">
              <FileDiff className="w-3.5 h-3.5 text-indigo-400" />
              {t.worktrees.applySelectedFiles} ({changedFiles.length}):
            </span>
            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {changedFiles.map((f) => (
                <div key={f} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0d1122] border border-slate-700 text-[11px] font-mono shrink-0">
                  <span className="text-slate-200 truncate max-w-[200px]" title={f}>{f}</span>
                  <button
                    type="button"
                    disabled={isApplyingFile}
                    onClick={() => handleApplySingleFile(f)}
                    className="text-emerald-400 hover:text-emerald-300 ml-1 text-[10px] font-sans px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition disabled:opacity-50"
                    title={t.worktrees.applyFile}
                  >
                    {t.worktrees.applyFile}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diff Content Viewport */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[#0c0e17]">
          {isLoadingDiff ? (
            <div className="flex-1 flex items-center justify-center p-8 text-slate-400 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
              <span className="text-xs">
                {t.worktrees.loadingDiffBetween
                  .replace('{target}', targetBranch)
                  .replace('{branch}', worktree.branch || '')}
              </span>
            </div>
          ) : diffText.trim() ? (
            <div className="flex-1 overflow-y-auto p-4">
              <SplitDiffViewer diff={diffText} filePath={worktree.branch || 'diff'} />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-400 mb-2" />
              <p className="text-sm font-medium text-slate-200">
                {t.worktrees.noDiffWithBranch.replace('{target}', targetBranch)}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                {t.worktrees.syncedDesc
                  .replace('{branch}', worktree.branch || '')
                  .replace('{target}', targetBranch)}
              </p>
            </div>
          )}
        </div>

        {/* Error message if any */}
        {errorMessage && !conflictFiles && (
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
                  <span>{t.worktrees.merging}</span>
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
