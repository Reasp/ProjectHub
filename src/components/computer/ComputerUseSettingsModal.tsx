import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Camera, Monitor, OctagonX, Plus, Power, ShieldAlert, Trash2, Unlock, X } from 'lucide-react';
import type {
  ComputerPolicySettings,
  ComputerUseDiagnostics,
  ComputerUseSettings,
  ComputerUseStatus
} from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface ComputerUseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Настройки управления компьютером агентами (TASK-82): включение, allowlist приложений и окон,
 * режимы, kill-switch, диагностика рантайма и тестовый скриншот. Модалка первого уровня — через
 * portal и `z-[9999]` (decision-17).
 */
export const ComputerUseSettingsModal: React.FC<ComputerUseSettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ComputerUseSettings | null>(null);
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [newApp, setNewApp] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [hotkeyDraft, setHotkeyDraft] = useState('');
  const [diagnostics, setDiagnostics] = useState<ComputerUseDiagnostics | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [screenshot, setScreenshot] = useState<{ dataUrl?: string; text?: string; error?: string } | null>(null);
  const [isShooting, setIsShooting] = useState(false);

  useEffect(() => {
    if (!isOpen || !window.api?.getComputerUseSettings) return;
    let alive = true;
    window.api.getComputerUseSettings().then((s) => {
      if (!alive) return;
      setSettings(s);
      setHotkeyDraft(s.killSwitchHotkey);
    });
    window.api.getComputerUseStatus().then((s) => alive && setStatus(s));
    const unsubscribe = window.api.onComputerUseStatusChanged?.((s) => setStatus(s));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const save = async (patch: Partial<ComputerUseSettings>) => {
    const next = await window.api.saveComputerUseSettings(patch);
    setSettings(next);
    setHotkeyDraft(next.killSwitchHotkey);
  };
  const savePolicy = (patch: Partial<ComputerPolicySettings>) => {
    if (settings) void save({ policy: { ...settings.policy, ...patch } });
  };

  const addAllowlistEntry = () => {
    if (!settings) return;
    const app = newApp.trim();
    const title = newTitle.trim();
    if (!app && !title) return;
    savePolicy({ allowlist: [...settings.policy.allowlist, { ...(app ? { app } : {}), ...(title ? { title } : {}) }] });
    setNewApp('');
    setNewTitle('');
  };

  const runDiagnostics = async () => {
    setIsDiagnosing(true);
    try {
      setDiagnostics(await window.api.runComputerUseDiagnostics());
    } finally {
      setIsDiagnosing(false);
    }
  };

  const takeScreenshot = async () => {
    setIsShooting(true);
    try {
      setScreenshot(await window.api.takeComputerTestScreenshot());
    } finally {
      setIsShooting(false);
    }
  };

  const runtimeState = status?.runtimeState ?? 'stopped';
  const runtimeColor =
    runtimeState === 'ready' ? 'text-emerald-300' : runtimeState === 'error' ? 'text-rose-300' : runtimeState === 'starting' ? 'text-amber-300' : 'text-slate-400';
  const summary = diagnostics?.runtime?.summary;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 font-sans">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-500/20 text-orange-300">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t.computerUse.title}</h3>
              <p className="text-[11px] text-slate-400">{t.computerUse.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {status?.killSwitch.engaged && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-200 text-xs">
            <span className="flex items-center gap-2">
              <OctagonX className="w-4 h-4 shrink-0" />
              {t.computerUse.killSwitchEngaged.replace('{reason}', status.killSwitch.reason ? t.computerUse.reason[status.killSwitch.reason] : '?')}
            </span>
            <button
              type="button"
              onClick={() => window.api.releaseComputerKillSwitch().then(setStatus)}
              className="px-3 py-1.5 rounded-lg bg-rose-600/30 border border-rose-500/40 hover:bg-rose-600/50 font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Unlock className="w-3.5 h-3.5" />
              {t.computerUse.release}
            </button>
          </div>
        )}

        {settings && (
          <>
            <label className="flex items-start gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-orange-500"
                checked={settings.enabled}
                onChange={(e) => void save({ enabled: e.target.checked })}
              />
              <span className="space-y-1">
                <span className="block text-xs font-semibold text-slate-100">{t.computerUse.enabled}</span>
                <span className="block text-[11px] text-slate-400 leading-relaxed">{t.computerUse.enabledDesc}</span>
              </span>
            </label>

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div className="space-y-0.5 min-w-0">
                <div className="font-semibold text-slate-200">
                  {t.computerUse.runtime}: <span className={runtimeColor}>{t.computerUse.runtimeState[runtimeState]}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-500 truncate">{status?.runtimePackage}</div>
                {status?.tools && (
                  <div className="text-[11px] text-slate-400">
                    {t.computerUse.toolsCount.replace('{exported}', String(status.tools.exported)).replace('{hidden}', String(status.tools.hidden))}
                  </div>
                )}
                {status?.tools && status.tools.unknown.length > 0 && (
                  <div className="text-[11px] text-amber-300">{t.computerUse.unknownTools.replace('{list}', status.tools.unknown.join(', '))}</div>
                )}
                {status?.runtimeError && (
                  <div className="text-[11px] text-rose-300 break-words">{t.computerUse.runtimeUnavailable.replace('{error}', status.runtimeError)}</div>
                )}
              </div>
              {settings.enabled && runtimeState !== 'ready' && runtimeState !== 'starting' && (
                <button
                  type="button"
                  onClick={() => window.api.startComputerUseRuntime().then(setStatus)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 shrink-0"
                >
                  <Power className="w-3.5 h-3.5" />
                  {t.computerUse.startRuntime}
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-200">{t.computerUse.allowlistTitle}</div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{t.computerUse.allowlistDesc}</p>
              {settings.policy.allowlist.length === 0 ? (
                <div className="text-[11px] text-slate-500 italic">{t.computerUse.allowlistEmpty}</div>
              ) : (
                <ul className="space-y-1">
                  {settings.policy.allowlist.map((entry, idx) => (
                    <li key={`${entry.app ?? ''}|${entry.title ?? ''}|${idx}`} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                      <span className="font-mono text-emerald-300">{entry.app || '*'}</span>
                      {entry.title && <span className="text-slate-400 truncate">«{entry.title}»</span>}
                      <button
                        type="button"
                        title={t.computerUse.remove}
                        onClick={() => savePolicy({ allowlist: settings.policy.allowlist.filter((_, i) => i !== idx) })}
                        className="ml-auto p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={newApp}
                  onChange={(e) => setNewApp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAllowlistEntry()}
                  placeholder={t.computerUse.appPlaceholder}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-orange-500"
                />
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addAllowlistEntry()}
                  placeholder={t.computerUse.titlePlaceholder}
                  className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={addAllowlistEntry}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t.computerUse.add}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-200">{t.computerUse.outsideTitle}</div>
                <select
                  value={settings.policy.outsideAllowlist}
                  onChange={(e) => savePolicy({ outsideAllowlist: e.target.value === 'deny' ? 'deny' : 'ask' })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs"
                >
                  <option value="ask">{t.computerUse.outsideAsk}</option>
                  <option value="deny">{t.computerUse.outsideDeny}</option>
                </select>
              </div>
              <label className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-orange-500"
                  checked={settings.policy.onlyAllowlistedWindows}
                  onChange={(e) => savePolicy({ onlyAllowlistedWindows: e.target.checked })}
                />
                <span className="space-y-1">
                  <span className="block font-semibold text-slate-200">{t.computerUse.onlyWindows}</span>
                  <span className="block text-[11px] text-slate-400">{t.computerUse.onlyWindowsDesc}</span>
                </span>
              </label>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-300" />
                  {t.computerUse.killSwitchTitle}
                </span>
                {!status?.killSwitch.engaged && settings.enabled && (
                  <button
                    type="button"
                    onClick={() => window.api.engageComputerKillSwitch('manual').then(setStatus)}
                    className="px-3 py-1 rounded-lg bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30 font-semibold"
                  >
                    {t.computerUse.stop}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 shrink-0">{t.computerUse.hotkey}</span>
                <input
                  value={hotkeyDraft}
                  onChange={(e) => setHotkeyDraft(e.target.value)}
                  onBlur={() => hotkeyDraft.trim() && hotkeyDraft !== settings.killSwitchHotkey && void save({ killSwitchHotkey: hotkeyDraft.trim() })}
                  className="w-48 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 font-mono text-[11px]"
                />
                {settings.enabled && status && !status.hotkey.registered && (
                  <span className="text-[11px] text-amber-300">{t.computerUse.hotkeyNotRegistered}</span>
                )}
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-orange-500"
                  checked={settings.takeoverDetection}
                  onChange={(e) => void save({ takeoverDetection: e.target.checked })}
                />
                <span>
                  <span className="block text-slate-200">{t.computerUse.takeover}</span>
                  <span className="block text-[11px] text-slate-400">{t.computerUse.takeoverDesc.replace('{px}', String(settings.takeoverThresholdPx))}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-orange-500"
                  checked={settings.auditScreenshots}
                  onChange={(e) => void save({ auditScreenshots: e.target.checked })}
                />
                <span>
                  <span className="block text-slate-200">{t.computerUse.auditScreenshots}</span>
                  <span className="block text-[11px] text-slate-400">{t.computerUse.auditScreenshotsDesc}</span>
                </span>
              </label>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs">
              <div className="font-semibold text-slate-200">{t.computerUse.diagnostics}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={isDiagnosing}
                  onClick={runDiagnostics}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Activity className={`w-3.5 h-3.5 ${isDiagnosing ? 'animate-pulse' : ''}`} />
                  {t.computerUse.runDiagnostics}
                </button>
                <button
                  type="button"
                  disabled={isShooting || !settings.enabled}
                  onClick={takeScreenshot}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Camera className={`w-3.5 h-3.5 ${isShooting ? 'animate-pulse' : ''}`} />
                  {t.computerUse.testScreenshot}
                </button>
              </div>
              {diagnostics && (
                <div className="space-y-1">
                  {diagnostics.error && <div className="text-rose-300 break-words">{t.computerUse.runtimeUnavailable.replace('{error}', diagnostics.error)}</div>}
                  {summary && (
                    <div className={diagnostics.ok ? 'text-emerald-300' : 'text-amber-300'}>
                      {t.computerUse.diagnosticsSummary
                        .replace('{passed}', String(summary.passed))
                        .replace('{warned}', String(summary.warned))
                        .replace('{failed}', String(summary.failed))}
                    </div>
                  )}
                  {diagnostics.runtime?.checks
                    ?.filter((c) => c.status !== 'pass')
                    .map((c) => (
                      <div key={c.id} className="text-[11px] text-slate-400">
                        <span className="font-mono text-slate-300">{c.id}</span> [{c.status}] {c.summary}
                        {c.remediation ? <div className="text-slate-500">{c.remediation}</div> : null}
                      </div>
                    ))}
                </div>
              )}
              {screenshot && (
                <div className="space-y-1">
                  {screenshot.error && <div className="text-rose-300 break-words">{screenshot.error}</div>}
                  {screenshot.dataUrl && <img src={screenshot.dataUrl} alt={t.computerUse.testScreenshot} className="w-full rounded-lg border border-slate-800" />}
                  {screenshot.text && <pre className="text-[10px] text-slate-500 whitespace-pre-wrap">{screenshot.text}</pre>}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">{t.computerUse.templateHint}</p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};
