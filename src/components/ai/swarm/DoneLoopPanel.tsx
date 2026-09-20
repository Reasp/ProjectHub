import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  DollarSign,
  ListChecks,
  RefreshCw,
  Repeat,
  XCircle
} from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import type { SwarmSession } from '../../../types/electron';
import { checkStatusClass, checkStatusLabel } from '../../../utils/arenaFormat';
import { formatUsd } from '../../../utils/swarmFormat';
import {
  doneLoopOutcomeLabel,
  doneLoopPhaseLabel,
  isActiveDoneLoopPhase,
  iterationStats,
  iterationTone
} from '../../../utils/doneLoopFormat';
import { currentSegmentIterations } from '../../../lib/rewindContinueView';

const TONE_CLASS: Record<ReturnType<typeof iterationTone>, string> = {
  success: 'bg-emerald-500',
  retry: 'bg-amber-500',
  failed: 'bg-rose-500',
  running: 'bg-primary animate-pulse',
  pending: 'bg-secondary'
};

/** Прогресс цикла «до готовности»: итерации, проверки, сверка критериев и итог (TASK-75). */
export const DoneLoopPanel: React.FC<{ session: SwarmSession }> = ({ session }) => {
  const { t } = useTranslation();
  // null — раскрыта последняя итерация, -1 — все свёрнуты.
  const [expanded, setExpanded] = useState<number | null>(null);
  const loop = session.doneLoop;
  if (!loop) return null;

  const d = t.doneLoop;
  const tt = t.agentTimeline;
  const max = loop.settings.maxIterations;
  // После продолжения лимит действует на отрезок (decision-48 п. 2.3): полоса и счётчик — по текущему отрезку.
  const segmentIterations = currentSegmentIterations(session);
  const segmentStart = loop.iterations.length - segmentIterations.length;
  const segmentCurrent = Math.max(loop.currentIteration - segmentStart, 0);
  const active = isActiveDoneLoopPhase(loop.phase) && session.status === 'running';
  const lastIndex = loop.iterations[loop.iterations.length - 1]?.index ?? -1;
  const openIndex = expanded ?? lastIndex;

  return (
    <div className="p-4 rounded-xl border border-border/70 bg-card/30 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{d.panelTitle}</span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
              active ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border'
            }`}
          >
            {active && <RefreshCw className="w-3 h-3 animate-spin" />}
            {doneLoopPhaseLabel(loop.phase, d)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="text-primary font-medium">
            {d.iterationProgress.replace('{current}', String(segmentCurrent)).replace('{max}', String(max))}
          </span>
          {typeof loop.totalCostUsd === 'number' && (
            <span className="flex items-center gap-0.5 font-mono">
              <DollarSign className="w-3 h-3" />
              {formatUsd(loop.totalCostUsd)}
              {loop.settings.budgetUsd ? <span> / {formatUsd(loop.settings.budgetUsd)}</span> : null}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1" aria-label={d.iterationProgress.replace('{current}', String(segmentCurrent)).replace('{max}', String(max))}>
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${TONE_CLASS[iterationTone(segmentIterations[i])]}`} />
        ))}
      </div>

      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {d.checksLabel}:{' '}
          {loop.settings.checks.length > 0 ? loop.settings.checks.map((c) => c.name).join(', ') : d.checksNone}
        </span>
        <span>{loop.settings.autoReview ? d.autoReviewOn : d.autoReviewOff}</span>
      </div>

      {loop.outcome && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
            loop.outcome === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : loop.outcome === 'stopped'
              ? 'bg-muted border-border text-muted-foreground'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          {loop.outcome === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <div className="space-y-0.5">
            <div className="font-semibold">
              {doneLoopOutcomeLabel(loop.outcome, d)}
              {loop.reason ? <span className="font-normal"> — {loop.reason}</span> : null}
            </div>
            {loop.task?.finalSummaryWritten && (
              <div>
                {(loop.task.movedToReview ? d.taskMovedToReview.replace('{status}', loop.task.reviewStatus || 'Review') : d.taskNotMoved).replace(
                  '{count}',
                  String(loop.task.criteriaChecked.length)
                )}
              </div>
            )}
            {loop.task?.error && <div>{d.taskWriteError.replace('{error}', loop.task.error)}</div>}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loop.iterations.length === 0 && <div className="text-xs text-muted-foreground">{d.noIterations}</div>}
        {loop.iterations.map((it) => {
          const stats = iterationStats(it);
          const isOpen = openIndex === it.index;
          const running = !it.finishedAt;
          return (
            <div
              key={it.index}
              className={`rounded-lg border border-border/60 bg-secondary/10 ${it.rolledBack === 'full' ? 'opacity-60' : ''}`}
              data-testid={`done-loop-iteration-${it.index}`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? -1 : it.index)}
                className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-xs text-left"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span className="font-semibold text-foreground">{d.iterationLabel.replace('{n}', String(it.index))}</span>
                {it.segment ? (
                  <span className="px-1.5 rounded border border-primary/30 text-[10px] text-primary">
                    {tt.iterationSegment.replace('{n}', String(it.segment))}
                  </span>
                ) : null}
                {it.rolledBack && (
                  <span className="px-1.5 rounded border border-amber-500/40 text-[10px] text-amber-300">{tt.iterationRolledBack[it.rolledBack]}</span>
                )}
                <span className={`inline-flex items-center gap-1 ${stats.checksFailed > 0 ? 'text-rose-400' : 'text-muted-foreground'}`}>
                  <ClipboardCheck className="w-3 h-3" />
                  {d.checksCount.replace('{passed}', String(stats.checksPassed)).replace('{total}', String(stats.checksTotal))}
                </span>
                <span
                  className={`inline-flex items-center gap-1 ${
                    stats.criteriaTotal > 0 && stats.criteriaAccepted === stats.criteriaTotal ? 'text-emerald-400' : 'text-muted-foreground'
                  }`}
                >
                  <ListChecks className="w-3 h-3" />
                  {d.criteriaCount.replace('{accepted}', String(stats.criteriaAccepted)).replace('{total}', String(stats.criteriaTotal))}
                </span>
                {typeof it.costUsd === 'number' && <span className="font-mono text-muted-foreground">{formatUsd(it.costUsd)}</span>}
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                  {running
                    ? d.decisionRunning
                    : it.decision === 'finish'
                    ? d.decisionFinish
                    : it.decision === 'retry'
                    ? d.decisionRetry
                    : d.decisionFail}
                </span>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 space-y-2.5 text-xs">
                  {it.tamperedCriteria && (
                    <div className="flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5" /> {d.tampered}
                    </div>
                  )}

                  {it.checks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {it.checks.map((c) => (
                        <span
                          key={c.id}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] ${checkStatusClass(c.status)}`}
                          title={c.outputTail ? c.outputTail.slice(-1500) : c.detail || c.command}
                        >
                          {c.name}: {checkStatusLabel(c.status, t.judge)}
                        </span>
                      ))}
                    </div>
                  )}

                  {it.reportSummary && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{d.reportSummaryLabel}</div>
                      <p className="text-foreground whitespace-pre-wrap">{it.reportSummary}</p>
                    </div>
                  )}
                  {it.reportError && <div className="text-rose-400">{d.reportMissing.replace('{error}', it.reportError)}</div>}

                  {it.criteria.length > 0 && (
                    <ul className="space-y-1.5">
                      {it.criteria.map((c) => (
                        <li key={c.index} className="flex items-start gap-2">
                          {c.accepted ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : c.reported ? (
                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          ) : (
                            <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0">
                            <div className="text-foreground">
                              #{c.index} {c.text}
                            </div>
                            {c.alreadyChecked ? (
                              <div className="text-muted-foreground">{d.criterionAlready}</div>
                            ) : c.accepted ? (
                              c.evidence && (
                                <div className="text-muted-foreground">
                                  {d.evidenceLabel}: {c.evidence}
                                </div>
                              )
                            ) : (
                              <div className="text-rose-400/90">
                                {c.reason}
                                {c.evidence ? <span className="text-muted-foreground"> — {c.evidence}</span> : null}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
