import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  GitMerge,
  Calendar,
  User,
  CheckCircle,
  Clock,
  Plus,
  ChevronRight,
  Tag,
  Archive,
  Globe,
  Check,
  FileDiff,
  Minus,
  Circle,
  ArrowUpFromLine,
  ArrowDownToLine,
  Layers,
  Send,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Trash2,
  Download,
  Upload,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  FolderGit2
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { generateCommitMessage } from '../../services/aiAssistantService';
import { SplitDiffViewer } from './SplitDiffViewer';
import { WorktreePanel } from './WorktreePanel';

// ─── File Status Badge ────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  M: 'text-amber-400 bg-amber-950/40 border-amber-700/50',
  A: 'text-emerald-400 bg-emerald-950/40 border-emerald-700/50',
  D: 'text-rose-400 bg-rose-950/40 border-rose-700/50',
  R: 'text-purple-400 bg-purple-950/40 border-purple-700/50',
  '?': 'text-slate-400 bg-slate-800/60 border-slate-700/50'
};

const statusLabels: Record<string, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', '?': '?'
};

// ─── Main Component ───────────────────────────────────────────────────────────

type GitTab = 'history' | 'branches' | 'working' | 'compare' | 'worktrees';

export const GitInspector: React.FC = () => {
  const { t } = useTranslation();
  const {
    selectedProject,
    gitLogs,
    gitRepoDetails,
    gitSelectedFile,
    gitDiffContent,
    worktrees,
    tasks,
    loadGitRepoDetails,
    gitCheckoutBranch,
    gitCreateBranch,
    gitDeleteBranch,
    gitMergeBranch,
    gitFetchRemote,
    gitPullRemote,
    gitPushRemote,
    gitDiscardFileChanges,
    gitStageFile,
    gitUnstageFile,
    gitStageAll,
    gitCommit,
    gitLoadFileDiff,
    gitLoadDiffBetween
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<GitTab>('working');
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState<string | null>(null);
  const [isRemoteAction, setIsRemoteAction] = useState<string | null>(null);
  const [diffStagedMode, setDiffStagedMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Compare branch state
  const [compareTargetBranch, setCompareTargetBranch] = useState<string>('');
  const [isComparing, setIsComparing] = useState(false);

  const branchInputRef = useRef<HTMLInputElement>(null);

  // Load details when project changes
  useEffect(() => {
    if (selectedProject?.hasGit) {
      loadGitRepoDetails(selectedProject);
    }
  }, [selectedProject?.path]);

  useEffect(() => {
    if (showNewBranchInput) {
      setTimeout(() => branchInputRef.current?.focus(), 50);
    }
  }, [showNewBranchInput]);

  // Set default compare branch
  useEffect(() => {
    if (gitRepoDetails?.branches && gitRepoDetails.branches.length > 0 && !compareTargetBranch) {
      const other = gitRepoDetails.branches.find(b => b !== gitRepoDetails.currentBranch) || gitRepoDetails.branches[0];
      setCompareTargetBranch(other);
    }
  }, [gitRepoDetails?.branches]);

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Insert current task id into commit message
  const inProgressTask = tasks.find(taskItem => taskItem.status === 'In Progress');
  const insertTaskId = () => {
    if (inProgressTask) {
      const prefix = `feat(${inProgressTask.id}): `;
      if (!commitMessage.startsWith(prefix)) {
        setCommitMessage(prefix + commitMessage);
      }
    }
  };

  const handleCheckout = async (branch: string) => {
    setIsCheckingOut(branch);
    const ok = await gitCheckoutBranch(branch);
    setIsCheckingOut(null);
    if (!ok) {
      showError(`Не удалось переключиться на ветку "${branch}". Проверьте незакоммиченные файлы.`);
    } else {
      showSuccess(`Ветка переключена на: ${branch}`);
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    const ok = await gitCreateBranch(name);
    if (ok) {
      setNewBranchName('');
      setShowNewBranchInput(false);
      showSuccess(`Создана новая ветка: ${name}`);
    } else {
      showError(`Ошибка создания ветки "${name}".`);
    }
  };

  const handleDeleteBranch = async (branch: string) => {
    if (confirm(`Вы уверены, что хотите удалить ветку "${branch}"?`)) {
      const ok = await gitDeleteBranch(branch, true);
      if (ok) {
        showSuccess(`Ветка "${branch}" удалена.`);
      } else {
        showError(`Не удалось удалить ветку "${branch}".`);
      }
    }
  };

  const handleMergeBranch = async (branch: string) => {
    if (confirm(`Объединить ветку "${branch}" в текущую ветку "${gitRepoDetails?.currentBranch}"?`)) {
      const res = await gitMergeBranch(branch);
      if (res.success) {
        showSuccess(`Ветка "${branch}" успешно объединена!`);
      } else {
        showError(`Ошибка слияния: ${res.error || 'Конфликты слияния'}`);
      }
    }
  };

  const handleFetch = async () => {
    setIsRemoteAction('fetch');
    const ok = await gitFetchRemote();
    setIsRemoteAction(null);
    if (ok) showSuccess('Fetch завершен успешно.');
    else showError('Ошибка выполнения fetch.');
  };

  const handlePull = async () => {
    setIsRemoteAction('pull');
    const res = await gitPullRemote();
    setIsRemoteAction(null);
    if (res.success) showSuccess('Pull завершен: изменения получены.');
    else showError(`Ошибка pull: ${res.error}`);
  };

  const handlePush = async () => {
    setIsRemoteAction('push');
    const res = await gitPushRemote();
    setIsRemoteAction(null);
    if (res.success) showSuccess('Push завершен: коммиты отправлены.');
    else showError(`Ошибка push: ${res.error}`);
  };

  const handleDiscard = async (filePath: string) => {
    if (confirm(`Отменить все локальные изменения в файле "${filePath}"? Это действие необратимо.`)) {
      const ok = await gitDiscardFileChanges(filePath);
      if (ok) showSuccess(`Изменения в "${filePath}" отменены.`);
      else showError(`Не удалось отменить изменения в "${filePath}".`);
    }
  };

  const handleCreateBranchForTask = async () => {
    if (!inProgressTask) return;
    const branchName = `feat/${inProgressTask.id}`;
    const ok = await gitCreateBranch(branchName);
    if (ok) showSuccess(`Ветка "${branchName}" создана.`);
    else showError(`Ошибка создания ветки "${branchName}".`);
  };

  const handleCommit = async () => {
    const msg = commitMessage.trim();
    if (!msg) return;
    setIsCommitting(true);
    const ok = await gitCommit(msg, false);
    setIsCommitting(false);
    if (ok) {
      setCommitMessage('');
      showSuccess('Коммит успешно создан!');
    } else {
      showError('Ошибка коммита. Убедитесь, что файлы добавлены в Stage.');
    }
  };

  const handleFileClick = (filePath: string, staged: boolean) => {
    setDiffStagedMode(staged);
    gitLoadFileDiff(filePath, staged);
  };

  const handleRunCompare = async () => {
    if (!compareTargetBranch) return;
    setIsComparing(true);
    await gitLoadDiffBetween(compareTargetBranch, gitRepoDetails?.currentBranch || 'HEAD');
    setIsComparing(false);
  };

  // ── Guard: no git ──
  if (!selectedProject?.hasGit) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#0d1017]">
        <GitBranch className="w-12 h-12 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">{t.git.title}</h3>
        <p className="text-xs text-slate-400 max-w-sm">
          {t.git.noChanges}
        </p>
      </div>
    );
  }

  const details = gitRepoDetails;
  const stagedFiles = details?.files.filter(f => f.staged) ?? [];
  const unstagedFiles = details?.files.filter(f => !f.staged) ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0d1017]">

      {/* Messages */}
      {errorMsg && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/70 border border-rose-700/60 text-rose-300 text-xs shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="mx-4 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 text-xs shrink-0">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Top Header & Sub-tabs */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-800 shrink-0 flex-wrap gap-2">
        {/* Tab Buttons */}
        <div className="flex items-center gap-1">
          {([
            { id: 'working', label: `Изменения (${details?.files.length ?? 0})`, icon: FileDiff },
            { id: 'branches', label: `Ветки (${details?.branches.length ?? 0})`, icon: GitBranch },
            { id: 'worktrees', label: `Worktrees (${worktrees.length})`, icon: FolderGit2 },
            { id: 'history', label: `История (${gitLogs.length})`, icon: GitCommitIcon },
            { id: 'compare', label: 'Сравнение веток', icon: GitMerge }
          ] as { id: GitTab; label: string; icon: any }[]).map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'compare' && compareTargetBranch) {
                    handleRunCompare();
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Remote Toolbar & Current Branch Badge */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Fetch / Pull / Push */}
          <div className="flex items-center bg-slate-800/80 rounded-lg p-0.5 border border-slate-700/60 text-xs">
            <button
              onClick={handleFetch}
              disabled={isRemoteAction !== null}
              className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700/80 text-slate-300 rounded transition disabled:opacity-50"
              title="git fetch"
            >
              <RefreshCw className={`w-3 h-3 ${isRemoteAction === 'fetch' ? 'animate-spin text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Fetch</span>
            </button>
            <button
              onClick={handlePull}
              disabled={isRemoteAction !== null}
              className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700/80 text-slate-300 rounded transition disabled:opacity-50"
              title="git pull"
            >
              <Download className={`w-3 h-3 ${isRemoteAction === 'pull' ? 'animate-bounce text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Pull</span>
            </button>
            <button
              onClick={handlePush}
              disabled={isRemoteAction !== null}
              className="flex items-center gap-1 px-2 py-1 hover:bg-slate-700/80 text-slate-300 rounded transition disabled:opacity-50"
              title="git push"
            >
              <Upload className={`w-3 h-3 ${isRemoteAction === 'push' ? 'animate-pulse text-indigo-400' : ''}`} />
              <span className="hidden sm:inline">Push</span>
            </button>
          </div>

          {/* Current Branch Badge */}
          {details && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/90 border border-slate-700/80 text-slate-200 text-xs font-mono">
              <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="font-semibold text-indigo-300 truncate max-w-[130px]">{details.currentBranch}</span>
              {details.isClean ? (
                <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-1.5 py-0.2 rounded border border-emerald-700/30">Чисто</span>
              ) : (
                <span className="text-[10px] text-amber-400 bg-amber-950/50 px-1.5 py-0.2 rounded border border-amber-700/30">
                  {details.files.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════ TAB: WORKING COPY ═══════════════════════ */}
      {activeTab === 'working' && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Staged and Unstaged Files + Commit Box */}
          <div className="w-80 shrink-0 flex flex-col border-r border-slate-800 overflow-hidden bg-[#0e111a]">

            {/* Staged Section */}
            <div className="p-3 border-b border-slate-800/80 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                  Подготовлено (Staged) • {stagedFiles.length}
                </span>
                {stagedFiles.length > 0 && (
                  <button
                    onClick={() => stagedFiles.forEach(f => gitUnstageFile(f.path))}
                    className="text-[10px] text-slate-400 hover:text-slate-200 transition bg-slate-800 px-1.5 py-0.5 rounded"
                  >
                    Снять все
                  </button>
                )}
              </div>

              <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                {stagedFiles.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic py-1">Нет подготовленных файлов</div>
                ) : (
                  stagedFiles.map(f => {
                    const isSelected = gitSelectedFile === f.path && diffStagedMode;
                    return (
                      <div
                        key={f.path}
                        onClick={() => handleFileClick(f.path, true)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition group text-xs ${
                          isSelected ? 'bg-emerald-950/50 border border-emerald-600/50' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded border shrink-0 ${statusColors[f.index] || statusColors['?']}`}>
                          {f.index || 'A'}
                        </span>
                        <span className="text-slate-300 truncate flex-1 font-mono text-[11px]" title={f.path}>
                          {f.path}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); gitUnstageFile(f.path); }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                          title="Снять из stage"
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Unstaged Section */}
            <div className="flex-1 flex flex-col overflow-hidden p-3 min-h-0">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Изменения (Unstaged) • {unstagedFiles.length}
                </span>
                {unstagedFiles.length > 0 && (
                  <button
                    onClick={() => gitStageAll()}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 transition bg-emerald-950/40 border border-emerald-700/40 px-1.5 py-0.5 rounded"
                  >
                    В stage все
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {unstagedFiles.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic py-2">Рабочая копия чиста</div>
                ) : (
                  unstagedFiles.map(f => {
                    const isSelected = gitSelectedFile === f.path && !diffStagedMode;
                    return (
                      <div
                        key={f.path}
                        onClick={() => handleFileClick(f.path, false)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition group text-xs ${
                          isSelected ? 'bg-amber-950/50 border border-amber-600/50' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded border shrink-0 ${statusColors[f.working_dir] || statusColors['?']}`}>
                          {f.working_dir || 'M'}
                        </span>
                        <span className="text-slate-300 truncate flex-1 font-mono text-[11px]" title={f.path}>
                          {f.path}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); gitStageFile(f.path); }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-700 text-emerald-400 transition"
                          title="Добавить в stage"
                        >
                          <ArrowUpFromLine className="w-3 h-3" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDiscard(f.path); }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-900/60 text-rose-400 transition"
                          title="Отменить изменения (Discard)"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Commit Form */}
            <div className="p-3 border-t border-slate-800 shrink-0 bg-slate-900/60 space-y-2">
              <textarea
                value={commitMessage}
                onChange={e => setCommitMessage(e.target.value)}
                placeholder="Сообщение коммита (Ctrl/Cmd+Enter для сохранения)..."
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg p-2 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 resize-none h-16 font-mono"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleCommit();
                }}
              />
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1">
                  {inProgressTask && (
                    <button
                      onClick={insertTaskId}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-violet-900/40 border border-violet-700/50 text-violet-300 text-[10px] hover:bg-violet-900/70 transition"
                      title={`Вставить ID текущей задачи ${inProgressTask.id}`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>{inProgressTask.id}</span>
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const activeTask = tasks.find(taskItem => taskItem.status === 'In Progress') || tasks[0];
                      const changed = (stagedFiles.length > 0 ? stagedFiles : unstagedFiles).map(f => f.path);
                      const msg = await generateCommitMessage(activeTask?.id, activeTask?.title, changed);
                      setCommitMessage(msg);
                    }}
                    type="button"
                    className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] hover:bg-amber-500/20 transition"
                    title="Сгенерировать сообщение через AI"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>AI Commit</span>
                  </button>
                </div>

                <button
                  onClick={handleCommit}
                  disabled={!commitMessage.trim() || isCommitting || stagedFiles.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition shadow-sm"
                >
                  {isCommitting ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  <span>Закоммитить</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Split/Unified Diff Viewer */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {gitSelectedFile ? (
              <SplitDiffViewer
                diff={gitDiffContent}
                filePath={gitSelectedFile}
                defaultMode="split"
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
                <FileDiff className="w-12 h-12 text-slate-700 mb-3" />
                <h4 className="text-sm font-medium text-slate-400 mb-1">Файл не выбран</h4>
                <p className="text-xs max-w-sm">Выберите измененный файл из списка слева для просмотра диффа (Split или Unified).</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════ TAB: BRANCHES ═══════════════════════ */}
      {activeTab === 'branches' && (
        <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
          {/* Branch Actions Toolbar */}
          <div className="flex items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-white">Управление ветками репозитория</h3>
              <p className="text-xs text-slate-400">Переключение, слияние и удаление локальных и отслеживаемых веток</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNewBranchInput(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Новая ветка</span>
              </button>
              {inProgressTask && (
                <button
                  onClick={handleCreateBranchForTask}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 hover:bg-violet-600/50 text-violet-300 text-xs font-medium transition"
                  title={`Создать feat/${inProgressTask.id}`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>feat/{inProgressTask.id}</span>
                </button>
              )}
            </div>
          </div>

          {/* New Branch Form */}
          {showNewBranchInput && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-slate-800/90 border border-indigo-500/40 shadow-lg">
              <GitBranch className="w-4 h-4 text-indigo-400 shrink-0" />
              <input
                ref={branchInputRef}
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
                placeholder="Имя новой ветки (например: feature/new-diff-viewer)"
                className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none font-mono"
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium transition"
              >
                Создать и переключить
              </button>
              <button
                onClick={() => { setShowNewBranchInput(false); setNewBranchName(''); }}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* Local Branches List */}
          <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                Локальные ветки ({details?.branches.length ?? 0})
              </span>
            </div>
            <div className="divide-y divide-slate-800/60">
              {details?.branches.map(branch => {
                const isCurrent = branch === details.currentBranch;
                return (
                  <div
                    key={branch}
                    className={`flex items-center justify-between px-4 py-3 transition group ${
                      isCurrent ? 'bg-indigo-950/30' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isCurrent ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                      <span className={`text-xs font-mono truncate ${isCurrent ? 'text-indigo-300 font-bold' : 'text-slate-200'}`}>
                        {branch}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded font-sans border border-indigo-500/30">
                          Текущая ветка (HEAD)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 opacity-90 group-hover:opacity-100">
                      {!isCurrent && (
                        <>
                          <button
                            onClick={() => handleCheckout(branch)}
                            disabled={isCheckingOut === branch}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition border border-slate-700"
                            title="Переключиться на ветку"
                          >
                            {isCheckingOut === branch ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                            <span>Checkout</span>
                          </button>
                          <button
                            onClick={() => handleMergeBranch(branch)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 text-xs transition border border-indigo-700/50"
                            title={`Слить ${branch} в ${details.currentBranch}`}
                          >
                            <GitMerge className="w-3 h-3" />
                            <span>Merge</span>
                          </button>
                          <button
                            onClick={() => handleDeleteBranch(branch)}
                            className="p-1.5 rounded hover:bg-rose-950/80 text-slate-500 hover:text-rose-400 transition"
                            title="Удалить ветку"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Remote Branches List */}
          {details && details.remoteBranches.length > 0 && (
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-slate-400" />
                  Удаленные ветки ({details.remoteBranches.length})
                </span>
              </div>
              <div className="divide-y divide-slate-800/60">
                {details.remoteBranches.map(branch => (
                  <div key={branch} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/30">
                    <div className="flex items-center gap-2 text-slate-400 text-xs font-mono">
                      <Globe className="w-3.5 h-3.5 text-slate-500" />
                      <span>{branch.replace('remotes/', '')}</span>
                    </div>
                    <button
                      onClick={() => {
                        const localName = branch.split('/').pop() || 'remote-branch';
                        handleCheckout(localName);
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-0.5 rounded bg-slate-800 border border-slate-700"
                    >
                      Track Local
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: COMPARE BRANCHES ═══════════════════════ */}
      {activeTab === 'compare' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Compare Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Сравнить:</span>
              <select
                value={compareTargetBranch}
                onChange={e => setCompareTargetBranch(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 outline-none font-mono"
              >
                {details?.branches.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="text-slate-500 font-bold">←</span>
              <span className="px-2 py-1 bg-indigo-950 border border-indigo-700 text-indigo-300 rounded font-mono">
                {details?.currentBranch} (HEAD)
              </span>
            </div>

            <button
              onClick={handleRunCompare}
              disabled={isComparing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition"
            >
              {isComparing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
              <span>Обновить сравнение</span>
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            <SplitDiffViewer
              diff={gitDiffContent}
              filePath={`Diff: ${compareTargetBranch} .. ${details?.currentBranch}`}
              defaultMode="split"
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════ TAB: HISTORY ═══════════════════════ */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-3">
          {gitLogs.map(c => (
            <div key={c.hash} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-slate-200 mb-1">{c.message}</h4>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {c.author_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(c.date).toLocaleString()}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-400 shrink-0">
                  {c.hash.substring(0, 7)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════════════ TAB: WORKTREES ═══════════════════════ */}
      {activeTab === 'worktrees' && <WorktreePanel />}

    </div>
  );
};