import React, { useCallback, useEffect, useState } from 'react';
import {
  Cpu,
  RefreshCw,
  Play,
  Rocket,
  FlaskConical,
  Settings,
  Square,
  RotateCcw,
  ScrollText,
  Globe,
  Server,
  Wrench
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { ActionConfigModal } from '../actions/ActionConfigModal';
import type { ManagedProcess } from '../../types/electron';

/** Как часто перечитывать список процессов, пока вкладка открыта (реестр env-tools меняется снаружи). */
const REFRESH_INTERVAL_MS = 5000;
const DEFAULT_AUTO_OPEN_DELAY_MS = 10_000;

function formatStartedAt(iso: string, language: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = d.toDateString() === new Date().toDateString();
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Вкладка Processes (аудит 6.1): таблица процессов проекта (hub + env-tools) с запуском
 * действий из .projecthub.json, остановкой, перезапуском и открытием лога в TerminalPanel.
 */
export const ProcessesView: React.FC = () => {
  const { t, language } = useTranslation();
  const {
    selectedProject,
    processes,
    fetchProcesses,
    actionConfig,
    loadActionConfig,
    runActionDefinition,
    stopProcessAction,
    restartProcessAction,
    setTerminalOpen,
    setTerminalMode,
    setActiveProcessId
  } = useProjectStore();

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busy, setBusy] = useState<Record<string, 'stop' | 'restart' | undefined>>({});
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const projectPath = selectedProject?.path;

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    setIsRefreshing(true);
    try {
      await fetchProcesses(projectPath);
    } finally {
      setIsRefreshing(false);
    }
  }, [projectPath, fetchProcesses]);

  useEffect(() => {
    if (!projectPath) return;
    void loadActionConfig(projectPath);
    void refresh();
    const timer = window.setInterval(() => void fetchProcesses(projectPath), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [projectPath, loadActionConfig, refresh, fetchProcesses]);

  if (!selectedProject) return null;

  // `processes` в сторе уже относятся к выбранному проекту (fetchProcesses/кэш по проекту).
  const projectProcesses = [...processes].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return b.startedAt.localeCompare(a.startedAt);
  });
  const runningCount = projectProcesses.filter((p) => p.status === 'running').length;

  const quickActions = actionConfig
    ? [
        { key: 'run', def: actionConfig.run, icon: Play, className: 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border-emerald-800/50' },
        { key: 'deploy', def: actionConfig.deploy, icon: Rocket, className: 'bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-300 border-indigo-800/50' },
        { key: 'test', def: actionConfig.test, icon: FlaskConical, className: 'bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 border-amber-800/50' },
        ...(actionConfig.customActions ?? []).map((def) => ({
          key: `custom:${def.id}`,
          def,
          icon: Wrench,
          className: 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/60'
        }))
      ]
    : [];

  const confirmAction = (def: { command: string }) =>
    confirm(t.actions.confirmDeploy.replace('{name}', selectedProject.name).replace('{command}', def.command));

  const handleRunAction = async (key: string, def: (typeof quickActions)[number]['def']) => {
    setStartingKey(key);
    try {
      await runActionDefinition(def, { confirm: confirmAction });
    } finally {
      setStartingKey(null);
    }
  };

  const handleOpenLog = (proc: ManagedProcess) => {
    setTerminalOpen(true);
    setTerminalMode('process_logs');
    setActiveProcessId(proc.id);
  };

  const handleStop = async (proc: ManagedProcess) => {
    setBusy((b) => ({ ...b, [proc.id]: 'stop' }));
    try {
      await stopProcessAction(proc.id);
      await fetchProcesses(selectedProject.path);
    } finally {
      setBusy((b) => ({ ...b, [proc.id]: undefined }));
    }
  };

  const handleRestart = async (proc: ManagedProcess) => {
    setBusy((b) => ({ ...b, [proc.id]: 'restart' }));
    try {
      await restartProcessAction(proc.id);
      await fetchProcesses(selectedProject.path);
    } finally {
      setBusy((b) => ({ ...b, [proc.id]: undefined }));
    }
  };

  const statusBadge = (proc: ManagedProcess) => {
    if (proc.status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t.processes.statusRunning}
        </span>
      );
    }
    if (proc.status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-950/60 border border-rose-700/50 text-rose-300 text-[11px] font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          {t.processes.statusFailed}
          {proc.exitCode !== undefined && (
            <span className="text-rose-400/70 font-mono">{t.processes.exitCode.replace('{code}', String(proc.exitCode))}</span>
          )}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-slate-400 text-[11px] font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
        {t.processes.statusStopped}
        {proc.exitCode !== undefined && proc.exitCode !== 0 && (
          <span className="text-slate-500 font-mono">{t.processes.exitCode.replace('{code}', String(proc.exitCode))}</span>
        )}
      </span>
    );
  };

  const sourceBadge = (proc: ManagedProcess) =>
    proc.source === 'hub' ? (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/50 border border-indigo-800/50 text-indigo-300 text-[10px] font-medium">
        <Cpu className="w-3 h-3" />
        {t.processes.sourceHub}
      </span>
    ) : (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-800/50 text-cyan-300 text-[10px] font-medium"
        title={t.processes.envToolsHint}
      >
        <Server className="w-3 h-3" />
        {t.processes.sourceEnvTools}
      </span>
    );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0b0e17]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/40 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            {t.processes.title}
            <span className="text-[11px] font-normal text-slate-500">
              {t.processes.runningCount.replace('{count}', String(runningCount))}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{t.processes.subtitle}</p>
        </div>
        <button
          onClick={() => void refresh()}
          title={t.processes.refresh}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Quick actions from .projecthub.json */}
      <div className="px-5 py-2.5 border-b border-slate-800/80 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mr-1">{t.processes.quickActions}</span>
        {quickActions.map(({ key, def, icon: Icon, className }) => (
          <button
            key={key}
            onClick={() => void handleRunAction(key, def)}
            disabled={startingKey !== null}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition disabled:opacity-50 ${className}`}
            title={t.actions.startProcess.replace('{name}', def.name).replace('{command}', def.command)}
          >
            {startingKey === key ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
            <span className="max-w-[160px] truncate">{def.name}</span>
          </button>
        ))}
        <button
          onClick={() => setIsConfigOpen(true)}
          title={t.processes.configure}
          className="ml-auto p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {projectProcesses.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center">
            <Cpu className="w-12 h-12 text-indigo-400/40 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">{t.processes.empty}</h3>
            <p className="text-xs text-slate-400 max-w-md">{t.processes.emptyHint}</p>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-[#0e121c] z-10">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2 font-semibold">{t.processes.colName}</th>
                <th className="px-3 py-2 font-semibold">{t.processes.colCommand}</th>
                <th className="px-3 py-2 font-semibold">{t.processes.colPid}</th>
                <th className="px-3 py-2 font-semibold">{t.processes.colStatus}</th>
                <th className="px-3 py-2 font-semibold">{t.processes.colStarted}</th>
                <th className="px-3 py-2 font-semibold">{t.processes.colSource}</th>
                <th className="px-5 py-2 font-semibold text-right">{t.processes.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {projectProcesses.map((proc) => {
                const isRunning = proc.status === 'running';
                const state = busy[proc.id];
                const autoOpenSeconds = Math.round(DEFAULT_AUTO_OPEN_DELAY_MS / 1000);
                return (
                  <tr key={proc.id} className="border-t border-slate-800/70 hover:bg-slate-900/40 transition">
                    <td className="px-5 py-2.5 align-top">
                      <div className="font-medium text-slate-200">{proc.name}</div>
                      {proc.workingDir && (
                        <div className="text-[10px] text-slate-500 font-mono truncate max-w-[220px]" title={proc.workingDir}>
                          {t.processes.workingDir.replace('{dir}', proc.workingDir)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <code className="text-slate-300 font-mono block max-w-[320px] truncate" title={proc.command}>
                        {proc.command || '—'}
                      </code>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-slate-400">{proc.pid ?? '—'}</td>
                    <td className="px-3 py-2.5 align-top">{statusBadge(proc)}</td>
                    <td className="px-3 py-2.5 align-top text-slate-400 whitespace-nowrap" title={proc.startedAt}>
                      {formatStartedAt(proc.startedAt, language)}
                    </td>
                    <td className="px-3 py-2.5 align-top">{sourceBadge(proc)}</td>
                    <td className="px-5 py-2.5 align-top">
                      <div className="flex items-center justify-end gap-1">
                        {isRunning && proc.autoOpenUrl && (
                          <button
                            onClick={() => void window.api.openExternal(proc.autoOpenUrl!)}
                            title={`${t.processes.openUrl.replace('{url}', proc.autoOpenUrl)}\n${t.processes.autoOpenHint.replace('{seconds}', String(autoOpenSeconds))}`}
                            className="p-1.5 rounded-md hover:bg-emerald-950/60 text-emerald-400 hover:text-emerald-200 transition"
                          >
                            <Globe className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenLog(proc)}
                          title={t.processes.openLog}
                          className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition"
                        >
                          <ScrollText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => void handleRestart(proc)}
                          disabled={state !== undefined || (proc.source === 'env-tools' && !proc.command)}
                          title={state === 'restart' ? t.processes.restarting : t.processes.restart}
                          className="p-1.5 rounded-md hover:bg-indigo-950/60 text-indigo-400 hover:text-indigo-200 transition disabled:opacity-40"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${state === 'restart' ? 'animate-spin' : ''}`} />
                        </button>
                        {isRunning && (
                          <button
                            onClick={() => void handleStop(proc)}
                            disabled={state !== undefined}
                            title={state === 'stop' ? t.processes.stopping : t.processes.stop}
                            className="p-1.5 rounded-md hover:bg-rose-950/60 text-rose-400 hover:text-rose-200 transition disabled:opacity-40"
                          >
                            {state === 'stop' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ActionConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        projectPath={selectedProject.path}
        initialConfig={actionConfig}
        onSaved={() => void loadActionConfig(selectedProject.path)}
      />
    </div>
  );
};
