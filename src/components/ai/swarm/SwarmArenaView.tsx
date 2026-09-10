import React, { useState, useEffect } from 'react';
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
  Bot,
  GitCommit,
  Bookmark
} from 'lucide-react';
import { useSwarmStore } from '../../../store/useSwarmStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { useTranslation } from '../../../i18n/useTranslation';
import { useDialog } from '../../../hooks/useDialog';
import { MarkdownViewer } from '../../common/MarkdownViewer';
import { NewSwarmModal } from './NewSwarmModal';
import type { AgentSlotState, SwarmSession } from '../../../types/electron';

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
    initSwarmEventListener,
    isLoading
  } = useSwarmStore();

  const { selectedProject } = useProjectStore();
  const projectPath = selectedProject?.path || '';

  const projectSwarms: SwarmSession[] = swarms[projectPath] || [];
  const currentSwarmId = activeSwarmId[projectPath] || projectSwarms[0]?.id;
  const currentSwarm = projectSwarms.find((s) => s.id === currentSwarmId) || projectSwarms[0];

  const [activeTabByAgent, setActiveTabByAgent] = useState<Record<string, 'output' | 'logs' | 'diff'>>({});
  const [isMergingWinner, setIsMergingWinner] = useState<string | null>(null);
  const [appliedFileMsg, setAppliedFileMsg] = useState<string | null>(null);
  const [isApplyingFile, setIsApplyingFile] = useState(false);

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
        setAppliedFileMsg(`${t.swarm.fileApplied}: ${filePath}`);
        setTimeout(() => setAppliedFileMsg(null), 4000);
      } else {
        await dialog.alert(res.error || 'Failed to apply file');
      }
    } finally {
      setIsApplyingFile(false);
    }
  };

  const getAgentTab = (agentId: string): 'output' | 'logs' | 'diff' => {
    return activeTabByAgent[agentId] || 'output';
  };

  const setAgentTab = (agentId: string, tab: 'output' | 'logs' | 'diff') => {
    setActiveTabByAgent((prev) => ({ ...prev, [agentId]: tab }));
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
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {currentSwarm.status === 'running'
                    ? t.swarm.statusRunning
                    : currentSwarm.status === 'completed'
                    ? t.swarm.statusCompleted
                    : currentSwarm.status}
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

              <div className="text-right text-[11px] text-muted-foreground shrink-0">
                {t.swarm.baseBranchLabel} <span className="font-mono text-foreground font-semibold">{currentSwarm.baseBranch}</span>
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

                          {agent.metrics.tokensEstimated ? (
                            <span title={t.swarm.approxTokensTooltip}>
                              ~{agent.metrics.tokensEstimated} tok
                            </span>
                          ) : null}

                          {agent.diffSummary && (
                            <span className="font-mono text-[10px]">
                              <span className="text-emerald-400">+{agent.diffSummary.insertions}</span>{' '}
                              <span className="text-rose-400">-{agent.diffSummary.deletions}</span>
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
                      </div>

                      {/* Tab Body */}
                      <div className="flex-1 overflow-y-auto p-4 text-xs">
                        {currentTab === 'output' && (
                          <div className="h-full overflow-y-auto">
                            {agent.liveOutput || agent.finalOutput ? (
                              <MarkdownViewer
                                content={agent.finalOutput || agent.liveOutput}
                                className="text-xs"
                              />
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
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* New Swarm Modal */}
      <NewSwarmModal />
    </div>
  );
};
