import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Zap,
  Play,
  Square,
  Trophy,
  GitFork,
  GitMerge,
  Clock,
  Code2,
  Terminal,
  FileText,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  ChevronRight,
  ExternalLink,
  GitCommit,
  Bookmark,
  Download,
  RotateCcw,
  Trash2,
  ScrollText,
  X,
  AlertTriangle,
  DollarSign,
  Gavel,
  ClipboardCheck
} from 'lucide-react';
import { useSwarmStore } from '../../../store/useSwarmStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { useTranslation } from '../../../i18n/useTranslation';
import { useDialog } from '../../../hooks/useDialog';
import { useToast } from '../../../hooks/useTimeoutState';
import { MarkdownViewer } from '../../common/MarkdownViewer';
import { NewSwarmModal } from './NewSwarmModal';
import { ArenaJudgePanel } from './ArenaJudgePanel';
import { ArenaSettingsModal } from './ArenaSettingsModal';
import { ComposeResultModal } from './ComposeResultModal';
import type { AgentSlotState, SwarmSession, SwarmTranscript } from '../../../types/electron';
import { agentInputTokens, formatDuration, formatTokens, formatUsd, summarizeSwarm } from '../../../utils/swarmFormat';
import {
  checkStatusClass,
  checkStatusLabel,
  checksSummary,
  componentLabel,
  formatScore,
  scoreClass,
  severityClass,
  severityLabel,
  verdictClass,
  verdictLabel
} from '../../../utils/arenaFormat';

/** Вкладки карточки кандидата: к выводу/логам/диффу добавлены проверки и ревью судьи (TASK-61). */
type AgentTab = 'output' | 'logs' | 'diff' | 'checks' | 'review';

export const SwarmArenaView: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    swarms,
    activeSwarmId,
    loadSwarmsAction,
    setActiveSwarmId,
    openNewSwarmModal,
    stopSwarmAction,
    pickWinnerAction,
    resumeSwarmAction,
    discardSwarmAction,
    getTranscriptAction,
    exportSwarmAction,
    runJudgeAction,
    cancelJudgeAction,
    initSwarmEventListener,
    isLoading
  } = useSwarmStore();

  const { selectedProject } = useProjectStore();
  const projectPath = selectedProject?.path || '';

  const projectSwarms: SwarmSession[] = swarms[projectPath] || [];
  const currentSwarmId = activeSwarmId[projectPath] || projectSwarms[0]?.id;
  const currentSwarm = projectSwarms.find((s) => s.id === currentSwarmId) || projectSwarms[0];

  const [activeTabByAgent, setActiveTabByAgent] = useState<Record<string, AgentTab>>({});
  const [isJudgeSettingsOpen, setJudgeSettingsOpen] = useState(false);
  const [isComposeOpen, setComposeOpen] = useState(false);
  const [isMergingWinner, setIsMergingWinner] = useState<string | null>(null);
  // Временные уведомления с автоскрытием и очисткой таймеров (TASK-50)
  const [appliedFileMsg, showAppliedFileMsg] = useToast<string>(4000);
  const [isApplyingFile, setIsApplyingFile] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [transcript, setTranscript] = useState<{ agent: AgentSlotState; data: SwarmTranscript | null; loading: boolean } | null>(null);
  const [noticeMsg, showNotice] = useToast<string>(5000);

  const handleResume = async () => {
    if (!currentSwarm) return;
    setIsResuming(true);
    try {
      const res = await resumeSwarmAction(currentSwarm.id);
      if (!res.success) await dialog.alert(t.swarm.resumeError.replace('{error}', res.error || ''));
    } finally {
      setIsResuming(false);
    }
  };

  const handleDiscard = async () => {
    if (!currentSwarm) return;
    const ok = await dialog.confirm({
      title: t.swarm.deleteSession,
      message: t.swarm.discardConfirm.replace('{id}', currentSwarm.id),
      danger: true
    });
    if (!ok) return;
    const res = await discardSwarmAction(projectPath, currentSwarm.id);
    if (!res.success) await dialog.alert(t.swarm.discardError.replace('{error}', res.error || ''));
  };

  const handleExport = async (format: 'markdown' | 'json') => {
    if (!currentSwarm) return;
    setIsExporting(true);
    try {
      const res = await exportSwarmAction(currentSwarm.id, format);
      if (res.success && res.path) showNotice(t.swarm.exportDone.replace('{path}', res.path));
      else if (!res.canceled) await dialog.alert(t.swarm.exportError.replace('{error}', res.error || ''));
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenTranscript = async (agent: AgentSlotState) => {
    if (!currentSwarm) return;
    setTranscript({ agent, data: null, loading: true });
    const data = await getTranscriptAction(currentSwarm.id, agent.id);
    setTranscript((prev) => (prev && prev.agent.id === agent.id ? { agent, data, loading: false } : prev));
  };

  const swarmStatusLabel = (status: SwarmSession['status']): string => {
    switch (status) {
      case 'running':
        return t.swarm.statusRunning;
      case 'completed':
        return t.swarm.statusCompleted;
      case 'failed':
        return t.swarm.statusFailed;
      case 'interrupted':
        return t.swarm.statusInterrupted;
      case 'stopped':
        return t.swarm.statusStopped;
      default:
        return status;
    }
  };

  const agentStatusBadge = (agent: AgentSlotState): { label: string; className: string } | null => {
    switch (agent.status) {
      case 'interrupted':
        return { label: t.swarm.agentStatusInterrupted, className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'budget_exceeded':
        return { label: t.swarm.agentStatusBudget, className: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
      case 'stopped':
        return { label: t.swarm.agentStatusStopped, className: 'bg-muted text-muted-foreground border-border' };
      case 'failed':
        return { label: t.swarm.agentStatusFailed, className: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
      default:
        return null;
    }
  };

  const costSourceLabel = (source: string | undefined): string => {
    if (source === 'provider') return t.swarm.costSourceProvider;
    if (source === 'price-table') return t.swarm.costSourcePriceTable;
    return t.swarm.costSourceUnknown;
  };

  const totals = currentSwarm ? summarizeSwarm(currentSwarm) : null;

  useEffect(() => {
    if (projectPath) {
      loadSwarmsAction(projectPath);
    }
    const unsubscribe = initSwarmEventListener();
    return () => {
      unsubscribe();
    };
  }, [projectPath]);

  const handlePickWinner = async (agentId: string) => {
    if (!currentSwarm) return;
    setIsMergingWinner(agentId);
    try {
      const res = await pickWinnerAction(currentSwarm.id, agentId, true);
      if (!res.success) {
        if (res.conflictedFiles && res.conflictedFiles.length > 0) {
          await dialog.alert(
            `${t.swarm.mergeConflictTitle}\n\n${t.swarm.mergeConflictDesc}\n\n${res.conflictedFiles.join('\n')}`
          );
        } else {
          await dialog.alert(t.swarm.mergeWinnerError.replace('{error}', res.error || ''));
        }
      }
    } finally {
      setIsMergingWinner(null);
    }
  };

  const handleApplyFile = async (branch: string, filePath: string) => {
    if (!branch || !filePath || !projectPath) return;
    setIsApplyingFile(true);
    try {
      const res = await window.api.checkoutWorktreeFiles(projectPath, branch, [filePath]);
      if (res.success) {
        showAppliedFileMsg(`${t.swarm.fileApplied}: ${filePath}`);
      } else {
        await dialog.alert(res.error || 'Failed to apply file');
      }
    } finally {
      setIsApplyingFile(false);
    }
  };

  const getAgentTab = (agentId: string): AgentTab => {
    return activeTabByAgent[agentId] || 'output';
  };

  const setAgentTab = (agentId: string, tab: AgentTab) => {
    setActiveTabByAgent((prev) => ({ ...prev, [agentId]: tab }));
  };

  const handleRunJudge = async (options?: { rerunChecks?: boolean }) => {
    if (!currentSwarm) return;
    const res = await runJudgeAction(currentSwarm.id, options);
    if (!res.success && res.error) await dialog.alert(t.judge.judgeError.replace('{error}', res.error));
  };

  if (!projectPath) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground text-sm">
        {t.swarm.selectProjectPrompt}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      {/* Top Header Bar */}
      <div className="border-b border-border bg-card/60 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-foreground">
                {t.swarm.title}
              </h1>
              {currentSwarm && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    currentSwarm.status === 'running'
                      ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse'
                      : currentSwarm.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : currentSwarm.status === 'interrupted'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : currentSwarm.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {swarmStatusLabel(currentSwarm.status)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t.swarm.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Селектор истории запусков роя */}
          {projectSwarms.length > 1 && (
            <select
              value={currentSwarm?.id || ''}
              onChange={(e) => setActiveSwarmId(projectPath, e.target.value)}
              className="text-xs rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-foreground focus:outline-hidden"
            >
              {projectSwarms.map((s, idx) => (
                <option key={s.id} value={s.id}>
                  {t.swarm.runHistoryItem
                    .replace('{index}', String(projectSwarms.length - idx))
                    .replace('{mode}', s.mode === 'fan_out' ? t.swarm.modeArena : t.swarm.modePipelineName)
                    .replace('{date}', new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}
                </option>
              ))}
            </select>
          )}

          {currentSwarm && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleExport('markdown')}
                disabled={isExporting}
                title={t.swarm.exportMarkdown}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> .md
              </button>
              <button
                onClick={() => handleExport('json')}
                disabled={isExporting}
                title={t.swarm.exportJson}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> .json
              </button>
              {currentSwarm.status !== 'running' && currentSwarm.status !== 'preparing' && (
                <button
                  onClick={handleDiscard}
                  title={t.swarm.deleteSession}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border/70 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {currentSwarm && currentSwarm.status === 'running' && (
            <button
              onClick={() => stopSwarmAction(currentSwarm.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              {t.swarm.stopAll}
            </button>
          )}

          <button
            onClick={() => openNewSwarmModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.swarm.newDuel}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!currentSwarm ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 mb-4 shadow-inner">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-1">
              {t.swarm.noActiveSwarm}
            </h2>
            <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
              {t.swarm.noActiveSwarmDesc}
            </p>
            <button
              onClick={() => openNewSwarmModal()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              {t.swarm.startSwarmButton}
            </button>
          </div>
        ) : (
          <>
            {noticeMsg && (
              <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="truncate">{noticeMsg}</span>
              </div>
            )}

            {/* Interrupted session: resume or discard (TASK-56) */}
            {currentSwarm.status === 'interrupted' && (
              <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-foreground">{t.swarm.interruptedBannerTitle}</div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.swarm.interruptedBannerDesc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleResume}
                    disabled={isResuming || !currentSwarm.agents.some((a) => a.status === 'interrupted' && !a.worktreeMissing)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isResuming ? 'animate-spin' : ''}`} />
                    {t.swarm.resumeSession}
                  </button>
                  <button
                    onClick={handleDiscard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t.swarm.discardSession}
                  </button>
                </div>
              </div>
            )}

            {currentSwarm.status === 'failed' && currentSwarm.error && (
              <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{currentSwarm.error}</span>
              </div>
            )}

            {/* Swarm Context & Task Banner */}
            <div className="p-4 rounded-xl border border-border/70 bg-card/40 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary flex items-center gap-1">
                    {currentSwarm.mode === 'fan_out' ? (
                      <>
                        <Zap className="w-3.5 h-3.5" /> Fan-Out Arena
                      </>
                    ) : (
                      <>
                        <Layers className="w-3.5 h-3.5" /> Handoff Pipeline
                      </>
                    )}
                  </span>
                  {currentSwarm.taskId && (
                    <span className="px-2 py-0.5 rounded-sm bg-secondary text-[11px] font-mono text-muted-foreground">
                      {currentSwarm.taskId}
                    </span>
                  )}
                  {currentSwarm.useWorktrees && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-500 text-[10px] font-medium border border-emerald-500/20">
                      <GitFork className="w-3 h-3" /> Worktrees Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground font-medium line-clamp-2">
                  {currentSwarm.prompt}
                </p>
              </div>

              <div className="text-right text-[11px] text-muted-foreground shrink-0 space-y-1">
                <div>
                  {t.swarm.baseBranchLabel} <span className="font-mono text-foreground font-semibold">{currentSwarm.baseBranch}</span>
                </div>
                {totals && (
                  <div className="flex items-center justify-end gap-3 font-mono text-[10px]" title={t.swarm.sessionSummaryTitle}>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDuration(totals.durationMs, t.swarm.secondsUnit)}
                    </span>
                    {totals.usage.totalTokens > 0 && (
                      <span title={`${t.swarm.tokensLabel}: ${formatTokens(agentInputTokens(totals.usage))} / ${formatTokens(totals.usage.outputTokens)}`}>
                        {formatTokens(agentInputTokens(totals.usage))} / {formatTokens(totals.usage.outputTokens)} tok
                      </span>
                    )}
                    <span
                      className={`flex items-center gap-1 ${
                        typeof currentSwarm.budgetUsd === 'number' &&
                        typeof totals.costUsd === 'number' &&
                        totals.costUsd > currentSwarm.budgetUsd
                          ? 'text-rose-400 font-semibold'
                          : 'text-foreground'
                      }`}
                      title={t.swarm.costLabel}
                    >
                      <DollarSign className="w-3 h-3" />
                      {totals.costKnown ? formatUsd(totals.costUsd) : '—'}
                      {typeof currentSwarm.budgetUsd === 'number' && currentSwarm.budgetUsd > 0 && (
                        <span className="text-muted-foreground"> / {formatUsd(currentSwarm.budgetUsd)}</span>
                      )}
                    </span>
                  </div>
                )}
                {currentSwarm.restored && (
                  <div className="text-[10px] text-muted-foreground/70 italic">{t.swarm.restoredBadge}</div>
                )}
              </div>
            </div>

            {/* Handoff Stepper (если режим конвейера) */}
            {currentSwarm.mode === 'handoff' && currentSwarm.handoffStages && (
              <div className="p-4 rounded-xl border border-border/70 bg-card/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.swarm.handoffStagesTitle}
                  </span>
                  <span className="text-xs text-primary font-medium">
                    {t.swarm.handoffStageProgress
                      .replace('{current}', String((currentSwarm.currentHandoffStageIndex ?? 0) + 1))
                      .replace('{total}', String(currentSwarm.handoffStages.length))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {currentSwarm.handoffStages.map((stage, idx) => {
                    const isDone = stage.status === 'completed';
                    const isRunning = stage.status === 'running';
                    const isFailed = stage.status === 'failed';
                    return (
                      <React.Fragment key={idx}>
                        <div
                          className={`flex-1 p-3 rounded-lg border text-xs transition-all ${
                            isRunning
                              ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                              : isDone
                              ? 'border-emerald-500/40 bg-emerald-500/5 text-foreground'
                              : isFailed
                              ? 'border-destructive/40 bg-destructive/5'
                              : 'border-border/60 bg-secondary/20 text-muted-foreground'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-foreground">{stage.role}</span>
                            {isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : isRunning ? (
                              <RefreshCw className="w-3.5 h-3.5 text-primary animate-spin" />
                            ) : isFailed ? (
                              <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">#{idx + 1}</span>
                            )}
                          </div>
                          {stage.durationMs && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {(stage.durationMs / 1000).toFixed(1)} {t.swarm.secondsUnit}
                            </div>
                          )}
                        </div>
                        {idx < currentSwarm.handoffStages!.length - 1 && (
                          <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Автосудья (TASK-61, decision-12) — только для арены fan-out */}
            {currentSwarm.mode === 'fan_out' && (
              <ArenaJudgePanel
                session={currentSwarm}
                isRunning={currentSwarm.judge?.status === 'running'}
                onRun={handleRunJudge}
                onCancel={() => cancelJudgeAction(currentSwarm.id)}
                onOpenSettings={() => setJudgeSettingsOpen(true)}
                onOpenCompose={() => setComposeOpen(true)}
              />
            )}

            {/* Side-by-Side Arena Grid (AC #4) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.swarm.contestantsTitle.replace('{count}', String(currentSwarm.agents.length))}
                </h3>
              </div>

              <div
                className={`grid gap-4 ${
                  currentSwarm.agents.length === 1
                    ? 'grid-cols-1'
                    : currentSwarm.agents.length === 2
                    ? 'grid-cols-1 lg:grid-cols-2'
                    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
                }`}
              >
                {currentSwarm.agents.map((agent) => {
                  const currentTab = getAgentTab(agent.id);
                  const isWinner = agent.winner || currentSwarm.winnerAgentId === agent.id;

                  return (
                    <div
                      key={agent.id}
                      className={`flex flex-col rounded-xl border bg-card shadow-sm transition-all h-[560px] ${
                        isWinner
                          ? 'border-emerald-500/80 ring-2 ring-emerald-500/20 bg-emerald-500/5'
                          : agent.status === 'running'
                          ? 'border-primary/50 ring-1 ring-primary/20'
                          : 'border-border'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="p-4 border-b border-border/80 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground truncate">
                              {agent.config.name}
                            </span>
                            {isWinner && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30">
                                <Trophy className="w-3 h-3 text-amber-400" /> {t.swarm.winnerBadge}
                              </span>
                            )}
                            {(() => {
                              const badge = agentStatusBadge(agent);
                              return badge ? (
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.className}`}
                                  title={agent.error || badge.label}
                                >
                                  {badge.label}
                                </span>
                              ) : null;
                            })()}
                            {agent.worktreeMissing && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-rose-500/10 text-rose-400 border-rose-500/30">
                                {t.swarm.worktreeMissingBadge}
                              </span>
                            )}
                            {currentSwarm.judge?.recommendedAgentId === agent.id && !isWinner && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold border border-primary/30">
                                <Gavel className="w-3 h-3" /> {t.judge.recommendedBadge}
                              </span>
                            )}
                            {agent.score?.blocked && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-rose-500/10 text-rose-400 border-rose-500/30"
                                title={agent.score.blockedReason}
                              >
                                {t.judge.blockedBadge}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] px-1.5 py-0.2 rounded-sm bg-secondary font-mono text-muted-foreground">
                              {agent.config.engine}
                            </span>
                            {agent.config.role && (
                              <span className="text-[11px] text-muted-foreground font-medium">
                                {agent.config.role}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Pick Winner Button (AC #5) */}
                        {!isWinner && currentSwarm.status !== 'stopped' && (
                          <button
                            onClick={() => handlePickWinner(agent.id)}
                            disabled={isMergingWinner !== null || agent.status !== 'completed'}
                            title={t.swarm.mergeWinnerTooltip}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 transition-all shadow-xs shrink-0"
                          >
                            <Trophy className="w-3 h-3" />
                            {isMergingWinner === agent.id ? t.swarm.mergingStatus : t.swarm.pickButton}
                          </button>
                        )}
                      </div>

                      {/* Worktree & Metrics Bar */}
                      <div className="px-4 py-2 bg-secondary/20 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-2 text-muted-foreground truncate">
                          <div className="flex items-center gap-1.5 truncate">
                            <GitFork className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="font-mono text-[10px] truncate" title={agent.worktreeBranch}>
                              {agent.worktreeBranch || 'main'}
                            </span>
                          </div>

                          {/* Commit / Stash Badge */}
                          {agent.commitHash ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono text-[10px]"
                              title={`${t.swarm.statusCommitted}: ${agent.commitHash}`}
                            >
                              <GitCommit className="w-3 h-3 text-emerald-400" />
                              {agent.commitHash.slice(0, 7)}
                            </span>
                          ) : agent.stashHash ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono text-[10px]"
                              title={`${t.swarm.statusStashed}: ${agent.stashHash}`}
                            >
                              <Bookmark className="w-3 h-3 text-amber-400" />
                              stash
                            </span>
                          ) : agent.commitStatus === 'no_changes' ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono text-[10px]"
                              title={t.swarm.statusNoChanges}
                            >
                              no-diff
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3 text-muted-foreground">
                          {agent.metrics.durationMs ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {(agent.metrics.durationMs / 1000).toFixed(1)} {t.swarm.secondsUnit}
                            </span>
                          ) : null}

                          {agent.metrics.usage ? (
                            <span
                              className="font-mono text-[10px]"
                              title={t.swarm.costTooltip
                                .replace('{cost}', formatUsd(agent.metrics.usage.costUsd))
                                .replace('{source}', costSourceLabel(agent.metrics.usage.costSource))
                                .replace('{input}', formatTokens(agent.metrics.usage.inputTokens))
                                .replace('{output}', formatTokens(agent.metrics.usage.outputTokens))
                                .replace('{cacheRead}', formatTokens(agent.metrics.usage.cacheReadTokens))
                                .replace('{cacheWrite}', formatTokens(agent.metrics.usage.cacheCreationTokens))}
                            >
                              {formatTokens(agentInputTokens(agent.metrics.usage))} / {formatTokens(agent.metrics.usage.outputTokens)} tok
                            </span>
                          ) : agent.metrics.tokensEstimated ? (
                            <span title={t.swarm.approxTokensTooltip}>
                              ~{agent.metrics.tokensEstimated} tok
                            </span>
                          ) : null}

                          {agent.metrics.usage ? (
                            <span
                              className={`flex items-center gap-0.5 font-mono text-[10px] ${
                                agent.status === 'budget_exceeded' ? 'text-rose-400 font-semibold' : 'text-foreground'
                              }`}
                              title={
                                typeof agent.metrics.usage.costUsd === 'number'
                                  ? `${t.swarm.costLabel}: ${formatUsd(agent.metrics.usage.costUsd)} (${costSourceLabel(agent.metrics.usage.costSource)})${
                                      agent.config.budgetUsd ? ` / ${t.swarm.budgetLabel} ${formatUsd(agent.config.budgetUsd)}` : ''
                                    }`
                                  : t.swarm.costUnknownTooltip.replace('{model}', agent.metrics.usage.model || agent.config.providerConfig?.model || '?')
                              }
                            >
                              <DollarSign className="w-3 h-3" />
                              {typeof agent.metrics.usage.costUsd === 'number' ? formatUsd(agent.metrics.usage.costUsd) : '—'}
                            </span>
                          ) : null}

                          {agent.diffSummary && (
                            <span className="font-mono text-[10px]">
                              <span className="text-emerald-400">+{agent.diffSummary.insertions}</span>{' '}
                              <span className="text-rose-400">-{agent.diffSummary.deletions}</span>
                            </span>
                          )}

                          {(() => {
                            const summary = checksSummary(agent.checks);
                            if (summary.total === 0 && summary.running === 0) return null;
                            return (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded border font-mono text-[10px] ${
                                  summary.failed > 0
                                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                    : summary.running > 0
                                    ? 'bg-primary/10 text-primary border-primary/30'
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                }`}
                                title={(agent.checks ?? [])
                                  .map((c) => `${c.name}: ${checkStatusLabel(c.status, t.judge)}`)
                                  .join('\n')}
                              >
                                <ClipboardCheck className="w-3 h-3" />
                                {summary.passed}/{summary.total || agent.checks?.length || 0}
                              </span>
                            );
                          })()}

                          {agent.score && (
                            <span
                              className={`font-mono text-[10px] font-bold ${scoreClass(agent.score)}`}
                              title={agent.score.components
                                .map((c) => `${componentLabel(c.key, t.judge)}: ${c.points.toFixed(1)}/${c.weight} — ${c.unknown ? t.judge.componentUnknown : c.detail}`)
                                .join('\n')}
                            >
                              {t.judge.scoreLabel} {formatScore(agent.score)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Tabs Header */}
                      <div className="flex border-b border-border/60 bg-secondary/10 px-4">
                        <button
                          onClick={() => setAgentTab(agent.id, 'output')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'output'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" /> {t.swarm.outputTab}
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'logs')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'logs'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Terminal className="w-3.5 h-3.5" /> {t.swarm.logsTab.replace('{count}', String(agent.logs.length))}
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'diff')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'diff'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" /> {t.swarm.diffTab.replace('{count}', String(agent.diffSummary?.filesChanged || 0))}
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'checks')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'checks'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" /> {t.judge.checksTab}
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'review')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'review'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Gavel className="w-3.5 h-3.5" /> {t.judge.reviewTab}
                        </button>
                      </div>

                      {/* Tab Body */}
                      <div className="flex-1 overflow-y-auto p-4 text-xs">
                        {currentTab === 'output' && (
                          <div className="h-full overflow-y-auto">
                            {agent.liveOutput || agent.finalOutput ? (
                              <>
                                {agent.liveOutputTruncated && (
                                  <div className="mb-2 text-[10px] text-amber-400/90 italic flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> {t.swarm.outputTruncatedNote}
                                  </div>
                                )}
                                <MarkdownViewer
                                  content={agent.finalOutput || agent.liveOutput}
                                  className="text-xs"
                                />
                              </>
                            ) : (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                {agent.status === 'running' ? (
                                  <div className="flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                                    {t.swarm.generatingSolution}
                                  </div>
                                ) : (
                                  t.swarm.waitingStart
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {currentTab === 'logs' && (
                          <div className="font-mono text-[11px] space-y-1 text-muted-foreground h-full overflow-y-auto select-text">
                            <div className="flex items-center justify-between gap-2 mb-1 font-sans">
                              <span className="text-[10px] text-muted-foreground/80">
                                {agent.logsDropped ? t.swarm.logsDroppedNote.replace('{count}', String(agent.logsDropped)) : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenTranscript(agent)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary hover:bg-secondary/70 text-[10px] text-foreground border border-border/60 transition shrink-0"
                              >
                                <ScrollText className="w-3 h-3" /> {t.swarm.fullLog}
                              </button>
                            </div>
                            {agent.logs.map((line, i) => (
                              <div
                                key={i}
                                className={`leading-relaxed ${
                                  /(error|fail|\u043e\u0448\u0438\u0431\u043a)/i.test(line)
                                    ? 'text-rose-400'
                                    : /(done|success|\u0433\u043e\u0442\u043e\u0432|\u0443\u0441\u043f\u0435\u0448\u043d)/i.test(line)
                                    ? 'text-emerald-400'
                                    : ''
                                }`}
                              >
                                {line}
                              </div>
                            ))}
                            {agent.logs.length === 0 && (
                              <div className="text-center text-muted-foreground py-8">
                                {t.swarm.noLogsRecorded}
                              </div>
                            )}
                          </div>
                        )}

                        {currentTab === 'diff' && (() => {
                          const changedFiles = (() => {
                            if (!agent.diffSummary?.patch) return [];
                            const files: string[] = [];
                            for (const line of agent.diffSummary.patch.split('\n')) {
                              if (line.startsWith('diff --git')) {
                                const parts = line.split(' ');
                                if (parts[2]) files.push(parts[2].replace(/^a\//, ''));
                              }
                            }
                            return Array.from(new Set(files));
                          })();

                          return (
                            <div className="flex flex-col h-full">
                              {appliedFileMsg && (
                                <div className="mb-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded text-[11px] flex items-center gap-1.5 shrink-0">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>{appliedFileMsg}</span>
                                </div>
                              )}

                              {changedFiles.length > 0 && (
                                <div className="mb-2 p-2 bg-secondary/30 rounded border border-border/60 flex flex-wrap items-center gap-2 shrink-0">
                                  <span className="text-[10px] font-medium text-muted-foreground">
                                    {t.worktrees.applySelectedFiles} ({changedFiles.length}):
                                  </span>
                                  {changedFiles.map((file) => (
                                    <div
                                      key={file}
                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background border border-border text-[10px] font-mono"
                                    >
                                      <span className="truncate max-w-[140px]" title={file}>
                                        {file}
                                      </span>
                                      <button
                                        type="button"
                                        disabled={isApplyingFile}
                                        onClick={() => handleApplyFile(agent.worktreeBranch || '', file)}
                                        className="text-emerald-400 hover:text-emerald-300 px-1 py-0.2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-[9px] font-sans transition disabled:opacity-50"
                                        title={t.swarm.applyFileTooltip}
                                      >
                                        {t.swarm.applyFile}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="font-mono text-[11px] flex-1 overflow-y-auto select-text">
                                {agent.diffSummary?.patch ? (
                                  <div className="space-y-0.5">
                                    {agent.diffSummary.patch.split('\n').map((l, i) => {
                                      const isAdd = l.startsWith('+') && !l.startsWith('+++');
                                      const isDel = l.startsWith('-') && !l.startsWith('---');
                                      const isHeader = l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('@@');
                                      return (
                                        <div
                                          key={i}
                                          className={`px-1 py-0.5 rounded-2xs whitespace-pre-wrap ${
                                            isAdd
                                              ? 'bg-emerald-500/10 text-emerald-400'
                                              : isDel
                                              ? 'bg-rose-500/10 text-rose-400'
                                              : isHeader
                                              ? 'text-primary font-bold'
                                              : 'text-muted-foreground'
                                          }`}
                                        >
                                          {l}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="h-full flex items-center justify-center text-muted-foreground">
                                    {t.swarm.noChangesInWorktree}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {currentTab === 'checks' && (
                          <div className="h-full overflow-y-auto space-y-2">
                            {!agent.checks || agent.checks.length === 0 ? (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                {t.judge.checksNone}
                              </div>
                            ) : (
                              agent.checks.map((check) => (
                                <div key={check.id} className="rounded-lg border border-border/60 bg-secondary/20 p-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-xs font-semibold text-foreground truncate">{check.name}</span>
                                      {check.blocking && (
                                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border">
                                          {t.judge.checkBlocking}
                                        </span>
                                      )}
                                    </div>
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${checkStatusClass(check.status)}`}
                                    >
                                      {checkStatusLabel(check.status, t.judge)}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground font-mono">
                                    <span className="truncate max-w-full" title={check.command}>{check.command}</span>
                                    {typeof check.durationMs === 'number' && (
                                      <span>{(check.durationMs / 1000).toFixed(1)} {t.swarm.secondsUnit}</span>
                                    )}
                                    {typeof check.failedTests === 'number' && check.failedTests > 0 && (
                                      <span className="text-rose-400">
                                        {t.judge.checkFailedTests.replace('{count}', String(check.failedTests))}
                                      </span>
                                    )}
                                    {typeof check.errorCount === 'number' && check.errorCount > 0 && (
                                      <span className="text-rose-400">
                                        {t.judge.checkErrors.replace('{count}', String(check.errorCount))}
                                      </span>
                                    )}
                                  </div>
                                  {check.detail && <div className="text-[10px] text-amber-400/90">{check.detail}</div>}
                                  {check.outputTail && check.status !== 'passed' && (
                                    <details className="text-[10px]">
                                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                        {t.judge.checkOutput}
                                      </summary>
                                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground select-text">
                                        {check.outputTail}
                                      </pre>
                                    </details>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        {currentTab === 'review' && (
                          <div className="h-full overflow-y-auto space-y-3">
                            {!agent.review || agent.review.status === 'pending' ? (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                {t.judge.reviewNone}
                              </div>
                            ) : agent.review.status === 'running' ? (
                              <div className="h-full flex items-center justify-center text-muted-foreground gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-primary" /> {t.judge.reviewRunning}
                              </div>
                            ) : agent.review.status === 'skipped' ? (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                {t.judge.reviewSkipped}
                              </div>
                            ) : (
                              <>
                                {agent.review.status === 'failed' && (
                                  <div className="px-2 py-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded text-[11px]">
                                    {t.judge.reviewFailed.replace('{error}', agent.review.error || '')}
                                  </div>
                                )}
                                {agent.review.summary && (
                                  <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                      {t.judge.reviewSummary}
                                    </div>
                                    <p className="text-[11px] text-foreground leading-relaxed">{agent.review.summary}</p>
                                  </div>
                                )}
                                {agent.review.criteria && agent.review.criteria.length > 0 && (
                                  <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                      {t.judge.reviewCriteria}
                                    </div>
                                    <div className="space-y-1">
                                      {agent.review.criteria.map((c) => (
                                        <div key={c.index} className="flex items-start gap-2 text-[11px]">
                                          <span
                                            className={`shrink-0 px-1.5 py-0.2 rounded border text-[9px] font-semibold ${verdictClass(c.verdict)}`}
                                          >
                                            #{c.index} {verdictLabel(c.verdict, t.judge)}
                                          </span>
                                          <span className="text-muted-foreground leading-relaxed">
                                            {c.text}
                                            {c.comment ? ` — ${c.comment}` : ''}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {agent.review.findings && agent.review.findings.length > 0 && (
                                  <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                      {t.judge.reviewFindings}
                                    </div>
                                    <div className="space-y-1">
                                      {agent.review.findings.map((f, i) => (
                                        <div key={i} className="flex items-start gap-2 text-[11px]">
                                          <span
                                            className={`shrink-0 px-1.5 py-0.2 rounded border text-[9px] font-semibold ${severityClass(f.severity)}`}
                                          >
                                            {severityLabel(f.severity, t.judge)}
                                          </span>
                                          <span className="text-muted-foreground leading-relaxed">
                                            {f.file && (
                                              <span className="font-mono text-foreground/80">
                                                {f.file}
                                                {f.line ? `:${f.line}` : ''}{' '}
                                              </span>
                                            )}
                                            {f.message}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {agent.review.risks && agent.review.risks.length > 0 && (
                                  <div>
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                      {t.judge.reviewRisks}
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground">
                                      {agent.review.risks.map((r, i) => (
                                        <li key={i}>{r}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {agent.review.raw && (
                                  <details className="text-[10px]">
                                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                      {t.judge.reviewRaw}
                                    </summary>
                                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground select-text">
                                      {agent.review.raw}
                                    </pre>
                                  </details>
                                )}
                                {agent.review.model && (
                                  <div className="text-[10px] text-muted-foreground/70 font-mono">
                                    {t.judge.reviewModel}: {agent.review.model}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Full transcript modal (TASK-56) */}
      {transcript &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setTranscript(null)}>
          <div
            className="relative w-full max-w-4xl h-[85vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {t.swarm.fullLogTitle.replace('{name}', transcript.agent.config.name)}
                </h3>
                {transcript.data && (
                  <p className="text-[10px] text-muted-foreground font-mono truncate" title={transcript.data.path}>
                    {transcript.data.truncated
                      ? t.swarm.fullLogTruncated
                          .replace('{size}', String(Math.round(transcript.data.sizeBytes / 1024)))
                          .replace('{path}', transcript.data.path)
                      : t.swarm.fullLogPath.replace('{path}', transcript.data.path)}
                  </p>
                )}
              </div>
              <button
                onClick={() => setTranscript(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title={t.swarm.closeButton}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {transcript.loading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                </div>
              ) : transcript.data ? (
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-muted-foreground select-text">
                  {transcript.data.content}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">{t.swarm.fullLogEmpty}</div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Настройки судьи и сборка результата (TASK-61) */}
      {isJudgeSettingsOpen && projectPath && (
        <ArenaSettingsModal projectPath={projectPath} onClose={() => setJudgeSettingsOpen(false)} />
      )}
      {isComposeOpen && currentSwarm && (
        <ComposeResultModal
          session={currentSwarm}
          onClose={() => setComposeOpen(false)}
          onDone={(message) => showNotice(message)}
        />
      )}

      {/* New Swarm Modal */}
      <NewSwarmModal />
    </div>
  );
};
