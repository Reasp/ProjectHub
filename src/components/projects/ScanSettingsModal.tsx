import React, { useState, useEffect } from 'react';
import {
  X,
  FolderSearch,
  Plus,
  Trash2,
  Folder,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

interface ScanSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScanSettingsModal: React.FC<ScanSettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const {
    scanRoots,
    fetchScanRoots,
    saveScanRoots,
    scanProjectsWithProgress,
    isScanning,
    projects
  } = useProjectStore();

  const [roots, setRoots] = useState<string[]>([]);
  const [scanDepth, setScanDepth] = useState<number>(2);
  const [scanResult, setScanResult] = useState<{ count: number; timestamp: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchScanRoots().then(() => {
        setRoots(useProjectStore.getState().scanRoots);
      });
      setScanResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddFolder = async () => {
    if (window.api) {
      const selected = await window.api.selectDirectory();
      if (selected && !roots.includes(selected)) {
        const updated = [...roots, selected];
        setRoots(updated);
        await saveScanRoots(updated);
      }
    }
  };

  const handleRemoveRoot = async (rootToRemove: string) => {
    const updated = roots.filter((r) => r !== rootToRemove);
    setRoots(updated);
    await saveScanRoots(updated);
  };

  const handleRunScan = async () => {
    const discovered = await scanProjectsWithProgress({ roots, depth: scanDepth });
    setScanResult({
      count: discovered.length,
      timestamp: new Date().toLocaleTimeString()
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#131622] border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#181b2a]/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <FolderSearch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t.scanSettings.title}</h2>
              <p className="text-xs text-slate-400">{t.scanSettings.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Scan roots section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-indigo-400" />
                {t.scanSettings.directories} ({roots.length})
              </label>
              <button
                onClick={handleAddFolder}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium py-1 px-2 rounded-md hover:bg-indigo-500/10 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.scanSettings.addFolder}
              </button>
            </div>

            <div className="space-y-1.5">
              {roots.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500">
                  {t.scanSettings.noDirectories}
                </div>
              ) : (
                roots.map((rootPath) => (
                  <div
                    key={rootPath}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#181b2b] border border-slate-800/80 group hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Folder className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-mono text-xs text-slate-300 truncate" title={rootPath}>
                        {rootPath}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveRoot(rootPath)}
                      className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-rose-500/10 transition opacity-60 group-hover:opacity-100"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Depth settings */}
          <div className="p-4 rounded-xl bg-[#181b2b]/60 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  {t.scanSettings.depth}
                </div>
                <p className="text-[11px] text-slate-400">
                  {t.scanSettings.depthSubtitle}
                </p>
              </div>

              <select
                value={scanDepth}
                onChange={(e) => setScanDepth(Number(e.target.value))}
                className="bg-[#121522] border border-slate-700 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value={1}>1 {t.scanSettings.depthLevel1}</option>
                <option value={2}>2 {t.scanSettings.depthLevel2}</option>
                <option value={3}>3 {t.scanSettings.depthLevel3}</option>
              </select>
            </div>
          </div>

          {/* Results summary */}
          {scanResult && (
            <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/50 flex items-center gap-2.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                {scanResult.timestamp} • {scanResult.count} {t.sidebar.projectsCount}
              </span>
            </div>
          )}

          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <code>~/.projecthub/projects.json</code>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#181b2a]/70 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {t.common.all}: <strong className="text-white">{projects.length}</strong>
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium transition"
            >
              {t.common.close}
            </button>
            <button
              onClick={handleRunScan}
              disabled={isScanning}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? t.common.loading : t.scanSettings.scanNow}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
