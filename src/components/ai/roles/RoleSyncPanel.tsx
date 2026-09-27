import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, UploadCloud, Terminal, Copy, KeyRound, FileText, TriangleAlert } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import type { RoleExportTarget, RoleSyncFile, RoleSyncFileAction, RoleSyncOptionsInput, RoleSyncPlan, TerminalHookSettings } from '../../../types/electron';
import { hookEnvSnippets, inferSyncOptions } from './roleSyncView';

/**
 * Экспорт ролей ProjectHub в нативные субагенты Claude Code / Codex и хуки терминала (TASK-77, decision-54):
 * предпросмотр файлов со статусами, синхронизация, перезапись конфликтов и удаление устаревших файлов только
 * по явному выбору, настройки хуков и команда переменных окружения для внешнего терминала.
 */

const ACTION_STYLE: Record<RoleSyncFileAction, string> = {
  create: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  update: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  conflict: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  orphan: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  foreign: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  unchanged: 'bg-secondary text-muted-foreground border-border'
};

interface RoleSyncPanelProps {
  projectPath: string;
  /** Меняется после сохранения/удаления роли — план пересчитывается. */
  refreshKey: number;
  onDriftChange: (drift: number) => void;
}

export const RoleSyncPanel: React.FC<RoleSyncPanelProps> = ({ projectPath, refreshKey, onDriftChange }) => {
  const { t } = useTranslation();
  const s = t.roleSync;
  const [options, setOptions] = useState<RoleSyncOptionsInput | null>(null);
  const [plan, setPlan] = useState<RoleSyncPlan | null>(null);
  const [settings, setSettings] = useState<TerminalHookSettings | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState<string[]>([]);
  const [deleteOrphans, setDeleteOrphans] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [connection, setConnection] = useState<{ url: string | null; token: string; failMode: 'open' | 'closed' } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(
    async (opts: RoleSyncOptionsInput) => {
      const next = await window.api.planRoleSync(projectPath, opts);
      setPlan(next);
      onDriftChange(next.summary.drift);
    },
    [projectPath, onDriftChange]
  );

  // Опции выводятся из файлов проекта: какие движки и хуки уже синхронизированы (одинаково на любой машине).
  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    setOverwrite([]);
    setDeleteOrphans([]);
    void (async () => {
      const probe = await window.api.planRoleSync(projectPath, { targets: ['claude', 'codex'], hooks: true });
      const inferred = inferSyncOptions(probe);
      if (cancelled) return;
      setOptions(inferred);
      await refresh(inferred);
    })();
    void window.api.getTerminalHookSettings().then((v) => !cancelled && setSettings(v));
    return () => {
      cancelled = true;
    };
  }, [projectPath, refreshKey, refresh]);

  const changeOptions = (next: RoleSyncOptionsInput) => {
    setOptions(next);
    void refresh(next);
  };

  const toggleTarget = (target: RoleExportTarget) => {
    if (!options) return;
    const targets = options.targets.includes(target) ? options.targets.filter((x) => x !== target) : [...options.targets, target];
    changeOptions({ ...options, targets });
  };

  const saveSettings = async (patch: Partial<TerminalHookSettings>) => {
    if (!settings) return;
    const saved = await window.api.saveTerminalHookSettings({ ...settings, ...patch });
    setSettings(saved);
    if (options && patch.hookTimeoutSec !== undefined) void refresh(options);
  };

  const apply = async () => {
    if (!options) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.api.applyRoleSync(projectPath, options, { overwrite, deleteOrphans });
      if (!res.success) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      setPlan(res.result.plan);
      onDriftChange(res.result.plan.summary.drift);
      setOverwrite([]);
      setDeleteOrphans([]);
      setMessage({
        kind: 'ok',
        text: s.applied
          .replace('{written}', String(res.result.written.length))
          .replace('{deleted}', String(res.result.deleted.length))
          .replace('{skipped}', String(res.result.skipped.length))
      });
    } finally {
      setBusy(false);
    }
  };

  const showConnection = async () => {
    setConnection(await window.api.getTerminalHookConnection());
  };

  const rotateToken = async () => {
    await window.api.regenerateTerminalHookToken();
    setConnection(await window.api.getTerminalHookConnection());
  };

  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const selected = useMemo(() => plan?.files.find((f) => f.relPath === selectedPath) ?? null, [plan, selectedPath]);
  // Предпросмотр того, что будет записано, — только у файлов, которые синхронизация может записать.
  const previewWritten = Boolean(selected && selected.desired !== null && ['create', 'update', 'conflict'].includes(selected.action));
  const pending = plan ? plan.summary.create + plan.summary.update + overwrite.length + deleteOrphans.length : 0;
  const snippets = connection ? hookEnvSnippets(connection) : null;

  const toggleIn = (list: string[], setList: (v: string[]) => void, relPath: string) =>
    setList(list.includes(relPath) ? list.filter((p) => p !== relPath) : [...list, relPath]);

  const renderRow = (f: RoleSyncFile) => {
    const choosable = (f.action === 'conflict' && !f.error) || f.action === 'orphan';
    // Заметки экспорта относятся к содержимому, которое будет записано.
    const notes = f.action === 'create' || f.action === 'update' || f.action === 'conflict' ? f.notes : [];
    const chosen = f.action === 'conflict' ? overwrite.includes(f.relPath) : deleteOrphans.includes(f.relPath);
    return (
      <div
        key={f.relPath}
        data-sync-row={f.relPath}
        onClick={() => setSelectedPath(f.relPath)}
        className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs ${
          selectedPath === f.relPath ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary/40'
        }`}
      >
        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${ACTION_STYLE[f.action]}`}>{s.action[f.action]}</span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] truncate" title={f.relPath}>{f.relPath}</div>
          {(f.error || f.modified || notes.length > 0) && (
            <div className="text-[10px] text-muted-foreground">
              {f.error ? <span className="text-amber-400">{f.error}</span> : null}
              {f.modified && f.action === 'orphan' ? <span className="text-amber-400">{s.modifiedByHand} </span> : null}
              {notes.join('; ')}
            </div>
          )}
        </div>
        {choosable && (
          <label className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={chosen}
              onChange={() => (f.action === 'conflict' ? toggleIn(overwrite, setOverwrite, f.relPath) : toggleIn(deleteOrphans, setDeleteOrphans, f.relPath))}
            />
            {f.action === 'conflict' ? s.overwrite : s.deleteFile}
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="role-sync-panel">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <UploadCloud className="w-4 h-4 text-primary" /> {s.title}
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">{s.description}</p>
      </div>

      {options && (
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={options.targets.includes('claude')} onChange={() => toggleTarget('claude')} /> {s.targetClaude}
          </label>
          <label className="flex items-center gap-1.5" title={s.codexUnverified}>
            <input type="checkbox" checked={options.targets.includes('codex')} onChange={() => toggleTarget('codex')} /> {s.targetCodex}
            <span className="text-[10px] text-amber-400">{s.unverifiedBadge}</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={options.hooks} onChange={() => changeOptions({ ...options, hooks: !options.hooks })} /> {s.hooks}
          </label>
          <button
            type="button"
            onClick={() => options && void refresh(options)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-secondary border border-border"
          >
            <RefreshCw className="w-3 h-3" /> {s.refresh}
          </button>
        </div>
      )}

      {settings && options?.hooks && (
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3 bg-secondary/10">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1" title={s.failModeHint}>{s.failMode}</label>
            <select
              value={settings.failMode}
              onChange={(e) => void saveSettings({ failMode: e.target.value as 'open' | 'closed' })}
              className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
            >
              <option value="open">{s.failOpen}</option>
              <option value="closed">{s.failClosed}</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1" title={s.timeoutHint}>{s.timeout}</label>
            <input
              type="number"
              min={60}
              max={3600}
              step={60}
              defaultValue={settings.hookTimeoutSec}
              key={settings.hookTimeoutSec}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v !== settings.hookTimeoutSec) void saveSettings({ hookTimeoutSec: v });
              }}
              className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1" title={s.stopChecksHint}>{s.stopChecks}</label>
            <select
              value={settings.stopChecks}
              onChange={(e) => void saveSettings({ stopChecks: e.target.value as TerminalHookSettings['stopChecks'] })}
              className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
            >
              <option value="off">{s.stopOff}</option>
              <option value="notify">{s.stopNotify}</option>
              <option value="block">{s.stopBlock}</option>
            </select>
          </div>
        </div>
      )}

      {plan && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[10px]" data-testid="role-sync-summary">
            {(['create', 'update', 'conflict', 'orphan', 'foreign', 'unchanged'] as RoleSyncFileAction[])
              .filter((a) => plan.summary[a] > 0)
              .map((a) => (
                <span key={a} className={`px-1.5 py-0.5 rounded border ${ACTION_STYLE[a]}`}>
                  {s.action[a]}: {plan.summary[a]}
                </span>
              ))}
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto rounded-lg border border-border p-1.5">
            {plan.files.length === 0 ? <div className="text-xs text-muted-foreground p-2">{s.nothing}</div> : plan.files.map(renderRow)}
          </div>

          {plan.skipped.length > 0 && (
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div className="font-semibold">{s.skippedTitle}</div>
              {plan.skipped.map((sk) => (
                <div key={`${sk.target}-${sk.roleSlug}`}>
                  {sk.roleSlug} → {sk.target === 'claude' ? s.targetClaude : s.targetCodex}: {sk.reason}
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="rounded-lg border border-border bg-secondary/20">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border text-[11px] text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                <span className="font-mono">{selected.relPath}</span>
                <span>· {previewWritten ? s.previewDesired : s.previewCurrent}</span>
              </div>
              <pre className="text-[11px] font-mono p-3 max-h-64 overflow-auto whitespace-pre-wrap break-words" data-testid="role-sync-preview">
                {(previewWritten ? selected.desired : selected.current ?? selected.desired) ?? ''}
              </pre>
            </div>
          )}
        </>
      )}

      {message && (
        <div className={`text-xs flex items-center gap-1.5 ${message.kind === 'ok' ? 'text-emerald-400' : 'text-destructive'}`}>
          {message.kind === 'error' ? <TriangleAlert className="w-3.5 h-3.5" /> : null}
          {message.text}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void showConnection()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-secondary border border-border"
        >
          <Terminal className="w-3.5 h-3.5" /> {s.externalTerminal}
        </button>
        <button
          type="button"
          disabled={busy || !plan || pending === 0}
          onClick={() => void apply()}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <UploadCloud className="w-3.5 h-3.5" /> {s.apply}
        </button>
      </div>

      {connection && snippets && (
        <div className="rounded-lg border border-border p-3 space-y-2 text-[11px]">
          <p className="text-muted-foreground">{connection.url ? s.externalHint : s.serverStopped}</p>
          {(['powershell', 'bash'] as const).map((shell) => (
            <div key={shell}>
              <div className="flex items-center justify-between text-muted-foreground mb-0.5">
                <span>{shell === 'powershell' ? 'PowerShell' : 'bash / Git Bash'}</span>
                <button type="button" onClick={() => void copy(shell, snippets[shell])} className="flex items-center gap-1 hover:text-foreground">
                  <Copy className="w-3 h-3" /> {copied === shell ? s.copied : s.copy}
                </button>
              </div>
              <pre className="font-mono bg-secondary/30 rounded p-2 whitespace-pre-wrap break-all">{snippets[shell]}</pre>
            </div>
          ))}
          <button type="button" onClick={() => void rotateToken()} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <KeyRound className="w-3 h-3" /> {s.rotateToken}
          </button>
        </div>
      )}
    </div>
  );
};
