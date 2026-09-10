import React, { useState } from 'react';
import {
  GitBranch,
  FolderGit2,
  Plus,
  Trash2,
  Terminal,
  Bot,
  FolderOpen,
  Code,
  GitMerge,
  RefreshCw,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle,
  ExternalLink
} from 'lucide-react';
import type { GitWorktreeInfo, BacklogTask } from '../../types/electron';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { WorktreeCompleteModal } from './WorktreeCompleteModal';

interface WorktreePanelProps {
  onSelectTask?: (task: BacklogTask) => void;
}

export const WorktreePanel: React.FC<WorktreePanelProps> = ({ onSelectTask }) => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    selectedProject,
    worktrees,
    tasks,
    gitRepoDetails,
    loadWorktreesAction,
    createWorktreeAction,
    removeWorktreeAction,
    pruneWorktreesAction,
    findOrphanedWorktreesAction,
    cleanOrphanedWorktreesAction,
    createPtySessionAction
  } = useProjectStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [baseBranch, setBaseBranch] = useState(gitRepoDetails?.currentBranch || 'master');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCompleteWt, setSelectedCompleteWt] = useState<GitWorktreeInfo | null>(null);
  const [actionLoadingPath, setActionLoadingPath] = useState<string | null>(null);
  const [isCleaningOrphaned, setIsCleaningOrphaned] = useState(false);

  const handleCleanOrphaned = async () => {
    setIsCleaningOrphaned(true);
    try {
      const scan = await findOrphanedWorktreesAction();
      const totalFound = scan.orphanedPaths.length + scan.orphanedBranches.length;
      if (totalFound === 0) {
        await dialog.alert(t.worktrees.noOrphanedFound);
        return;
      }

      const confirmed = await dialog.confirm(
        t.worktrees.confirmCleanOrphaned
          .replace('{worktrees}', String(scan.orphanedPaths.length))
          .replace('{branches}', String(scan.orphanedBranches.length))
      );

      if (confirmed) {
        const result = await cleanOrphanedWorktreesAction(scan.orphanedPaths, scan.orphanedBranches);
        await dialog.alert(
          t.worktrees.cleanedOrphanedSuccess
            .replace('{worktrees}', String(result.removedWorktrees.length))
            .replace('{branches}', String(result.removedBranches.length))
        );
      }
    } finally {
      setIsCleaningOrphaned(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const branch = newBranchName.trim();
    if (!branch || !selectedProject) return;

    setIsCreating(true);
    try {
      const wt = await createWorktreeAction(branch, true, baseBranch || 'HEAD');
      if (wt) {
        setNewBranchName('');
        setShowCreateForm(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleRemove = async (wt: GitWorktreeInfo) => {
    if (wt.isMain) return;
    const confirmText = t.worktrees.confirmRemove.replace('{path}', wt.path);
    const confirmed = await dialog.confirm({
      message: confirmText,
      danger: true
    });
    if (!confirmed) return;

    setActionLoadingPath(wt.path);
    try {
      await removeWorktreeAction(wt.path, true);
    } finally {
      setActionLoadingPath(null);
    }
  };

  const handleLaunchClaude = async (wt: GitWorktreeInfo) => {
    if (!selectedProject) return;
    const title = `[WT: ${wt.branch || 'detached'}] Claude`;
    await createPtySessionAction(selectedProject.path, 'claude', title, wt.path, wt.branch || undefined);
  };

  const handleLaunchShell = async (wt: GitWorktreeInfo) => {
    if (!selectedProject) return;
    const title = `[WT: ${wt.branch || 'detached'}] Terminal`;
    await createPtySessionAction(selectedProject.path, 'shell', title, wt.path, wt.branch || undefined);
  };

  const handleOpenFolder = (dirPath: string) => {
    window.api?.openInExplorer?.(dirPath);
  };

  const handleOpenCode = (dirPath: string) => {
    window.api?.openInCode?.(dirPath);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0c0e17] overflow-hidden">
      {/* Header Toolbar */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-[#111422] shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <FolderGit2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              {t.worktrees.title}
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/60">
                {worktrees.length}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              {t.worktrees.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => pruneWorktreesAction()}
            title={t.worktrees.pruneWorktrees}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-300 border border-slate-700/60 transition"
          >
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">{t.worktrees.pruneWorktrees}</span>
          </button>

          <button
            type="button"
            disabled={isCleaningOrphaned}
            onClick={handleCleanOrphaned}
            title={t.worktrees.cleanOrphaned}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-amber-400 hover:text-amber-300 border border-slate-700/60 transition disabled:opacity-50"
          >
            {isCleaningOrphaned ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className="hidden sm:inline">{t.worktrees.cleanOrphaned}</span>
          </button>

          <button
            type="button"
            onClick={() => selectedProject && loadWorktreesAction(selectedProject.path)}
            title={t.common.refresh}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.worktrees.createWorktree}</span>
          </button>
        </div>
      </div>

      {/* Creation form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="p-4 border-b border-indigo-900/40 bg-indigo-950/20 flex flex-wrap items-end gap-3 shrink-0"
        >
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] font-medium text-indigo-300 uppercase tracking-wider mb-1">
              {t.worktrees.branchName}
            </label>
            <input
              type="text"
              autoFocus
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={t.worktrees.branchPlaceholder}
              className="w-full bg-[#0d101d] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 select-text cursor-text"
              required
            />
          </div>

          <div className="w-48">
            <label className="block text-[11px] font-medium text-indigo-300 uppercase tracking-wider mb-1">
              {t.worktrees.baseBranch}
            </label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="w-full bg-[#0d101d] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
            >
              {gitRepoDetails?.branches?.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              )) || <option value="master">master</option>}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={isCreating || !newBranchName.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {isCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{t.common.create}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition"
            >
              {t.common.cancel}
            </button>
          </div>

          <div className="w-full text-[11px] text-slate-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>{t.worktrees.taskHint}</span>
          </div>
        </form>
      )}

      {/* Worktrees List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {worktrees.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-slate-800">
            <FolderGit2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {t.worktrees.noWorktrees}
            </p>
          </div>
        ) : (
          worktrees.map((wt) => {
            const matchingTask = wt.taskId
              ? tasks.find((t) => t.id.toLowerCase() === wt.taskId?.toLowerCase())
              : null;
            const isLoading = actionLoadingPath === wt.path;

            return (
              <div
                key={wt.path}
                className={`p-4 rounded-xl border transition ${
                  wt.isMain
                    ? 'bg-[#121626]/80 border-slate-800 hover:border-slate-700'
                    : 'bg-[#141829] border-indigo-900/30 hover:border-indigo-700/50 shadow-sm'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Info left */}
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-mono font-semibold text-white px-2.5 py-1 rounded bg-[#1b2035] border border-slate-700/60">
                        <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                        {wt.branch || (wt.isDetached ? 'detached HEAD' : 'unknown')}
                      </span>

                      {wt.isMain ? (
                        <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          {t.worktrees.mainWorktree}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                          Isolated Worktree
                        </span>
                      )}

                      {wt.head && (
                        <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-800/80">
                          {wt.head.substring(0, 7)}
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-mono text-slate-400 truncate" title={wt.path}>
                      {wt.path}
                    </div>

                    {/* Linked Backlog Task */}
                    {matchingTask && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[11px] text-slate-400 font-medium">{t.worktrees.taskLabel}</span>
                        <button
                          type="button"
                          onClick={() => onSelectTask?.(matchingTask)}
                          className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 hover:underline font-medium"
                          title={t.worktrees.openTaskInBacklog}
                        >
                          <span className="font-mono text-indigo-400 uppercase">[{matchingTask.id}]</span>
                          <span className="truncate max-w-xs">{matchingTask.title}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            matchingTask.status === 'Done'
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : matchingTask.status === 'In Progress'
                              ? 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20'
                              : matchingTask.status === 'Review'
                              ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                              : 'text-slate-400 bg-slate-800 border-slate-700'
                          }`}
                        >
                          {matchingTask.status}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions right */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {/* Launch Claude in worktree */}
                    <button
                      type="button"
                      onClick={() => handleLaunchClaude(wt)}
                      title={t.worktrees.launchClaude}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/80 text-xs font-medium text-indigo-300 border border-indigo-800/40 transition"
                    >
                      <Bot className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="hidden sm:inline">Claude</span>
                    </button>

                    {/* Launch Shell terminal */}
                    <button
                      type="button"
                      onClick={() => handleLaunchShell(wt)}
                      title={t.worktrees.openInTerminal}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-300 border border-slate-700/60 transition"
                    >
                      <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="hidden sm:inline">Shell</span>
                    </button>

                    {/* Open in Code */}
                    <button
                      type="button"
                      onClick={() => handleOpenCode(wt.path)}
                      title={t.worktrees.openInVsCode}
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
                    >
                      <Code className="w-3.5 h-3.5 text-blue-400" />
                    </button>

                    {/* Open in Explorer */}
                    <button
                      type="button"
                      onClick={() => handleOpenFolder(wt.path)}
                      title={t.worktrees.openInExplorer}
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                    </button>

                    {/* Review & Merge (only for non-main) */}
                    {!wt.isMain && wt.branch && (
                      <button
                        type="button"
                        onClick={() => setSelectedCompleteWt(wt)}
                        title={t.worktrees.reviewAndMerge}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-xs font-medium text-emerald-300 border border-emerald-800/40 transition"
                      >
                        <GitMerge className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="hidden sm:inline">{t.worktrees.reviewAndMerge}</span>
                      </button>
                    )}

                    {/* Delete worktree (only for non-main) */}
                    {!wt.isMain && (
                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleRemove(wt)}
                        title={t.worktrees.removeWorktree}
                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 border border-rose-900/40 transition disabled:opacity-50"
                      >
                        {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Complete & Merge Modal */}
      {selectedCompleteWt && (
        <WorktreeCompleteModal
          worktree={selectedCompleteWt}
          onClose={() => setSelectedCompleteWt(null)}
        />
      )}
    </div>
  );
};
