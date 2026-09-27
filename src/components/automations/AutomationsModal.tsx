import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ExternalLink, Pause, Pencil, Play, Plus, RefreshCw, ShieldCheck, Trash2, Workflow, X } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useAutomationsStore } from '../../store/useAutomationsStore';
import { useDialogStore } from '../../store/useDialogStore';
import { AutomationRuleEditor } from './AutomationRuleEditor';
import type { AutomationLogEntry, AutomationRule, AutomationRuleView } from '../../types/electron';

/**
 * Модалка Automations (TASK-74, decision-52, модалки — decision-17): правила трёх источников с
 * вкл/выкл, подтверждением проектных правил, «запустить сейчас» и снятием паузы; журнал запусков;
 * настройки лимитов. Рендерится порталом в `document.body`, `z-[9999]`.
 */

type Tab = 'rules' | 'log' | 'settings';

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), template);
}

function baseName(p?: string): string {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  off: 'bg-slate-500/10 text-slate-400 border-slate-600/40',
  untrusted: 'bg-sky-500/10 text-sky-300 border-sky-500/40',
  changed: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  invalid: 'bg-red-500/15 text-red-300 border-red-500/40'
};

const LOG_COLORS: Record<AutomationLogEntry['status'], string> = {
  started: 'text-sky-300',
  success: 'text-emerald-300',
  failed: 'text-red-300',
  skipped: 'text-slate-400',
  suspended: 'text-amber-300',
  resumed: 'text-slate-300'
};

export const AutomationsModal: React.FC = () => {
  const { t, language } = useTranslation();
  const a = t.automations;
  const isOpen = useAutomationsStore((s) => s.isOpen);
  const close = useAutomationsStore((s) => s.close);
  const rules = useAutomationsStore((s) => s.rules);
  const settings = useAutomationsStore((s) => s.settings);
  const log = useAutomationsStore((s) => s.log);
  const focusProject = useAutomationsStore((s) => s.focusProject);
  const refresh = useAutomationsStore((s) => s.refresh);
  const refreshLog = useAutomationsStore((s) => s.refreshLog);
  const confirm = useDialogStore((s) => s.confirm);

  const [tab, setTab] = useState<Tab>('rules');
  const [editing, setEditing] = useState<{ rule?: AutomationRule } | null>(null);
  const [reviewing, setReviewing] = useState<AutomationRuleView | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<{ max: string; budget: string; runs: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const fmtTime = (ms?: number | string) => (ms === undefined ? '' : new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }));

  const groups = useMemo(() => {
    const builtin = rules.filter((r) => r.scope === 'builtin');
    const global = rules.filter((r) => r.scope === 'global');
    const byProject = new Map<string, AutomationRuleView[]>();
    for (const r of rules.filter((x) => x.scope === 'project')) {
      const key = r.projectRoot || '';
      byProject.set(key, [...(byProject.get(key) ?? []), r]);
    }
    const projectGroups = [...byProject.entries()].sort(([pa], [pb]) => (pa === focusProject ? -1 : pb === focusProject ? 1 : pa.localeCompare(pb)));
    return { builtin, global, projectGroups };
  }, [rules, focusProject]);

  if (!isOpen) return null;

  const statusOf = (r: AutomationRuleView): { key: keyof typeof a.status; text: string; hint?: string } => {
    if (r.issue) return { key: 'invalid', text: a.status.invalid, hint: r.issue };
    const paused = (r.state.pausedUntil ?? 0) > Date.now();
    if (paused) {
      return {
        key: 'paused',
        text: fill(a.status.paused, { time: fmtTime(r.state.pausedUntil) }),
        hint: r.state.pauseReason ? a.pauseReason[r.state.pauseReason] : undefined
      };
    }
    if (r.trust === 'changed') return { key: 'changed', text: a.status.changed, hint: a.changedHint };
    if (r.trust === 'untrusted') return { key: 'untrusted', text: a.status.untrusted, hint: a.untrustedHint };
    return r.active ? { key: 'active', text: a.status.active } : { key: 'off', text: a.status.off };
  };

  const describeTrigger = (r: AutomationRuleView): string => {
    if (r.scope === 'builtin') return a.triggerBuiltin;
    const trig = r.rule?.trigger;
    if (!trig) return '';
    if (trig.kind === 'cron') return fill(a.triggerCron, { expr: trig.expr });
    if (trig.kind === 'manual') return a.triggerManual;
    return fill(a.triggerEvent, { event: a.events[trig.event] });
  };

  const describeAction = (r: AutomationRuleView): string => {
    if (r.scope === 'builtin') return `${a.actions.runAgent} ${fill(a.actionRole, { role: 'agent:<role>' })}`;
    const act = r.rule?.action;
    if (!act) return '';
    switch (act.type) {
      case 'runAgent':
        return `${a.actions.runAgent} ${fill(a.actionRole, { role: act.roleSlug })}${act.mode === 'doneLoop' ? `, ${a.actionDoneLoop}` : ''}`;
      case 'runChecks':
        return `${a.actions.runChecks}${act.checkIds?.length ? `: ${act.checkIds.join(', ')}` : ''}`;
      case 'projectAction':
        return `${a.actions.projectAction}: ${fill(a.actionProject, { action: act.actionId })}`;
      case 'notify':
        return `${a.actions.notify}: ${act.title}`;
      default:
        return a.actions[act.type];
    }
  };

  const describeCounters = (r: AutomationRuleView): string => {
    const limits = r.builtinLimits ?? r.rule?.limits;
    const parts: string[] = [];
    if (limits) parts.push(fill(a.runsToday, { runs: r.state.runsToday, max: limits.maxRunsPerDay }));
    if (limits?.dailyBudgetUsd) parts.push(fill(a.spentToday, { spent: r.state.costTodayUsd.toFixed(2), limit: limits.dailyBudgetUsd.toFixed(2) }));
    if (r.state.nextRunAt && r.active) parts.push(fill(a.nextRun, { time: fmtTime(r.state.nextRunAt) }));
    if (r.state.lastRunAt) parts.push(fill(a.lastRun, { time: fmtTime(r.state.lastRunAt) }));
    return parts.join(' · ');
  };

  const afterAction = async () => {
    await refresh();
    await refreshLog();
  };

  const toggle = async (r: AutomationRuleView) => {
    if (r.scope === 'project' && !r.enabled) {
      setReviewing(r);
      return;
    }
    const res = await window.api.setAutomationEnabled(r.key, !r.enabled);
    if (!res.ok) setNotice({ kind: 'error', text: res.error });
    await afterAction();
  };

  const approve = async (r: AutomationRuleView) => {
    const res = await window.api.setAutomationEnabled(r.key, true, r.hash);
    setReviewing(null);
    if (!res.ok) setNotice({ kind: 'error', text: res.error });
    await afterAction();
  };

  const runNow = async (r: AutomationRuleView) => {
    const res = await window.api.runAutomationNow(r.key);
    setNotice(res.ok ? { kind: 'ok', text: fill(a.runStarted, { name: r.name }) } : { kind: 'error', text: fill(a.runRefused, { reason: res.reason }) });
    await afterAction();
  };

  const resume = async (r: AutomationRuleView) => {
    await window.api.resumeAutomation(r.key);
    await afterAction();
  };

  const remove = async (r: AutomationRuleView) => {
    const ok = await confirm({ title: a.delete, message: fill(a.deleteConfirm, { name: r.name }), danger: true, confirmText: a.delete });
    if (!ok) return;
    await window.api.deleteAutomationRule(r.id);
    await afterAction();
  };

  const openSwarm = (entry: AutomationLogEntry) => {
    if (!entry.swarmId) return;
    void window.api.notificationNavigate({ type: 'openSwarm', ...(entry.projectPath ? { projectPath: entry.projectPath } : {}), sessionId: entry.swarmId });
    close();
  };

  const saveSettings = async () => {
    if (!settingsDraft || !settings) return;
    const num = (v: string, fallback: number) => {
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    await window.api.updateAutomationSettings({
      maxConcurrentAgentRuns: Math.round(num(settingsDraft.max, settings.maxConcurrentAgentRuns)),
      builtinAssigned: {
        dailyBudgetUsd: num(settingsDraft.budget, settings.builtinAssigned.dailyBudgetUsd),
        maxRunsPerDay: Math.round(num(settingsDraft.runs, settings.builtinAssigned.maxRunsPerDay))
      }
    });
    setNotice({ kind: 'ok', text: a.settings.saved });
    setSettingsDraft(null);
    await refresh();
  };

  const renderRule = (r: AutomationRuleView) => {
    const status = statusOf(r);
    const paused = status.key === 'paused';
    const canRun = r.scope !== 'builtin' && !r.issue && !paused && (r.scope !== 'project' || r.trust === 'trusted');
    return (
      <div key={r.key} className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-start gap-3">
          <label className="mt-0.5 flex items-center" title={r.enabled ? a.disable : r.scope === 'project' ? a.confirmVersion : a.enable}>
            <input type="checkbox" checked={r.enabled && r.trust !== 'changed'} disabled={Boolean(r.issue)} onChange={() => void toggle(r)} />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{r.scope === 'builtin' ? a.builtinName : r.name}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_COLORS[status.key]}`} title={status.hint}>
                {status.text}
              </span>
              {r.scope !== 'builtin' && <span className="font-mono text-[10px] text-muted-foreground">{r.id}</span>}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {describeTrigger(r)} → {describeAction(r)}
              {r.scope === 'global' && r.rule?.conditions.projects?.length ? ` · ${r.rule.conditions.projects.map(baseName).join(', ')}` : ''}
            </div>
            {(status.hint || r.scope === 'builtin') && (
              <div className={`mt-1 text-[11px] ${status.key === 'invalid' ? 'text-red-300' : 'text-muted-foreground'}`}>
                {r.scope === 'builtin' ? a.builtinHint : status.hint}
              </div>
            )}
            {!r.issue && <div className="mt-1 text-[10px] text-slate-400">{describeCounters(r)}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {r.scope === 'project' && (r.trust === 'untrusted' || r.trust === 'changed') && !r.issue && (
              <button type="button" onClick={() => setReviewing(r)} title={a.confirmVersion} className="rounded-md border border-sky-500/40 p-1.5 text-sky-300 hover:bg-sky-500/10">
                <ShieldCheck className="w-3.5 h-3.5" />
              </button>
            )}
            {paused && (
              <button type="button" onClick={() => void resume(r)} title={a.resume} className="rounded-md border border-amber-500/40 p-1.5 text-amber-300 hover:bg-amber-500/10">
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {canRun && (
              <button type="button" onClick={() => void runNow(r)} title={a.runNow} className="rounded-md border border-border p-1.5 text-emerald-300 hover:bg-emerald-500/10">
                <Play className="w-3.5 h-3.5" />
              </button>
            )}
            {r.scope === 'global' && r.rule && (
              <button type="button" onClick={() => setEditing({ rule: r.rule })} title={a.edit} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {r.scope === 'global' && (
              <button type="button" onClick={() => void remove(r)} title={a.delete} className="rounded-md border border-border p-1.5 text-red-300 hover:bg-red-500/10">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {reviewing?.key === r.key && (
          <div className="mt-3 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 space-y-2">
            <div className="text-xs font-semibold text-sky-200">{a.trustTitle}</div>
            <div className="text-[11px] text-muted-foreground">{fill(a.trustMessage, { project: baseName(r.projectRoot) })}</div>
            <pre className="max-h-56 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-relaxed select-text">{JSON.stringify(r.rule, null, 2)}</pre>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReviewing(null)} className="px-3 py-1 rounded-md border border-border text-xs">
                {a.editor.cancel}
              </button>
              <button type="button" onClick={() => void approve(r)} className="px-3 py-1 rounded-md bg-sky-600 text-white text-xs">
                {a.trustConfirm}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLog = () => (
    <div className="space-y-1">
      {log.length === 0 && <div className="py-10 text-center text-xs text-muted-foreground">{a.log.empty}</div>}
      {log.map((entry, i) => (
        <div key={`${entry.ts}-${entry.runId ?? ''}-${entry.status}-${i}`} className="grid grid-cols-[120px_180px_90px_1fr] gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">{fmtTime(entry.ts)}</span>
          <span className="truncate" title={entry.ruleKey}>
            {entry.ruleName}
            {entry.projectPath ? <span className="text-muted-foreground"> · {baseName(entry.projectPath)}</span> : null}
          </span>
          <span className={`font-semibold ${LOG_COLORS[entry.status]}`}>{a.log.statuses[entry.status]}</span>
          <span className="min-w-0 text-slate-300">
            <span className="text-muted-foreground">
              {entry.trigger}
              {entry.eventSummary ? ` — ${entry.eventSummary}` : ''}
              {entry.action ? ` → ${entry.action}` : ''}
              {entry.depth ? ` · ${fill(a.log.depth, { depth: entry.depth })}` : ''}
            </span>
            {(entry.detail || entry.reason) && <span className="block whitespace-pre-wrap break-words">{entry.detail || entry.reason}</span>}
            {(entry.costUsd !== undefined || entry.durationMs !== undefined || entry.swarmId) && (
              <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
                {entry.costUsd !== undefined && <span>${entry.costUsd.toFixed(4)}</span>}
                {entry.durationMs !== undefined && <span>{(entry.durationMs / 1000).toFixed(1)} s</span>}
                {entry.swarmId && (
                  <button type="button" onClick={() => openSwarm(entry)} className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                    <ExternalLink className="w-3 h-3" />
                    {a.log.openSwarm}
                  </button>
                )}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );

  const renderSettings = () => {
    if (!settings) return null;
    const draft = settingsDraft ?? {
      max: String(settings.maxConcurrentAgentRuns),
      budget: String(settings.builtinAssigned.dailyBudgetUsd),
      runs: String(settings.builtinAssigned.maxRunsPerDay)
    };
    const field = (label: string, key: 'max' | 'budget' | 'runs', hint?: string) => (
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</label>
        <input
          className="w-48 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
          value={draft[key]}
          onChange={(e) => setSettingsDraft({ ...draft, [key]: e.target.value })}
        />
        {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    );
    return (
      <div className="space-y-4 max-w-xl">
        {field(a.settings.maxConcurrent, 'max', a.settings.maxConcurrentHint)}
        {field(a.settings.builtinBudget, 'budget')}
        {field(a.settings.builtinRuns, 'runs')}
        <button type="button" disabled={!settingsDraft} onClick={() => void saveSettings()} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50">
          {a.settings.save}
        </button>
      </div>
    );
  };

  const nothing = groups.global.length === 0 && groups.projectGroups.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl h-[88vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Workflow className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{a.title}</h2>
              <p className="text-[11px] text-muted-foreground">{a.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void afterAction()} title={a.refresh} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button type="button" onClick={close} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
          {(['rules', 'log', 'settings'] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id === 'log') void refreshLog();
              }}
              className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${tab === id ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-muted-foreground'}`}
            >
              {id === 'rules' ? a.tabRules : id === 'log' ? a.tabLog : a.tabSettings}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {notice && (
            <div className={`flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs ${notice.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`}>
              <span className="whitespace-pre-wrap">{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {tab === 'rules' && (
            <>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100/90">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300" />
                <span>{a.autonomyNote}</span>
              </div>

              {editing ? (
                <AutomationRuleEditor
                  rule={editing.rule}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    void afterAction();
                  }}
                />
              ) : (
                <button type="button" onClick={() => setEditing({})} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/50 text-primary text-xs hover:bg-primary/10">
                  <Plus className="w-3.5 h-3.5" />
                  {a.newRule}
                </button>
              )}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{a.groupBuiltin}</h3>
                {groups.builtin.map(renderRule)}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{a.groupGlobal}</h3>
                {groups.global.map(renderRule)}
                {groups.global.length === 0 && !nothing && <div className="text-[11px] text-muted-foreground">{a.emptyGlobal}</div>}
              </section>

              {groups.projectGroups.map(([root, list]) => (
                <section key={root} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" title={root}>
                    {fill(a.groupProject, { project: baseName(root) })}
                  </h3>
                  {list.map(renderRule)}
                </section>
              ))}

              {nothing && <div className="py-6 text-center text-xs text-muted-foreground">{a.empty}</div>}
            </>
          )}

          {tab === 'log' && renderLog()}
          {tab === 'settings' && renderSettings()}
        </div>
      </div>
    </div>,
    document.body
  );
};
