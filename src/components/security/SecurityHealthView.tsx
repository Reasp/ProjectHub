import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, ListPlus, Loader2, Play, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useToast } from '../../hooks/useTimeoutState';
import type { AuditFinding, AuditSeverity, EcosystemReport, SecurityReport, SecuritySettings } from '../../types/electron';
import { formatDateTime, SEVERITY_ORDER, severityClass } from '../../utils/securityFormat';

/**
 * Вкладка проекта «Безопасность» (TASK-73.2, decision-56 п. 2): отчёт аудита зависимостей из кэша, запуск аудита
 * кнопкой (единственное место, кроме Automations, где уходит запрос в registry), задача Backlog из находки.
 */
export const SecurityHealthView: React.FC = () => {
  const { t, language } = useTranslation();
  const s = t.security;
  const selectedProject = useProjectStore((st) => st.selectedProject);
  const projectPath = selectedProject?.path ?? '';
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [errorMsg, showError] = useToast<string>(6000);
  const [successMsg, showSuccess] = useToast<string>(4000);

  const reload = useCallback(async () => {
    if (!projectPath || !window.api?.getSecurityReport) return;
    const res = await window.api.getSecurityReport(projectPath);
    setReport(res.report);
    setRunning(res.running);
    if (!res.ok && res.error) showError(res.error);
  }, [projectPath, showError]);

  useEffect(() => {
    void reload();
    void window.api?.getSecuritySettings?.().then(setSettings);
    if (!window.api?.onSecurityReportUpdated) return;
    return window.api.onSecurityReportUpdated((p) => {
      if (p === projectPath) void reload();
    });
  }, [projectPath, reload]);

  const runAudit = async () => {
    setRunning(true);
    const res = await window.api.runSecurityAudit(projectPath);
    setRunning(false);
    if (res.ok) {
      setReport(res.report);
      showSuccess(s.auditDone.replace('{n}', String(res.newFindings)));
    } else {
      showError(res.error);
    }
  };

  const createTask = async (finding: AuditFinding) => {
    const key = `${finding.ecosystem}:${finding.package}`;
    setCreating(key);
    const res = await window.api.createSecurityTask(projectPath, finding.ecosystem, finding.package);
    setCreating(null);
    if (res.ok) {
      showSuccess((res.existed ? s.taskExists : s.taskCreated).replace('{id}', res.taskId));
      void reload();
    } else {
      showError(res.error);
    }
  };

  const toggleLookups = async () => {
    if (!settings) return;
    setSettings(await window.api.saveSecuritySettings({ registryLookups: !settings.registryLookups }));
  };

  if (!selectedProject) return null;

  const total = report ? SEVERITY_ORDER.reduce((acc, sev) => acc + (report.counts[sev] ?? 0), 0) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1017]">
      <div className="px-6 py-4 border-b border-slate-800/80 flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            {total > 0 ? <ShieldAlert className="w-4 h-4 text-amber-400" /> : <ShieldCheck className="w-4 h-4 text-emerald-400" />}
            {s.title}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {report?.ranAt ? s.lastRun.replace('{at}', formatDateTime(report.ranAt, language)) : s.neverRun}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">{s.networkNote}</p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={() => void runAudit()}
            disabled={running}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? s.running : s.runAudit}
          </button>
          {settings && (
            <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none" title={s.registryLookupsHint}>
              <input type="checkbox" checked={settings.registryLookups} onChange={() => void toggleLookups()} className="accent-indigo-500" />
              {s.registryLookups}
            </label>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-950/70 border border-rose-700/60 text-rose-300 text-xs shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 text-xs shrink-0">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-4">
        {report && (
          <div className="flex flex-wrap gap-2" data-testid="security-counts">
            {SEVERITY_ORDER.map((sev) => (
              <span key={sev} className={`px-2.5 py-1 rounded-md border text-xs font-medium ${severityClass(sev, report.counts[sev] > 0)}`}>
                {s.severity[sev]}: {report.counts[sev] ?? 0}
              </span>
            ))}
          </div>
        )}

        {!report && !running && (
          <div className="text-center py-16 text-slate-500 text-xs">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-slate-600" />
            {s.emptyHint}
          </div>
        )}

        {report && report.ecosystems.length === 0 && <div className="text-xs text-slate-500">{s.noManifests}</div>}

        {report?.ecosystems.map((eco) => (
          <EcosystemSection
            key={`${eco.ecosystem}:${eco.manifest ?? ''}`}
            eco={eco}
            tasks={report.tasks}
            creating={creating}
            onCreateTask={(f) => void createTask(f)}
          />
        ))}
      </div>
    </div>
  );
};

const EcosystemSection: React.FC<{
  eco: EcosystemReport;
  tasks: Record<string, string>;
  creating: string | null;
  onCreateTask: (finding: AuditFinding) => void;
}> = ({ eco, tasks, creating, onCreateTask }) => {
  const { t, language } = useTranslation();
  const s = t.security;
  const statusText =
    eco.status === 'done'
      ? eco.findings.length
        ? s.status.vulnerable.replace('{n}', String(eco.findings.length))
        : s.status.clean
      : s.status[eco.status];
  const statusTone =
    eco.status === 'done' ? (eco.findings.length ? 'text-amber-300' : 'text-emerald-300') : eco.status === 'error' ? 'text-rose-300' : 'text-slate-400';

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <header className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-slate-200">
          {eco.ecosystem}
          {eco.manifest ? <span className="text-slate-500 font-normal"> · {eco.manifest}</span> : null}
          {typeof eco.dependencyCount === 'number' ? (
            <span className="text-slate-500 font-normal"> · {s.dependencies.replace('{n}', String(eco.dependencyCount))}</span>
          ) : null}
        </div>
        <div className={`text-xs ${statusTone}`}>{statusText}</div>
      </header>
      {(eco.message || eco.stale) && (
        <div className="px-4 py-2 text-[11px] text-slate-400 flex items-start gap-2 border-b border-slate-800/60">
          {eco.stale ? <WifiOff className="w-3.5 h-3.5 mt-px text-amber-400 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />}
          <span>
            {eco.stale && eco.staleSince ? `${s.stale.replace('{at}', formatDateTime(eco.staleSince, language))} ` : ''}
            {eco.message}
          </span>
        </div>
      )}
      {eco.findings.length > 0 && (
        <ul className="divide-y divide-slate-800/60">
          {eco.findings.map((f) => {
            const key = `${f.ecosystem}:${f.package}`;
            const taskId = tasks[key];
            return (
              <li key={key} className="px-4 py-3 text-xs" data-testid="security-finding">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase ${severityClass(f.severity as AuditSeverity, true)}`}>
                        {s.severity[f.severity]}
                      </span>
                      <span className="font-mono text-slate-100">{f.package}</span>
                      {f.version && <span className="text-slate-500 font-mono">{f.version}</span>}
                      <span className="text-slate-500">{f.direct === false ? s.transitive : s.direct}</span>
                      {f.via?.length ? <span className="text-slate-500">{s.via.replace('{list}', f.via.join(', '))}</span> : null}
                    </div>
                    <div className="mt-1 text-slate-400">
                      {f.range ? <span className="font-mono">{f.range}</span> : null}
                      {f.range ? ' · ' : ''}
                      {f.fix?.available
                        ? s.fix.replace('{v}', `${f.fix.name && f.fix.name !== f.package ? `${f.fix.name} ` : ''}${f.fix.version ?? ''}`.trim()) +
                          (f.fix.major ? ` ${s.fixMajor}` : '')
                        : s.noFix}
                    </div>
                    {f.advisories.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {f.advisories.slice(0, 6).map((a) => (
                          <li key={a.id} className="flex items-center gap-1.5 text-slate-300">
                            {a.url ? (
                              <button
                                onClick={() => void window.api.openExternal(a.url!)}
                                className="font-mono text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
                              >
                                {a.id}
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            ) : (
                              <span className="font-mono">{a.id}</span>
                            )}
                            <span className="truncate">{a.title}</span>
                          </li>
                        ))}
                        {f.advisories.length > 6 && <li className="text-slate-500">{s.moreAdvisories.replace('{n}', String(f.advisories.length - 6))}</li>}
                      </ul>
                    )}
                  </div>
                  <button
                    onClick={() => onCreateTask(f)}
                    disabled={creating === key}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 hover:border-indigo-500 text-slate-300 hover:text-white disabled:opacity-50"
                  >
                    {creating === key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
                    {taskId ? taskId : s.createTask}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
