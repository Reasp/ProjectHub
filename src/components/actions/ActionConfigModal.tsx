import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings, Play, Rocket, FlaskConical, Plus, Trash2, Check, Save, Globe, Terminal, RefreshCw } from 'lucide-react';
import type { ProjectActionConfig, ActionDefinition } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

type StandardActionKind = 'run' | 'deploy' | 'test';

/** env из конфига → текст textarea (KEY=VALUE по строке). */
export function envToText(env?: Record<string, string>): string {
  if (!env) return '';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v ?? ''}`)
    .join('\n');
}

/** Текст textarea → env; пустые строки и `#`-комментарии пропускаются, без `=` — тоже. */
export function parseEnvText(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    env[key] = line.slice(eq + 1).trim();
  }
  return Object.keys(env).length ? env : undefined;
}

interface ActionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  initialConfig?: ProjectActionConfig | null;
  onSaved?: () => void;
}

export const ActionConfigModal: React.FC<ActionConfigModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  initialConfig,
  onSaved
}) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ProjectActionConfig | null>(initialConfig || null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'run' | 'deploy' | 'test' | 'custom'>('run');
  // Текст env-полей хранится отдельно от конфига: иначе строка «KEY=» терялась бы при
  // перепарсинге на каждом нажатии клавиши.
  const [envText, setEnvText] = useState<Record<StandardActionKind, string>>({ run: '', deploy: '', test: '' });

  const applyLoadedConfig = (cfg: ProjectActionConfig) => {
    setConfig(cfg);
    setEnvText({ run: envToText(cfg.run.env), deploy: envToText(cfg.deploy.env), test: envToText(cfg.test.env) });
  };

  useEffect(() => {
    if (initialConfig) {
      applyLoadedConfig(initialConfig);
    }
  }, [initialConfig]);

  useEffect(() => {
    if (isOpen && projectPath && window.api?.getActionConfig) {
      window.api.getActionConfig(projectPath).then(cfg => {
        if (cfg) applyLoadedConfig(cfg);
      });
    }
  }, [isOpen, projectPath]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (!config) {
    return createPortal(
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      >
        <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full shadow-2xl p-8 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
          <span className="text-xs text-slate-400 font-medium">{t.actions.loadingConfig}</span>
        </div>
      </div>,
      document.body
    );
  }

  const handleSave = async () => {
    if (!window.api?.saveActionConfig) return;
    setIsSaving(true);
    try {
      await window.api.saveActionConfig(projectPath, config);
      setSaveSuccess(true);
      if (onSaved) onSaved();
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1000);
    } catch (e) {
      console.error('Failed to save action config:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const updateRun = (fields: Partial<ActionDefinition>) => {
    setConfig(prev => (prev ? { ...prev, run: { ...prev.run, ...fields } } : prev));
  };

  const updateDeploy = (fields: Partial<ActionDefinition>) => {
    setConfig(prev => (prev ? { ...prev, deploy: { ...prev.deploy, ...fields } } : prev));
  };

  const updateTest = (fields: Partial<ActionDefinition>) => {
    setConfig(prev => (prev ? { ...prev, test: { ...prev.test, ...fields } } : prev));
  };

  const updateKind = (kind: StandardActionKind, fields: Partial<ActionDefinition>) => {
    setConfig(prev => (prev ? { ...prev, [kind]: { ...prev[kind], ...fields } } : prev));
  };

  /** Общие для run/deploy/test поля: рабочий каталог и переменные окружения (TASK-45). */
  const renderAdvancedFields = (kind: StandardActionKind, accent: string) => {
    const def = config[kind];
    return (
      <div className="space-y-4 pt-2 border-t border-slate-800/80">
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.cwdLabel}</label>
          <input
            value={def.cwd || ''}
            onChange={e => updateKind(kind, { cwd: e.target.value || undefined })}
            placeholder="apps/web"
            className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:${accent}`}
          />
          <p className="text-[10px] text-slate-500 mt-1">{t.actions.cwdHint}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.envLabel}</label>
          <textarea
            value={envText[kind]}
            onChange={e => {
              const text = e.target.value;
              setEnvText(prev => ({ ...prev, [kind]: text }));
              updateKind(kind, { env: parseEnvText(text) });
            }}
            placeholder={'PORT=3000\nNODE_ENV=development'}
            rows={3}
            spellCheck={false}
            className={`w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none resize-y focus:${accent}`}
          />
          <p className="text-[10px] text-slate-500 mt-1">{t.actions.envHint}</p>
        </div>
      </div>
    );
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t.actions.configModalTitle}</h2>
              <p className="text-xs text-slate-400">{t.actions.configModalDesc}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs"
          >
            ✕
          </button>
        </div>

        {/* Modal Subtabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-800 bg-slate-950/30">
          <button
            onClick={() => setActiveSubTab('run')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition ${
              activeSubTab === 'run'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>{t.actions.runDevTab}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('deploy')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition ${
              activeSubTab === 'deploy'
                ? 'border-indigo-500 text-indigo-400 bg-indigo-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{t.actions.deployTab}</span>
          </button>

          <button
            onClick={() => setActiveSubTab('test')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium border-b-2 transition ${
              activeSubTab === 'test'
                ? 'border-amber-500 text-amber-400 bg-amber-950/20'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>{t.actions.testTab}</span>
          </button>
        </div>

        {/* Modal Body Form */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeSubTab === 'run' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.actionNameLabel}</label>
                <input
                  value={config.run.name}
                  onChange={e => updateRun({ name: e.target.value })}
                  placeholder="Dev Server"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.terminalCmdLabel}</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                  <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
                  <input
                    value={config.run.command}
                    onChange={e => updateRun({ command: e.target.value })}
                    placeholder="npm run dev"
                    className="w-full bg-transparent text-xs text-emerald-300 font-mono outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.autoOpenUrlLabel}</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                  <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    value={config.run.autoOpenUrl || ''}
                    onChange={e => updateRun({ autoOpenUrl: e.target.value })}
                    placeholder="http://localhost:5173"
                    className="w-full bg-transparent text-xs text-slate-300 font-mono outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.autoOpenDelayLabel}</label>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={config.run.autoOpenDelayMs ?? ''}
                  onChange={e => {
                    const raw = e.target.value;
                    const num = raw === '' ? NaN : Number(raw);
                    updateRun({ autoOpenDelayMs: Number.isFinite(num) && num >= 0 ? num : undefined });
                  }}
                  placeholder="10000"
                  className="w-40 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">{t.actions.autoOpenDelayHint}</p>
              </div>

              {renderAdvancedFields('run', 'border-emerald-500')}
            </div>
          )}

          {activeSubTab === 'deploy' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.actionNameLabel}</label>
                <input
                  value={config.deploy.name}
                  onChange={e => updateDeploy({ name: e.target.value })}
                  placeholder="Production Deploy"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.deployCmdLabel}</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                  <Terminal className="w-4 h-4 text-indigo-400 shrink-0" />
                  <input
                    value={config.deploy.command}
                    onChange={e => updateDeploy({ command: e.target.value })}
                    placeholder="npm run build && npm run deploy"
                    className="w-full bg-transparent text-xs text-indigo-300 font-mono outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="reqConf"
                  checked={config.deploy.requiresConfirmation ?? true}
                  onChange={e => updateDeploy({ requiresConfirmation: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                />
                <label htmlFor="reqConf" className="text-xs text-slate-300 cursor-pointer select-none">
                  {t.actions.requireDeployConfirm}
                </label>
              </div>

              {renderAdvancedFields('deploy', 'border-indigo-500')}
            </div>
          )}

          {activeSubTab === 'test' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.actionNameLabel}</label>
                <input
                  value={config.test.name}
                  onChange={e => updateTest({ name: e.target.value })}
                  placeholder="Unit Tests"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">{t.actions.testCmdLabel}</label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
                  <Terminal className="w-4 h-4 text-amber-400 shrink-0" />
                  <input
                    value={config.test.command}
                    onChange={e => updateTest({ command: e.target.value })}
                    placeholder="npm test"
                    className="w-full bg-transparent text-xs text-amber-300 font-mono outline-none"
                  />
                </div>
              </div>

              {renderAdvancedFields('test', 'border-amber-500')}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          <span className="text-[11px] text-slate-500 font-mono">{t.actions.savedToConfigHint}</span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-white transition"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm"
            >
              {saveSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
              <span>{saveSuccess ? t.common.saved : t.actions.saveConfig}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
