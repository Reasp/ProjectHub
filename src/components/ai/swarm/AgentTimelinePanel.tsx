import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, History, Play, RefreshCw, RotateCcw, ShieldCheck, Shuffle, AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import { useDialog } from '../../../hooks/useDialog';
import type { AgentSlotState, AgentTimelineView, SwarmSession, TimelineHitl } from '../../../types/electron';
import { formatTokens, formatUsd } from '../../../utils/swarmFormat';
import {
  TIMELINE_FILTER_ALL,
  checkpointPointLabel,
  checkpointsNewestFirst,
  formatChars,
  formatSpan,
  layoutTimelineScale,
  timelineTableRows,
  toolStatusClass,
  turnUsage
} from '../../../lib/agentTimelineView';
import { continueButtonText, continueDialogText } from '../../../lib/rewindContinueView';

/** Как часто перечитывать трассу, пока агент работает. */
const LIVE_REFRESH_MS = 2000;

interface Props {
  session: SwarmSession;
  agent: AgentSlotState;
}

/**
 * Вкладка «Таймлайн» карточки агента (TASK-72, decision-45): шкала запусков и ходов, таблица
 * инструментов с длительностью, статусом, размером вывода, токенами и стоимостью хода, решения HITL,
 * чекпоинты с откатом и продолжение агента. Таймлайн собирает main-процесс из файла трассы.
 */
export const AgentTimelinePanel: React.FC<Props> = ({ session, agent }) => {
  const { t } = useTranslation();
  const tt = t.agentTimeline;
  const dialog = useDialog();
  const [view, setView] = useState<AgentTimelineView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState<string>(TIMELINE_FILTER_ALL);
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    lastLoadRef.current = Date.now();
    try {
      const next = await window.api.getAgentTimeline(session.id, agent.id);
      setView(next);
    } finally {
      setLoading(false);
    }
  }, [session.id, agent.id]);

  const running = agent.status === 'running' || agent.status === 'preparing' || agent.status === 'pending';
  const checkpointCount = agent.checkpoints?.length ?? 0;
  const rewindCount = agent.rewinds?.length ?? 0;

  // Перечитываем при смене статуса, чекпоинтов и откатов; во время работы — не чаще LIVE_REFRESH_MS.
  useEffect(() => {
    const since = Date.now() - lastLoadRef.current;
    const delay = running && since < LIVE_REFRESH_MS ? LIVE_REFRESH_MS - since : 0;
    const timer = setTimeout(() => void load(), delay);
    return () => clearTimeout(timer);
  }, [load, running, agent.status, checkpointCount, rewindCount, agent.logs.length]);

  const timeline = view?.timeline;
  const rows = useMemo(() => (timeline ? timelineTableRows(timeline, toolFilter) : []), [timeline, toolFilter]);
  const scale = useMemo(() => (timeline ? layoutTimelineScale(timeline, toolFilter) : []), [timeline, toolFilter]);

  const pointLabel = (cp: Parameters<typeof checkpointPointLabel>[0]) => checkpointPointLabel(cp, tt.checkpointKind);
  const span = (ms: number | undefined) => formatSpan(ms, tt.units);
  const runStatusLabel = (status: string) => (tt.runStatusLabels as Record<string, string>)[status] ?? status;

  const handleRewind = async (n: number) => {
    const cp = view?.checkpoints.find((c) => c.n === n);
    if (!cp || !view) return;
    if (!view.rewind.allowed) {
      await dialog.alert(tt.rewindUnavailable.replace('{reason}', view.rewind.reason ?? ''));
      return;
    }
    const ok = await dialog.confirm({
      title: tt.rewindConfirmTitle,
      message: tt.rewindConfirmMessage
        .replace('{agent}', agent.config.name)
        .replace('{n}', String(cp.n))
        .replace('{point}', pointLabel(cp)),
      confirmText: tt.rewindConfirmOk,
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.api.rewindAgent(session.id, agent.id, cp.n);
      if (res.success) {
        setNotice(
          tt.rewindDone
            .replace('{n}', String(cp.n))
            .replace('{removed}', String(res.removedFiles ?? 0))
            .replace('{pre}', res.preRewindCheckpoint !== undefined ? String(res.preRewindCheckpoint) : '—')
        );
      } else {
        await dialog.alert(tt.rewindError.replace('{error}', res.error ?? ''));
      }
    } finally {
      setBusy(false);
      void load();
    }
  };

  const handleContinue = async () => {
    if (!view) return;
    // Режим продолжения — по сессии (decision-48): агент fan-out, новая итерация цикла или перезапуск этапов.
    const text = continueDialogText(view.continueAgent.mode, session, view.continueAgent.fromStage, tt);
    const instruction = await dialog.prompt({
      title: text.title,
      message: text.message,
      placeholder: tt.continuePromptPlaceholder,
      confirmText: tt.continueConfirmOk
    });
    if (instruction === null) return;
    setBusy(true);
    try {
      const res = await window.api.continueAgent(session.id, agent.id, instruction || undefined);
      if (!res.success) await dialog.alert(tt.continueError.replace('{error}', res.error ?? ''));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const handleExport = async () => {
    const res = await window.api.exportAgentTrace(session.id, agent.id);
    if (res.success && res.path) setNotice(tt.exportTraceDone.replace('{path}', res.path));
    else if (!res.canceled) await dialog.alert(tt.exportTraceError.replace('{error}', res.error ?? ''));
  };

  const hitlBadge = (h: TimelineHitl, i: number) => (
    <span
      key={`${h.requestId}-${i}`}
      className={`inline-flex items-center gap-0.5 px-1 rounded border text-[9px] ${
        h.decision === 'allow'
          ? 'border-emerald-500/40 text-emerald-300'
          : h.decision === 'deny' || h.decision === 'expired'
            ? 'border-rose-500/40 text-rose-300'
            : 'border-border text-muted-foreground'
      }`}
      title={[h.title, h.rule, h.decidedBy].filter(Boolean).join(' · ')}
    >
      <ShieldCheck className="w-2.5 h-2.5" />
      {tt.hitlDecision[h.decision]}
      {h.decidedBy ? ` (${h.decidedBy})` : ''}
    </span>
  );

  if (loading && !view) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">{tt.loading}</div>;
  }

  return (
    <div className="flex flex-col gap-3 text-[11px]" data-testid="agent-timeline">
      {/* Сводка и действия */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground" data-testid="agent-timeline-summary">
          {timeline && timeline.totals.runs > 0
            ? tt.summary
                .replace('{runs}', String(timeline.totals.runs))
                .replace('{turns}', String(timeline.totals.turns))
                .replace('{tools}', String(timeline.totals.tools))
                .replace('{errors}', String(timeline.totals.toolErrors))
                .replace('{duration}', span(timeline.totals.durationMs))
                .replace('{toolTime}', span(timeline.totals.toolTimeMs))
            : tt.empty}
          {timeline && typeof timeline.totals.costUsd === 'number' && (
            <span className="ml-1 text-foreground" title={timeline.totals.costPartial ? tt.costPartialHint : undefined}>
              {' · '}
              {tt.summaryCost.replace('{cost}', `${timeline.totals.costPartial ? '~' : ''}${formatUsd(timeline.totals.costUsd)}`)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void load()}
            title={tt.refresh}
            className="p-1 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary"
            data-testid="agent-timeline-export"
          >
            <Download className="w-3 h-3" /> {tt.exportTrace}
          </button>
          {view?.continueAgent.allowed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleContinue()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
              data-testid="agent-continue"
            >
              <Play className="w-3 h-3" /> {continueButtonText(view.continueAgent.mode, view.continueAgent.fromStage, tt)}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">{notice}</div>}
      {view?.pendingRewindNote && <div className="text-amber-300/90">{tt.continuePending}</div>}
      {timeline?.truncated && (
        <div className="flex items-center gap-1 text-amber-400/90 italic">
          <AlertTriangle className="w-3 h-3" /> {tt.truncatedNote}
        </div>
      )}

      {timeline && timeline.tools.length > 0 && (
        <label className="flex items-center gap-2 text-muted-foreground">
          {tt.filterLabel}
          <select
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            className="bg-background border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground"
            data-testid="agent-timeline-filter"
          >
            <option value={TIMELINE_FILTER_ALL}>{tt.filterAll}</option>
            {timeline.toolNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Горизонтальная шкала: ходы — фон, инструменты — цветом статуса */}
      {timeline &&
        scale.map((row) => {
          const run = timeline.runs.find((r) => r.run === row.run);
          return (
            <div key={row.run} className="space-y-0.5" data-testid="agent-timeline-scale-row">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-semibold text-foreground">{tt.runLabel.replace('{run}', String(row.run))}</span>
                {run?.iteration !== undefined && <span>{tt.iterationLabel.replace('{n}', String(run.iteration))}</span>}
                {run?.afterRewind && <span className="text-amber-300">{tt.runAfterRewind}</span>}
                {run?.model && <span className="font-mono">{run.model}</span>}
                <span>{span(run?.durationMs)}</span>
                {run?.status && <span>{tt.runStatus.replace('{status}', runStatusLabel(run.status))}</span>}
              </div>
              <div className="relative h-5 rounded bg-secondary/40 border border-border/50 overflow-hidden">
                {row.segments.map((seg) => (
                  <div
                    key={seg.key}
                    className={
                      seg.kind === 'turn'
                        ? `absolute top-0 h-full border-l border-primary/40 text-[9px] leading-5 pl-0.5 text-primary/70 overflow-hidden ${
                            seg.odd ? 'bg-primary/5' : 'bg-primary/15'
                          }`
                        : `absolute top-1 h-3 rounded-sm border ${toolStatusClass(seg.status ?? 'ok')}`
                    }
                    style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                    title={`${seg.kind === 'turn' ? tt.turnRow.replace('{turn}', seg.label) : seg.label} · ${span(seg.durationMs)}${
                      seg.status ? ` · ${tt.toolStatus[seg.status]}` : ''
                    }`}
                  >
                    {seg.kind === 'turn' && seg.widthPct >= 4 ? seg.label : null}
                  </div>
                ))}
              </div>
              {run && run.errors.length > 0 && (
                <div className="text-rose-300/90 truncate" title={run.errors.join('\n')}>
                  {tt.errorsTitle}: {run.errors[run.errors.length - 1]}
                </div>
              )}
            </div>
          );
        })}

      {timeline && timeline.switches.length > 0 && (
        <div className="text-violet-200 space-y-0.5">
          <div className="font-semibold flex items-center gap-1">
            <Shuffle className="w-3 h-3" /> {tt.switchesTitle}
          </div>
          {timeline.switches.map((sw, i) => (
            <div key={`${sw.at}-${i}`} className="font-mono text-[10px]">
              {new Date(sw.at).toLocaleTimeString()} · {sw.from} → {sw.to} ({sw.kind}
              {sw.reason ? `/${sw.reason}` : ''}
              {sw.waitedMs ? `, ${span(sw.waitedMs)}` : ''})
            </div>
          ))}
        </div>
      )}

      {/* Таблица ходов и инструментов */}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse" data-testid="agent-timeline-table">
            <thead>
              <tr className="text-muted-foreground text-left border-b border-border/60">
                <th className="py-1 pr-2 font-medium">{tt.colTurn}</th>
                <th className="py-1 pr-2 font-medium">{tt.colTool}</th>
                <th className="py-1 pr-2 font-medium">{tt.colArgs}</th>
                <th className="py-1 pr-2 font-medium text-right">{tt.colDuration}</th>
                <th className="py-1 pr-2 font-medium">{tt.colStatus}</th>
                <th className="py-1 pr-2 font-medium text-right">{tt.colOutput}</th>
                <th className="py-1 pr-2 font-medium text-right">{tt.colTokens}</th>
                <th className="py-1 pr-2 font-medium text-right">{tt.colCost}</th>
                <th className="py-1 font-medium">{tt.colHitl}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === 'run') {
                  const run = timeline?.runs.find((r) => r.run === row.run);
                  return (
                    <tr key={row.key}>
                      <td colSpan={9} className="pt-2 pb-0.5 text-[10px] font-semibold text-primary">
                        {tt.runLabel.replace('{run}', String(row.run))}
                        {run?.afterRewind ? ` · ${tt.runAfterRewind}` : ''}
                      </td>
                    </tr>
                  );
                }
                if (row.kind === 'turn' && row.turn) {
                  const usage = timeline ? turnUsage(timeline, row.turn) : undefined;
                  const approx = usage?.partial || usage?.estimated ? '~' : '';
                  return (
                    <tr key={row.key} className="border-b border-border/30 bg-secondary/20 font-semibold">
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {tt.turnRow.replace('{turn}', String(row.turn.turn))}
                        {row.turn.checkpoint !== undefined && <span className="ml-1 text-primary font-mono">#{row.turn.checkpoint}</span>}
                      </td>
                      <td className="py-1 pr-2 font-mono text-muted-foreground" colSpan={2}>
                        {row.turn.model ?? ''}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">{span(row.turn.durationMs)}</td>
                      <td className="py-1 pr-2" />
                      <td className="py-1 pr-2" />
                      <td className="py-1 pr-2 text-right font-mono" title={usage?.partial ? tt.partialCostHint : undefined}>
                        {/* Выход в событиях Claude CLI частичный (1–4 токена) — не показываем его как число. */}
                        {usage
                          ? `${approx}${formatTokens(usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens)} / ${
                              usage.partial ? '—' : `${approx}${formatTokens(usage.outputTokens)}`
                            }`
                          : '—'}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono" title={usage?.partial ? tt.partialCostHint : undefined}>
                        {typeof usage?.costUsd === 'number' ? `${approx}${formatUsd(usage.costUsd)}` : '—'}
                      </td>
                      <td className="py-1" />
                    </tr>
                  );
                }
                const tool = row.tool;
                if (!tool) return null;
                return (
                  <tr key={row.key} className="border-b border-border/20" data-testid="agent-timeline-tool-row">
                    <td className="py-0.5 pr-2" />
                    <td className="py-0.5 pr-2 font-mono text-foreground whitespace-nowrap">{tool.name}</td>
                    <td className="py-0.5 pr-2 font-mono text-muted-foreground max-w-[180px] truncate" title={tool.input}>
                      {tool.input ?? ''}
                    </td>
                    <td className="py-0.5 pr-2 text-right font-mono">{span(tool.durationMs)}</td>
                    <td className="py-0.5 pr-2">
                      <span
                        className={`px-1 rounded border bg-transparent ${toolStatusClass(tool.status)}`}
                        title={tool.status === 'not_executed' ? tt.notExecutedHint : undefined}
                      >
                        {tt.toolStatus[tool.status]}
                      </span>
                    </td>
                    <td className="py-0.5 pr-2 text-right font-mono">{formatChars(tool.outputChars)}</td>
                    <td className="py-0.5 pr-2" />
                    <td className="py-0.5 pr-2" />
                    <td className="py-0.5 space-x-0.5">{tool.hitl.map(hitlBadge)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Чекпоинты и откат */}
      <div className="space-y-1" data-testid="agent-checkpoints">
        <div className="font-semibold flex items-center gap-1 text-foreground">
          <History className="w-3 h-3" /> {tt.checkpointsTitle}
          {view && !view.rewind.allowed && view.rewind.reason && (
            <span className="font-normal text-muted-foreground ml-1 truncate" title={view.rewind.reason}>
              — {view.rewind.reason}
            </span>
          )}
        </div>
        {view && view.checkpoints.length === 0 && (
          <div className="text-muted-foreground" title={tt.checkpointsDisabledHint}>
            {tt.checkpointsEmpty}
          </div>
        )}
        {view &&
          checkpointsNewestFirst(view.checkpoints).map((cp) => (
            <div key={cp.n} className="flex items-center justify-between gap-2 px-2 py-0.5 rounded border border-border/40 bg-secondary/10">
              <div className="min-w-0 truncate">
                <span className="font-mono text-primary">#{cp.n}</span> · {pointLabel(cp)} · {new Date(cp.at).toLocaleTimeString()}
                {cp.filesChanged !== undefined && <span className="text-muted-foreground"> · {tt.filesChanged.replace('{count}', String(cp.filesChanged))}</span>}
                <span className="text-muted-foreground font-mono"> · {cp.commit.slice(0, 7)}</span>
              </div>
              <button
                type="button"
                disabled={busy || !view.rewind.allowed}
                onClick={() => void handleRewind(cp.n)}
                title={view.rewind.allowed ? tt.rewindButton : tt.rewindUnavailable.replace('{reason}', view.rewind.reason ?? '')}
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                data-testid={`agent-rewind-${cp.n}`}
              >
                <RotateCcw className="w-3 h-3" /> {tt.rewindButton}
              </button>
            </div>
          ))}
        {view && view.rewinds.length > 0 && (
          <div className="pt-1 space-y-0.5">
            <div className="font-semibold text-foreground">{tt.rewindsTitle}</div>
            {view.rewinds.map((rw, i) => (
              <div key={`${rw.at}-${i}`} className="text-muted-foreground">
                {tt.rewindItem
                  .replace('{time}', new Date(rw.at).toLocaleTimeString())
                  .replace('{n}', String(rw.toCheckpoint))
                  .replace('{point}', pointLabel({ kind: rw.toKind, turn: rw.toTurn }))
                  .replace('{removed}', String(rw.removedFiles))}
              </div>
            ))}
          </div>
        )}
        {view && view.timeline.continuations.length > 0 && (
          <div className="pt-1 space-y-0.5" data-testid="agent-continuations">
            <div className="font-semibold text-foreground">{tt.continuationsTitle}</div>
            {view.timeline.continuations.map((c, i) => (
              <div key={`${c.at}-${i}`} className="text-muted-foreground">
                {tt.continuationItem[c.mode]
                  .replace('{time}', new Date(c.at).toLocaleTimeString())
                  .replace('{iteration}', String(c.iteration ?? ''))
                  .replace('{stage}', String((c.stage ?? 0) + 1))}
                {c.toCheckpoint !== undefined && <span className="font-mono text-primary"> · #{c.toCheckpoint}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
