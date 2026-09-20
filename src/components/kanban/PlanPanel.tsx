import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitMerge, Loader2, Network, Play, RefreshCw, SkipForward, Square, Trash2 } from 'lucide-react';
import type { PlanEventPayload, PlanNode, PlanState } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { formatPlanCost, nodeTone, planActions, planCounts, planLevels, type PlanNodeTone } from '../../lib/planGraphView';

/**
 * Панель плана подзадач в карточке задачи (TASK-80.3, decision-49).
 *
 * Граф рисуется по уровням: узлы одного уровня выполняются параллельно, следующий уровень ждёт
 * слияния предыдущего. Ни один узел не стартует без явного утверждения человеком; изменённый
 * после утверждения граф требует повторного подтверждения. Вся раскладка и доступность кнопок —
 * в чистом `planGraphView.ts`.
 */

const TONE_CLASSES: Record<PlanNodeTone, string> = {
  idle: 'border-white/10 bg-white/[0.03] text-muted-foreground',
  active: 'border-sky-700/50 bg-sky-950/40 text-sky-200',
  done: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200',
  warn: 'border-amber-700/50 bg-amber-950/40 text-amber-200',
  error: 'border-rose-700/50 bg-rose-950/40 text-rose-200',
  muted: 'border-white/10 bg-white/[0.02] text-muted-foreground/60'
};

interface PlanPanelProps {
  projectPath: string;
  taskId: string;
  taskTitle: string;
  /** Открыть сессию узла в Swarm Arena. */
  onOpenSession?: (swarmId: string) => void;
}

export const PlanPanel: React.FC<PlanPanelProps> = ({ projectPath, taskId, taskTitle, onOpenSession }) => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const loaded = await window.api.getPlanForTask(projectPath, taskId);
    setPlan(loaded);
  }, [projectPath, taskId]);

  useEffect(() => {
    void reload();
    const off = window.api.onPlanEvent((event: PlanEventPayload) => {
      if (event.type === 'plan_removed') {
        setPlan((current) => (current && current.id === event.planId ? null : current));
        return;
      }
      if (event.plan && event.plan.taskId.toLowerCase() === taskId.toLowerCase()) setPlan(event.plan);
    });
    return off;
  }, [reload, taskId]);

  const levels = useMemo(() => planLevels(plan?.nodes ?? []), [plan]);
  const counts = useMemo(() => planCounts(plan?.nodes ?? []), [plan]);
  // Хэш графа считает main-процесс; здесь достаточно факта, что план уже утверждён.
  const actions = useMemo(() => planActions(plan), [plan]);

  const run = async (fn: () => Promise<{ success: boolean; error?: string } | void>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result && 'success' in result && !result.success && result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = () =>
    run(async () => {
      const result = await window.api.generatePlan({ projectPath, taskId, taskTitle });
      if (result && 'error' in result) {
        setError(result.error);
        return;
      }
      setPlan(result);
    });

  const handleApprove = () => run(async () => (plan ? window.api.approvePlan(plan.id) : undefined));

  const handleStop = async () => {
    if (!plan) return;
    const ok = await dialog.confirm({ title: t.plan.confirmStopTitle, message: t.plan.confirmStopText, danger: true });
    if (!ok) return;
    await run(() => window.api.stopPlan(plan.id));
  };

  const handleDiscard = async () => {
    if (!plan) return;
    const ok = await dialog.confirm({ title: t.plan.confirmDiscardTitle, message: t.plan.confirmDiscardText, danger: true });
    if (!ok) return;
    await run(async () => {
      const result = await window.api.discardPlan(plan.id);
      if (result.success) setPlan(null);
      return result;
    });
  };

  const toggleSkip = (node: PlanNode) =>
    run(() => window.api.skipPlanNode(plan!.id, node.taskId, node.state !== 'skipped'));

  const resolveConflict = (node: PlanNode, action: 'retry' | 'skip' | 'stop') =>
    run(() => window.api.resolvePlanConflict(plan!.id, node.taskId, action));

  const phaseNotice = () => {
    if (!plan) return null;
    if (plan.phase === 'planning') return { tone: 'active' as const, text: t.plan.generating };
    if (plan.phase === 'awaiting_approval') return { tone: 'warn' as const, text: t.plan.awaitingApproval };
    if (actions.needsReapproval) return { tone: 'warn' as const, text: t.plan.changed };
    if (plan.phase === 'failed' && plan.reason) return { tone: 'error' as const, text: t.plan.error.replace('{error}', plan.reason) };
    if (plan.phase === 'finished' && plan.outcome) {
      const label = t.plan.outcomes[plan.outcome];
      return { tone: plan.outcome === 'success' ? ('done' as const) : ('warn' as const), text: `${t.plan.title}: ${label}` };
    }
    return null;
  };

  const notice = phaseNotice();

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Network className="w-4 h-4 text-violet-400" />
          <span>{t.plan.title}</span>
          {plan && plan.nodes.length > 0 && (
            <span className="text-[11px] font-normal text-muted-foreground">
              {t.plan.counts
                .replace('{total}', String(counts.total))
                .replace('{merged}', String(counts.merged))
                .replace('{running}', String(counts.running))
                .replace('{problem}', String(counts.problem))}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || !actions.canGenerate}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-950/60 hover:bg-violet-900/80 text-violet-300 border border-violet-700/50 text-xs font-semibold transition disabled:opacity-50"
          >
            {busy && plan?.phase === 'planning' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>{t.plan.generate}</span>
          </button>
          {plan && actions.canApprove && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 text-xs font-semibold transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{actions.needsReapproval ? t.plan.reapprove : t.plan.approve}</span>
            </button>
          )}
          {plan && actions.canStop && (
            <button
              type="button"
              onClick={handleStop}
              disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-700/50 text-xs font-semibold transition disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              <span>{t.plan.stop}</span>
            </button>
          )}
          {plan && actions.canDiscard && (
            <button
              type="button"
              onClick={handleDiscard}
              disabled={busy}
              title={t.plan.discard}
              className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/10 text-muted-foreground border border-white/10 transition disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`rounded-lg border px-2.5 py-1.5 text-xs ${TONE_CLASSES[notice.tone]}`}>{notice.text}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-700/50 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-200">
          {t.plan.error.replace('{error}', error)}
        </div>
      )}
      {plan?.architect.errors && plan.architect.errors.length > 0 && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-200">
          {t.plan.architectErrors.replace('{errors}', plan.architect.errors.join('; '))}
          {' · '}
          {t.plan.attempts.replace('{n}', String(plan.architect.attempts))}
        </div>
      )}

      {!plan && <p className="text-xs text-muted-foreground">{t.plan.empty}</p>}

      {plan && plan.summary && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{plan.summary}</p>}

      {levels.map((level, index) => (
        <div key={index} className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            <span>{t.plan.step.replace('{n}', String(index + 1))}</span>
            {level.length > 1 && <span>· {t.plan.parallel.replace('{n}', String(level.length))}</span>}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {level.map((node) => (
              <div key={node.taskId} className={`rounded-lg border px-2.5 py-2 text-xs ${TONE_CLASSES[nodeTone(node.state)]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] opacity-70">{node.taskId}</div>
                    <div className="font-medium text-foreground/90 break-words">{node.title}</div>
                  </div>
                  <span className="shrink-0 text-[10px] rounded px-1.5 py-0.5 bg-black/30">{t.plan.states[node.state]}</span>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] opacity-80">
                  {node.dependsOn.length > 0 && <span>{t.plan.dependsOn.replace('{tasks}', node.dependsOn.join(', '))}</span>}
                  {node.iterations !== undefined && <span>{t.plan.iterations.replace('{n}', String(node.iterations))}</span>}
                  {node.costUsd !== undefined && <span>{formatPlanCost(node.costUsd)}</span>}
                  {node.mergeCommit && (
                    <span className="inline-flex items-center gap-1">
                      <GitMerge className="w-3 h-3" />
                      {node.mergeCommit.slice(0, 7)}
                    </span>
                  )}
                </div>

                {node.reason && <div className="mt-1 text-[10px] opacity-80 break-words">{node.reason}</div>}

                {node.state === 'conflict' && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-semibold">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{t.plan.conflictTitle}</span>
                    </div>
                    {node.conflictFiles && node.conflictFiles.length > 0 && (
                      <div className="text-[10px] font-mono opacity-80 break-all">
                        {t.plan.conflictFiles.replace('{files}', node.conflictFiles.join(', '))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {(['retry', 'skip', 'stop'] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => resolveConflict(node, action)}
                          disabled={busy}
                          className="px-2 py-1 rounded bg-black/30 hover:bg-black/50 text-[10px] border border-white/10 transition disabled:opacity-50"
                        >
                          {action === 'retry' ? t.plan.conflictRetry : action === 'skip' ? t.plan.conflictSkip : t.plan.conflictStop}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(node.state === 'pending' || node.state === 'skipped') && (
                    <button
                      type="button"
                      onClick={() => toggleSkip(node)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/30 hover:bg-black/50 text-[10px] border border-white/10 transition disabled:opacity-50"
                    >
                      <SkipForward className="w-3 h-3" />
                      {node.state === 'skipped' ? t.plan.unskip : t.plan.skip}
                    </button>
                  )}
                  {node.swarmId && onOpenSession && (
                    <button
                      type="button"
                      onClick={() => onOpenSession(node.swarmId!)}
                      className="px-2 py-1 rounded bg-black/30 hover:bg-black/50 text-[10px] border border-white/10 transition"
                    >
                      {t.plan.openSession}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {plan && plan.nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground border-t border-white/5 pt-2">
          <span>
            {t.plan.cost}: {formatPlanCost(plan.totalCostUsd, plan.settings.budgetUsd)}
          </span>
          {plan.integrationBranch && (
            <span>
              {t.plan.integrationBranch}: <span className="font-mono text-foreground/80">{plan.integrationBranch}</span> — {t.plan.integrationHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
