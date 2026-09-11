import React from 'react';
import { Gavel, RefreshCw, Play, Square, Settings2, Layers, Trophy, ShieldAlert, GitMerge } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import type { AgentSlotState, SwarmSession } from '../../../types/electron';
import { componentLabel, formatScore, scoreClass } from '../../../utils/arenaFormat';

/**
 * Панель автосудьи над сеткой кандидатов (TASK-61, decision-12): запуск/отмена прогона,
 * стадия, рекомендация с объяснением и разложение балла лидера по компонентам.
 * Решение о слиянии панель не принимает — только показывает, кого рекомендует судья.
 */
interface ArenaJudgePanelProps {
  session: SwarmSession;
  isRunning: boolean;
  onRun: (options?: { rerunChecks?: boolean }) => void;
  onCancel: () => void;
  onOpenSettings: () => void;
  onOpenCompose: () => void;
}

export const ArenaJudgePanel: React.FC<ArenaJudgePanelProps> = ({
  session,
  isRunning,
  onRun,
  onCancel,
  onOpenSettings,
  onOpenCompose
}) => {
  const { t } = useTranslation();
  const j = t.judge;
  const judge = session.judge;

  const statusLabel = (): string => {
    switch (judge?.status) {
      case 'running':
        return j.statusRunning;
      case 'done':
        return j.statusDone;
      case 'failed':
        return j.statusFailed;
      case 'cancelled':
        return j.statusCancelled;
      default:
        return j.statusIdle;
    }
  };

  const stageLabel = (): string | null => {
    switch (judge?.stage) {
      case 'checks':
        return j.stageChecks;
      case 'diff':
        return j.stageDiff;
      case 'review':
        return j.stageReview;
      case 'scoring':
        return j.stageScoring;
      default:
        return null;
    }
  };

  const recommended: AgentSlotState | undefined = judge?.recommendedAgentId
    ? session.agents.find((a) => a.id === judge.recommendedAgentId)
    : undefined;

  const ranked = [...session.agents]
    .filter((a) => a.score)
    .sort((a, b) => {
      const sa = a.score!;
      const sb = b.score!;
      if (sa.blocked !== sb.blocked) return sa.blocked ? 1 : -1;
      return sb.total - sa.total;
    });

  const leader = recommended ?? ranked[0];

  return (
    <div className="p-4 rounded-xl border border-border/70 bg-card/40 shadow-xs space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shrink-0">
            <Gavel className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-foreground">{j.title}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${
                  judge?.status === 'running'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                    : judge?.status === 'done'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : judge?.status === 'failed'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    : 'bg-muted text-muted-foreground border-border'
                }`}
              >
                {statusLabel()}
              </span>
              {judge?.status === 'running' && stageLabel() && (
                <span className="text-[10px] text-muted-foreground">{stageLabel()}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{j.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenCompose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors"
            title={j.composeButton}
          >
            <Layers className="w-3.5 h-3.5" /> {j.composeButton}
          </button>
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors"
            title={j.settingsButton}
          >
            <Settings2 className="w-3.5 h-3.5" /> {j.settingsButton}
          </button>
          {isRunning ? (
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors"
            >
              <Square className="w-3.5 h-3.5 fill-current" /> {j.cancelButton}
            </button>
          ) : (
            <button
              onClick={() => onRun({ rerunChecks: ranked.length > 0 })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all"
            >
              {ranked.length > 0 ? <RefreshCw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              {ranked.length > 0 ? j.rerunButton : j.runButton}
            </button>
          )}
        </div>
      </div>

      {judge?.status === 'failed' && judge.error && (
        <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs">
          {j.judgeError.replace('{error}', judge.error)}
        </div>
      )}

      {judge?.status === 'done' && !judge.recommendedAgentId && (
        <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{j.noRecommendation.replace('{reason}', judge.error || judge.autoMerge?.reason || j.noCandidates)}</span>
        </div>
      )}

      {recommended && (
        <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg text-xs flex items-center gap-2">
          <Trophy className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            {j.recommendation
              .replace('{name}', recommended.config.name)
              .replace('{reason}', `${j.scoreLabel} ${formatScore(recommended.score)}`)}
          </span>
        </div>
      )}

      {judge?.autoMerge && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <GitMerge className="w-3.5 h-3.5 shrink-0" />
          <span>
            {j.autoMergeTitle}:{' '}
            {!judge.autoMerge.enabled
              ? j.autoMergeOff
              : judge.autoMerge.merged
              ? j.autoMergeDone.replace('{reason}', judge.autoMerge.reason)
              : j.autoMergeSkipped.replace('{reason}', judge.autoMerge.reason)}
          </span>
        </div>
      )}

      {leader?.score && (
        <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {j.scoreBreakdown} — {leader.config.name}
            </span>
            <span className={`text-sm font-bold font-mono ${scoreClass(leader.score)}`}>
              {formatScore(leader.score)}
            </span>
          </div>
          <div className="space-y-1">
            {leader.score.components.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-36 shrink-0 text-muted-foreground truncate" title={componentLabel(c.key, j)}>
                  {componentLabel(c.key, j)}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${c.unknown ? 'bg-muted-foreground/40' : 'bg-primary'}`}
                    style={{ width: `${Math.round(c.normalized * 100)}%` }}
                  />
                </div>
                <span className="w-14 text-right font-mono text-muted-foreground" title={`${j.weightLabel} ${c.weight}`}>
                  {c.points.toFixed(1)}/{c.weight}
                </span>
                <span className="w-56 shrink-0 truncate text-muted-foreground/80" title={c.unknown ? j.componentUnknown : c.detail}>
                  {c.unknown ? j.componentUnknown : c.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ranked.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {ranked.map((agent, idx) => (
            <span
              key={agent.id}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border ${
                agent.score?.blocked
                  ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                  : agent.id === judge?.recommendedAgentId
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-secondary/40 text-muted-foreground border-border/60'
              }`}
              title={agent.score?.blockedReason || ''}
            >
              <span className="font-mono">#{idx + 1}</span>
              <span className="font-medium truncate max-w-[140px]">{agent.config.name}</span>
              <span className="font-mono font-bold">{formatScore(agent.score)}</span>
              {agent.score?.blocked && <span>· {j.blockedBadge}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
