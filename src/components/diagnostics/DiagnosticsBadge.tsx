import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, X, RefreshCw, Download, FileArchive, ExternalLink } from 'lucide-react';

import type { DiagnosticsInfo, UpdaterStatus } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

export const DiagnosticsBadge: React.FC = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null);
  const [updater, setUpdater] = useState<UpdaterStatus | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);

  useEffect(() => {
    window.api?.getUpdaterStatus?.().then(setUpdater).catch(() => {});
    const unsubscribe = window.api?.onUpdaterStatusChanged?.((status) => setUpdater(status));
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.api?.getDiagnosticsInfo?.().then(setInfo).catch(() => {});
  }, [isOpen]);

  const handleCheckUpdates = async () => {
    if (!window.api?.checkForUpdates) return;
    const status = await window.api.checkForUpdates();
    setUpdater(status);
  };

  const handleInstallNow = async () => {
    await window.api?.installUpdateNow?.();
  };

  const handleOpenRelease = async () => {
    if (updater?.releaseUrl) await window.api?.openExternal?.(updater.releaseUrl);
  };

  const handleCollectArchive = async () => {
    if (!window.api?.collectDiagnosticsArchive) return;
    setIsCollecting(true);
    setArchiveMessage(null);
    try {
      const result = await window.api.collectDiagnosticsArchive();
      if (result.canceled) {
        setArchiveMessage(null);
      } else if (result.success) {
        setArchiveMessage(t.diagnostics.archiveSaved.replace('{path}', result.path || ''));
      } else {
        setArchiveMessage(t.diagnostics.archiveError.replace('{error}', result.error || ''));
      }
    } finally {
      setIsCollecting(false);
    }
  };

  const updateLabel = (() => {
    if (!updater) return null;
    switch (updater.state) {
      case 'checking':
        return t.diagnostics.checkingUpdates;
      case 'available':
        return t.diagnostics.updateAvailable.replace('{version}', updater.latestVersion || '?');
      case 'not-available':
        return t.diagnostics.updateNotAvailable;
      case 'downloading':
        return t.diagnostics.updateDownloading.replace('{percent}', String(updater.percent ?? 0));
      case 'downloaded':
        return t.diagnostics.updateDownloaded.replace('{version}', updater.latestVersion || '?');
      case 'error':
        return t.diagnostics.updateError.replace('{error}', updater.error || '');
      default:
        return null;
    }
  })();

  const hasUpdateBadge = updater && (updater.state === 'available' || updater.state === 'downloaded');

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border ${
          hasUpdateBadge
            ? 'bg-indigo-950/40 border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/50'
            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
        }`}
        title={t.diagnostics.badgeTooltip}
      >
        <Activity className="w-3.5 h-3.5 shrink-0" />
        {hasUpdateBadge && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />}
      </button>

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 font-sans">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{t.diagnostics.modalTitle}</h3>
                    <p className="text-[11px] text-slate-400">{t.diagnostics.modalDesc}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {info && (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500">{t.diagnostics.appVersion}</div>
                    <div className="font-mono text-slate-200">{info.appVersion}</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="text-slate-500">{t.diagnostics.platform}</div>
                    <div className="font-mono text-slate-200">{info.platform} ({info.arch})</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 col-span-2">
                    <div className="text-slate-500">{t.diagnostics.userDataDir}</div>
                    <div className="font-mono text-slate-300 truncate" title={info.userDataDir}>{info.userDataDir}</div>
                  </div>
                </div>
              )}

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div className="text-[11px] text-slate-300 flex-1 pr-2">
                    {updateLabel || t.diagnostics.updateNotAvailable}
                  </div>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={updater?.state === 'checking' || updater?.state === 'downloading'}
                    className="px-3 py-1.5 rounded-lg font-medium text-xs flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 disabled:opacity-50 shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${updater?.state === 'checking' ? 'animate-spin' : ''}`} />
                    {t.diagnostics.checkUpdates}
                  </button>
                </div>

                {updater?.state === 'downloaded' && updater.supportsAutoInstall && (
                  <button
                    type="button"
                    onClick={handleInstallNow}
                    className="w-full px-3 py-1.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.diagnostics.installNow}
                  </button>
                )}

                {updater?.state === 'available' && !updater.supportsAutoInstall && updater.releaseUrl && (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={handleOpenRelease}
                      className="w-full px-3 py-1.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      {t.diagnostics.viewRelease}
                    </button>
                    <p className="text-[10px] text-slate-500 text-center">{t.diagnostics.autoInstallUnsupportedMac}</p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 text-xs">
                <button
                  type="button"
                  onClick={handleCollectArchive}
                  disabled={isCollecting}
                  className="w-full px-3 py-1.5 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60 disabled:opacity-50"
                >
                  <FileArchive className="w-3.5 h-3.5" />
                  {isCollecting ? t.diagnostics.collectingArchive : t.diagnostics.collectArchive}
                </button>
                {archiveMessage && <p className="text-[11px] text-slate-400 text-center">{archiveMessage}</p>}
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition text-xs"
                >
                  {t.common.close}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
