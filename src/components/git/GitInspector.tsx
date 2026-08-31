import React, { useState, useEffect, useRef } from 'react';
import {
  GitBranch,
  GitCommit as GitCommitIcon,
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
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { generateCommitMessage } from '../../services/aiAssistantService';

// ─── Diff Viewer ──────────────────────────────────────────────────────────────

const DiffViewer: React.FC<{ diff: string }> = ({ diff }) => {
  if (!diff) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-slate-500 italic">
        Нет изменений для отображения
      </div>
    );
  }

  const lines = diff.split('\n');
  return (
    <div className="font-mono text-[11px] leading-5 overflow-x-auto">
      {lines.map((line, i) => {
        let cls = 'text-slate-400 px-3';
        if (line.startsWith('+++') || line.startsWith('---')) {
          cls = 'text-slate-300 px-3 bg-slate-800/60';
        } else if (line.startsWith('@@')) {
          cls = 'text-cyan-400 px-3 bg-cyan-950/30';
        } else if (line.startsWith('+')) {
          cls = 'text-emerald-400 bg-emerald-950/30 px-3';
        } else if (line.startsWith('-')) {
          cls = 'text-rose-400 bg-rose-950/30 px-3';
        }
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            {line || ' '}
          </div>
        );
      })}
    </div>
  );
};

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

type GitTab = 'history' | 'branches' | 'working';

export const GitInspector: React.FC = () => {
  const {
    selectedProject,
    gitLogs,
    gitRepoDetails,
    gitSelectedFile,
    gitDiffContent,
    tasks,
    loadGitRepoDetails,
    gitCheckoutBranch,
    gitCreateBranch,
    gitStageFile,
    gitUnstageFile,
    gitStageAll,
    gitCommit,
    gitLoadFileDiff
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<GitTab>('history');
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranchInput, setShowNewBranchInput] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState<string | null>(null);
  const [diffStagedMode, setDiffStagedMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 4000);
  };

  // Insert current task id into commit message
  const inProgressTask = tasks.find(t => t.status === 'In Progress');
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
    if (!ok) showError(`Не удалось переключиться на ветку "${branch}". Возможно, есть незакоммиченные изменения.`);
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    const ok = await gitCreateBranch(name);
    if (ok) {
      setNewBranchName('');
      setShowNewBranchInput(false);
    } else {
      showError(`Не удалось создать ветку "${name}".`);
    }
  };

  const handleCreateBranchForTask = async () => {
    if (!inProgressTask) return;
    const branchName = `feat/${inProgressTask.id}`;
    const ok = await gitCreateBranch(branchName);
    if (!ok) showError(`Не удалось создать ветку "${branchName}".`);
  };

  const handleCommit = async () => {
    const msg = commitMessage.trim();
    if (!msg) return;
    setIsCommitting(true);
    const ok = await gitCommit(msg, false);
    setIsCommitting(false);
    if (ok) {
      setCommitMessage('');
    } else {
      showError('Ошибка создания коммита. Убедитесь, что есть staged файлы.');
    }
  };

  const handleFileClick = (filePath: string, staged: boolean) => {
    setDiffStagedMode(staged);
    gitLoadFileDiff(filePath, staged);
  };

  // ── Guard: no git ──
  if (!selectedProject?.hasGit) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <GitBranch className="w-12 h-12 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-white mb-1">Git-репозиторий не инициализирован</h3>
        <p className="text-xs text-slate-400 max-w-sm">
          В этой папке нет каталога .git. Инициализируйте репозиторий командой{' '}
          <code className="font-mono text-slate-300">git init</code>.
        </p>
      </div>
    );
  }

  const details = gitRepoDetails;
  const stagedFiles = details?.files.filter(f => f.staged) ?? [];
  const unstagedFiles = details?.files.filter(f => !f.staged) ?? [];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">

      {/* Error Toast */}
      {errorMsg && (
        <div className="mx-4 mt-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-0.5 px-4 pt-3 pb-0 shrink-0 flex-nowrap overflow-x-auto no-scrollbar">
        {([
          { id: 'history', label: `История (${gitLogs.length})`, shortLabel: `История (${gitLogs.length})`, title: 'История коммитов Git', icon: GitCommitIcon },
          { id: 'branches', label: `Ветки${details ? ` (${details.branches.length})` : ''}`, shortLabel: `Ветки${details ? ` (${details.branches.length})` : ''}`, title: 'Управление локальными и удаленными ветками', icon: GitBranch },
          { id: 'working', label: `Рабочая копия${details ? ` (${details.files.length})` : ''}`, shortLabel: `Файлы${details ? ` (${details.files.length})` : ''}`, title: 'Измененные и staged файлы (Working Copy)', icon: FileDiff }
        ] as { id: GitTab; label: string; shortLabel: string; title: string; icon: any }[]).map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.title}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition border-b-2 shrink-0 whitespace-nowrap ${
                isActive
                  ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Icon className="w-3 h-3 shrink-0" />
              <span className="hidden md:inline">{tab.label}</span>
              <span className="hidden sm:inline md:hidden">{tab.shortLabel}</span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 pr-1 shrink-0 flex-nowrap">
          {/* Current branch badge */}
          {details && (
            <span
              className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50 text-slate-300 shrink-0 whitespace-nowrap"
              title={`Текущая активная ветка: ${details.currentBranch} (${details.isClean ? 'чисто' : `${details.files.length} измененных файлов`})`}
            >
              <GitBranch className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="truncate max-w-[140px]">{details.currentBranch}</span>
              {details.isClean ? (
                <span className="text-emerald-400 text-[9px] font-sans shrink-0">clean</span>
              ) : (
                <span className="text-amber-400 text-[9px] font-sans shrink-0">{details.files.length} dirty</span>
              )}
            </span>
          )}
          <button
            onClick={() => selectedProject && loadGitRepoDetails(selectedProject)}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition shrink-0"
            title="Обновить Git-статус и список веток"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="border-b border-slate-800/80 mx-4" />

      {/* ═══════════════════════ TAB: HISTORY ═══════════════════════ */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {gitLogs.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-xs text-slate-500">
              В репозитории пока нет коммитов.
            </div>
          ) : (
            gitLogs.map((commit, idx) => (
              <div
                key={commit.hash}
                className="flex items-start gap-3 group"
              >
                {/* Graph line */}
                <div className="flex flex-col items-center shrink-0 mt-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-500/15 shrink-0" />
                  {idx !== gitLogs.length - 1 && (
                    <div className="w-px flex-1 min-h-[32px] bg-gradient-to-b from-indigo-600/50 to-slate-700/40 my-0.5" />
                  )}
                </div>

                {/* Commit card */}
                <div className="flex-1 pb-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200 leading-5 min-w-0 truncate">
                      {commit.message}
                    </span>
                    <span className="font-mono text-[10px] text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0 ml-2">
                      {commit.hash.slice(0, 7)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono mt-0.5">
                    <span className="flex items-center gap-1">
                      <User className="w-2.5 h-2.5" />
                      {commit.author_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-2.5 h-2.5" />
                      {new Date(commit.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: BRANCHES ═══════════════════════ */}
      {activeTab === 'branches' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowNewBranchInput(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium transition"
            >
              <Plus className="w-3 h-3" />
              Новая ветка
            </button>
            {inProgressTask && (
              <button
                onClick={handleCreateBranchForTask}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 hover:bg-violet-600/30 text-violet-300 text-xs font-medium transition"
                title={`Создать ветку feat/${inProgressTask.id}`}
              >
                <GitBranch className="w-3 h-3" />
                feat/{inProgressTask.id}
              </button>
            )}
          </div>

          {/* New branch input */}
          {showNewBranchInput && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <input
                ref={branchInputRef}
                value={newBranchName}
                onChange={e => setNewBranchName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateBranch()}
                placeholder="feature/my-branch-name"
                className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none font-mono"
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim()}
                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium transition"
              >
                Создать
              </button>
              <button
                onClick={() => { setShowNewBranchInput(false); setNewBranchName(''); }}
                className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {!details ? (
            <div className="text-xs text-slate-500 text-center py-8">Загрузка...</div>
          ) : (
            <>
              {/* Local branches */}
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  <GitBranch className="w-3 h-3" />
                  Локальные ветки
                </div>
                <div className="space-y-1">
                  {details.branches.map(branch => {
                    const isCurrent = branch === details.currentBranch;
                    return (
                      <div
                        key={branch}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg transition group ${
                          isCurrent
                            ? 'bg-indigo-500/15 border border-indigo-500/30'
                            : 'hover:bg-slate-800/60 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isCurrent ? (
                            <Check className="w-3 h-3 text-indigo-400 shrink-0" />
                          ) : (
                            <Circle className="w-3 h-3 text-slate-600 shrink-0" />
                          )}
                          <span className={`text-xs font-mono truncate ${isCurrent ? 'text-indigo-300 font-semibold' : 'text-slate-300'}`}>
                            {branch}
                          </span>
                          {isCurrent && (
                            <span className="text-[9px] text-indigo-400 bg-indigo-500/10 px-1.5 rounded font-sans">
                              HEAD
                            </span>
                          )}
                        </div>
                        {!isCurrent && (
                          <button
                            onClick={() => handleCheckout(branch)}
                            disabled={isCheckingOut === branch}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] transition"
                          >
                            {isCheckingOut === branch ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <ChevronRight className="w-2.5 h-2.5" />
                            )}
                            checkout
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Remote branches */}
              {details.remoteBranches.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    <Globe className="w-3 h-3" />
                    Remote ветки
                  </div>
                  <div className="space-y-1">
                    {details.remoteBranches.map(branch => (
                      <div key={branch} className="flex items-center gap-2 px-3 py-1.5 rounded-lg">
                        <Circle className="w-2.5 h-2.5 text-slate-700 shrink-0" />
                        <span className="text-[11px] font-mono text-slate-500 truncate">{branch.replace('remotes/', '')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {details.tags.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    <Tag className="w-3 h-3" />
                    Теги ({details.tags.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {details.tags.map(tag => (
                      <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/40 border border-amber-700/40 text-amber-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stashes */}
              {details.stashes.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    <Archive className="w-3 h-3" />
                    Стеши ({details.stashes.length})
                  </div>
                  <div className="space-y-1">
                    {details.stashes.map((stash, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40">
                        <Archive className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="text-[11px] font-mono text-slate-400 truncate">{stash}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════ TAB: WORKING COPY ═══════════════════════ */}
      {activeTab === 'working' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            {/* Left: file list */}
            <div className="w-72 shrink-0 flex flex-col border-r border-slate-800/80 overflow-hidden">

              {/* Staged files */}
              <div className="p-3 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider flex items-center gap-1">
                    <ArrowUpFromLine className="w-3 h-3" />
                    Staged ({stagedFiles.length})
                  </span>
                  {stagedFiles.length > 0 && (
                    <button
                      onClick={() => {/* unstage all: one by one */
                        stagedFiles.forEach(f => gitUnstageFile(f.path));
                      }}
                      className="text-[10px] text-slate-500 hover:text-slate-300 transition"
                    >
                      Unstage all
                    </button>
                  )}
                </div>
                {stagedFiles.length === 0 ? (
                  <div className="text-[10px] text-slate-600 italic px-1">Нет staged файлов</div>
                ) : (
                  stagedFiles.map(f => {
                    const statusKey = f.index in statusColors ? f.index : '?';
                    const isSelected = gitSelectedFile === f.path && diffStagedMode;
                    return (
                      <div
                        key={f.path}
                        onClick={() => handleFileClick(f.path, true)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition group ${
                          isSelected ? 'bg-emerald-950/40 border border-emerald-700/40' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded border shrink-0 ${statusColors[statusKey]}`}>
                          {statusLabels[statusKey]}
                        </span>
                        <span className="text-[11px] text-slate-300 truncate flex-1 font-mono" title={f.path}>
                          {f.path.split('/').pop()}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); gitUnstageFile(f.path); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition"
                          title="Unstage"
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t border-slate-800/60 mx-3" />

              {/* Unstaged / Untracked files */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                    <ArrowDownToLine className="w-3 h-3" />
                    Unstaged ({unstagedFiles.length})
                  </span>
                  {unstagedFiles.length > 0 && (
                    <button
                      onClick={() => gitStageAll()}
                      className="text-[10px] text-slate-500 hover:text-emerald-400 transition"
                    >
                      Stage all
                    </button>
                  )}
                </div>
                {unstagedFiles.length === 0 ? (
                  <div className="text-[10px] text-slate-600 italic px-1">Нет изменений</div>
                ) : (
                  unstagedFiles.map(f => {
                    const statusKey = f.index in statusColors ? f.index : '?';
                    const isSelected = gitSelectedFile === f.path && !diffStagedMode;
                    return (
                      <div
                        key={f.path}
                        onClick={() => handleFileClick(f.path, false)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition group ${
                          isSelected ? 'bg-amber-950/30 border border-amber-700/40' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded border shrink-0 ${statusColors[statusKey]}`}>
                          {statusLabels[statusKey]}
                        </span>
                        <span className="text-[11px] text-slate-300 truncate flex-1 font-mono" title={f.path}>
                          {f.path.split('/').pop()}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); gitStageFile(f.path); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-emerald-400 transition"
                          title="Stage"
                        >
                          <ArrowUpFromLine className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Commit form */}
              <div className="p-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center gap-2">
                  <textarea
                    value={commitMessage}
                    onChange={e => setCommitMessage(e.target.value)}
                    placeholder="Сообщение коммита..."
                    className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/60 resize-none h-14 font-mono"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.ctrlKey) handleCommit();
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {inProgressTask && (
                    <button
                      onClick={insertTaskId}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-violet-900/40 border border-violet-700/40 text-violet-300 text-[10px] hover:bg-violet-900/60 transition"
                      title={`Вставить ID задачи: ${inProgressTask.id}`}
                    >
                      <Layers className="w-2.5 h-2.5" />
                      {inProgressTask.id}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const activeTask = tasks.find(t => t.status === 'In Progress') || tasks[0];
                      const changed = stagedFiles.map(f => f.path);
                      const msg = await generateCommitMessage(activeTask?.id, activeTask?.title, changed);
                      setCommitMessage(msg);
                    }}
                    type="button"
                    className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] hover:bg-amber-500/20 transition"
                    title="Сгенерировать AI-сообщение коммита"
                  >
                    <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                    AI Сообщение
                  </button>
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim() || isCommitting || stagedFiles.length === 0}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium transition"
                  >
                    {isCommitting ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    Commit
                  </button>
                </div>
              </div>
            </div>

            {/* Right: diff viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {gitSelectedFile ? (
                <>
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800/60 shrink-0">
                    <FileDiff className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="text-xs font-mono text-slate-300 truncate">{gitSelectedFile}</span>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                      diffStagedMode
                        ? 'text-emerald-400 bg-emerald-950/30 border-emerald-700/40'
                        : 'text-amber-400 bg-amber-950/30 border-amber-700/40'
                    }`}>
                      {diffStagedMode ? 'staged' : 'unstaged'}
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto bg-[#0d0f17] py-2">
                    <DiffViewer diff={gitDiffContent} />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <FileDiff className="w-10 h-10 text-slate-700 mb-3" />
                  <p className="text-xs text-slate-500">Выберите файл слева для просмотра diff</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};