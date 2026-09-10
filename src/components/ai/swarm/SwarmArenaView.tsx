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
  Bot
} from 'lucide-react';
import { useSwarmStore } from '../../../store/useSwarmStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { MarkdownViewer } from '../../common/MarkdownViewer';
import { NewSwarmModal } from './NewSwarmModal';
import type { AgentSlotState, SwarmSession } from '../../../types/electron';

export const SwarmArenaView: React.FC = () => {
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
        alert(`Ошибка при слиянии решения победителя: ${res.error}`);
      }
    } finally {
      setIsMergingWinner(null);
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
        Выберите проект для работы с мульти-агентным роем.
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
                Swarm Arena & Multi-Agent Fleet
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
                    ? 'Выполняется'
                    : currentSwarm.status === 'completed'
                    ? 'Завершено'
                    : currentSwarm.status}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Параллельная генерация в Git Worktrees, соревновательный Side-by-Side смотр и выбор победителя
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
                  Запуск #{projectSwarms.length - idx}: {s.mode === 'fan_out' ? 'Арена' : 'Конвейер'} (
                  {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
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
              Остановить рой
            </button>
          )}

          <button
            onClick={() => openNewSwarmModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Новый запуск
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
              Нет активных состязаний роя
            </h2>
            <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
              Запустите несколько разнородных агентов (Claude Code CLI, OpenAI Codex, DeepSeek, Ollama)
              параллельно над одной задачей в изолированных Git Worktrees и выберите лучшее решение в один клик.
            </p>
            <button
              onClick={() => openNewSwarmModal()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              Запустить состязание в Swarm Arena
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
                Базовая ветка: <span className="font-mono text-foreground font-semibold">{currentSwarm.baseBranch}</span>
              </div>
            </div>

            {/* Handoff Stepper (если режим конвейера) */}
            {currentSwarm.mode === 'handoff' && currentSwarm.handoffStages && (
              <div className="p-4 rounded-xl border border-border/70 bg-card/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Этапы конвейера (Handoff Pipeline)
                  </span>
                  <span className="text-xs text-primary font-medium">
                    Этап {(currentSwarm.currentHandoffStageIndex ?? 0) + 1} из {currentSwarm.handoffStages.length}
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
                              {(stage.durationMs / 1000).toFixed(1)} с
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
                  Претенденты состязания ({currentSwarm.agents.length})
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
                                <Trophy className="w-3 h-3 text-amber-400" /> ПОБЕДИТЕЛЬ
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
                            title="Слить решение этого агента в основную ветку и закрыть остальные"
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-30 transition-all shadow-xs shrink-0"
                          >
                            <Trophy className="w-3 h-3" />
                            {isMergingWinner === agent.id ? 'Слияние...' : 'Выбрать (Pick)'}
                          </button>
                        )}
                      </div>

                      {/* Worktree & Metrics Bar */}
                      <div className="px-4 py-2 bg-secondary/20 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground truncate">
                          <GitFork className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="font-mono text-[10px] truncate" title={agent.worktreeBranch}>
                            {agent.worktreeBranch || 'main'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-muted-foreground">
                          {agent.metrics.durationMs ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {(agent.metrics.durationMs / 1000).toFixed(1)} с
                            </span>
                          ) : null}

                          {agent.metrics.tokensEstimated ? (
                            <span title="Примерное число токенов">
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
                          <FileText className="w-3.5 h-3.5" /> Вывод
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'logs')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'logs'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Terminal className="w-3.5 h-3.5" /> Логи ({agent.logs.length})
                        </button>
                        <button
                          onClick={() => setAgentTab(agent.id, 'diff')}
                          className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                            currentTab === 'diff'
                              ? 'border-primary text-primary'
                              : 'border-transparent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" /> Дифф ({agent.diffSummary?.filesChanged || 0})
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
                                    Генерация решения...
                                  </div>
                                ) : (
                                  'Ожидание старта'
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
                                  line.includes('Error') || line.includes('Ошибка')
                                    ? 'text-rose-400'
                                    : line.includes('готово') || line.includes('успешно')
                                    ? 'text-emerald-400'
                                    : ''
                                }`}
                              >
                                {line}
                              </div>
                            ))}
                            {agent.logs.length === 0 && (
                              <div className="text-center text-muted-foreground py-8">
                                Нет записей логов
                              </div>
                            )}
                          </div>
                        )}

                        {currentTab === 'diff' && (
                          <div className="font-mono text-[11px] h-full overflow-y-auto select-text">
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
                                Изменений в рабочей ветке нет
                              </div>
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

      {/* New Swarm Modal */}
      <NewSwarmModal />
    </div>
  );
};
