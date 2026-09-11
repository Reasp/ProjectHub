import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, RotateCcw, Save, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import { useSwarmStore } from '../../../store/useSwarmStore';
import type { ArenaConfig, CheckDefinition, ScoreComponentKey, ScoreWeights } from '../../../types/electron';
import { componentLabel } from '../../../utils/arenaFormat';

/**
 * Настройки автосудьи проекта (TASK-61): проверки, веса компонентов балла, авто-мердж и
 * ревьюер. Пишутся в `.projecthub.json` через `arena:saveConfig`.
 *
 * Модалка рендерится через `createPortal` в `document.body` и использует `z-[9999]` — правило 19
 * infra-dev (decision-17): иначе `backdrop-filter` предков заперло бы её за интерфейсом.
 */

const WEIGHT_KEYS: ScoreComponentKey[] = ['checks', 'acceptance', 'review', 'diffSize', 'locality', 'cost', 'time'];

/** Дубликат `DEFAULT_SCORE_WEIGHTS` из main для кнопки сброса — рендерер не тянет код main. */
const DEFAULT_WEIGHTS: ScoreWeights = {
  checks: 40,
  acceptance: 25,
  review: 15,
  diffSize: 8,
  locality: 6,
  cost: 4,
  time: 2
};

interface ArenaSettingsModalProps {
  projectPath: string;
  onClose: () => void;
  onSaved?: (config: ArenaConfig) => void;
}

export const ArenaSettingsModal: React.FC<ArenaSettingsModalProps> = ({ projectPath, onClose, onSaved }) => {
  const { t } = useTranslation();
  const j = t.judge;
  const { getArenaConfigAction, saveArenaConfigAction } = useSwarmStore();

  const [config, setConfig] = useState<ArenaConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getArenaConfigAction(projectPath).then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, getArenaConfigAction]);

  const patchCheck = (index: number, patch: Partial<CheckDefinition>) => {
    setConfig((prev) =>
      prev ? { ...prev, checks: prev.checks.map((c, i) => (i === index ? { ...c, ...patch } : c)) } : prev
    );
  };

  const addCheck = () => {
    setConfig((prev) =>
      prev
        ? {
            ...prev,
            checks: [
              ...prev.checks,
              {
                id: `custom-${prev.checks.length + 1}`,
                kind: 'custom',
                name: `Check ${prev.checks.length + 1}`,
                command: '',
                timeoutMs: 600_000,
                blocking: true,
                enabled: true
              }
            ]
          }
        : prev
    );
  };

  const removeCheck = (index: number) => {
    setConfig((prev) => (prev ? { ...prev, checks: prev.checks.filter((_, i) => i !== index) } : prev));
  };

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await saveArenaConfigAction(projectPath, {
        checks: config.checks.filter((c) => c.command.trim()),
        arena: {
          weights: config.weights,
          autoMerge: config.autoMerge,
          reviewer: config.reviewer,
          maxConcurrentChecks: config.maxConcurrentChecks
        }
      });
      if (!res.success) {
        setError(j.settingsSaveError.replace('{error}', '.projecthub.json'));
        return;
      }
      if (res.config) onSaved?.(res.config);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[88vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground">{j.settingsTitle}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {!config ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-xs gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <>
              {error && (
                <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs">
                  {error}
                </div>
              )}

              {/* Проверки */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {j.settingsChecks}
                  </h4>
                  <button
                    onClick={addCheck}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> {j.settingsAddCheck}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{j.settingsChecksHint}</p>
                <div className="space-y-2">
                  {config.checks.map((check, index) => (
                    <div key={`${check.id}-${index}`} className="p-3 rounded-lg border border-border/60 bg-secondary/20 space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={check.name}
                          onChange={(e) => patchCheck(index, { name: e.target.value })}
                          placeholder={j.settingsCheckName}
                          className="w-40 text-xs rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                        />
                        <input
                          value={check.command}
                          onChange={(e) => patchCheck(index, { command: e.target.value })}
                          placeholder={j.settingsCheckCommand}
                          className="flex-1 text-xs font-mono rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                        />
                        <button
                          onClick={() => removeCheck(index)}
                          title={j.settingsRemoveCheck}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                        <label className="flex items-center gap-1.5">
                          {j.settingsCheckTimeout}
                          <input
                            type="number"
                            min={5}
                            value={Math.round((check.timeoutMs ?? 600_000) / 1000)}
                            onChange={(e) =>
                              patchCheck(index, { timeoutMs: Math.max(5, Number(e.target.value) || 600) * 1000 })
                            }
                            className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={check.blocking !== false}
                            onChange={(e) => patchCheck(index, { blocking: e.target.checked })}
                          />
                          {j.settingsCheckBlocking}
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={check.enabled !== false}
                            onChange={(e) => patchCheck(index, { enabled: e.target.checked })}
                          />
                          {j.settingsCheckEnabled}
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={check.portStrategy === 'auto'}
                            onChange={(e) => patchCheck(index, { portStrategy: e.target.checked ? 'auto' : 'fixed' })}
                          />
                          PORT auto
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {j.settingsConcurrency}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={config.maxConcurrentChecks}
                    onChange={(e) =>
                      setConfig({ ...config, maxConcurrentChecks: Math.min(8, Math.max(1, Number(e.target.value) || 1)) })
                    }
                    className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                  />
                </label>
              </section>

              {/* Веса */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {j.settingsWeights}
                  </h4>
                  <button
                    onClick={() => setConfig({ ...config, weights: { ...DEFAULT_WEIGHTS } })}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> {j.settingsResetWeights}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{j.settingsWeightsHint}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {WEIGHT_KEYS.map((key) => (
                    <label key={key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                      {componentLabel(key, j)}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={config.weights[key]}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            weights: { ...config.weights, [key]: Math.max(0, Number(e.target.value) || 0) }
                          })
                        }
                        className="rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                      />
                    </label>
                  ))}
                </div>
              </section>

              {/* Ревьюер */}
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {j.settingsReviewer}
                </h4>
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.reviewer.enabled}
                    onChange={(e) => setConfig({ ...config, reviewer: { ...config.reviewer, enabled: e.target.checked } })}
                  />
                  {j.settingsReviewerEnabled}
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    {j.settingsReviewerRole}
                    <input
                      value={config.reviewer.roleSlug}
                      onChange={(e) =>
                        setConfig({ ...config, reviewer: { ...config.reviewer, roleSlug: e.target.value } })
                      }
                      className="rounded-lg border border-border bg-background px-2 py-1 font-mono text-foreground focus:outline-hidden"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    {j.settingsReviewerModel}
                    <input
                      value={config.reviewer.model ?? ''}
                      placeholder="claude-sonnet-5"
                      onChange={(e) =>
                        setConfig({ ...config, reviewer: { ...config.reviewer, model: e.target.value || undefined } })
                      }
                      className="rounded-lg border border-border bg-background px-2 py-1 font-mono text-foreground focus:outline-hidden"
                    />
                  </label>
                </div>
              </section>

              {/* Авто-мердж */}
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {j.settingsAutoMerge}
                </h4>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{j.settingsAutoMergeHint}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.autoMerge.enabled}
                      onChange={(e) =>
                        setConfig({ ...config, autoMerge: { ...config.autoMerge, enabled: e.target.checked } })
                      }
                    />
                    {j.settingsAutoMergeEnabled}
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {j.settingsAutoMergeMinScore}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={config.autoMerge.minScore}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          autoMerge: {
                            ...config.autoMerge,
                            minScore: Math.min(100, Math.max(0, Number(e.target.value) || 0))
                          }
                        })
                      }
                      className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-foreground focus:outline-hidden"
                    />
                  </label>
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/70 transition-colors"
          >
            {j.settingsCancel}
          </button>
          <button
            onClick={handleSave}
            disabled={!config || isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all"
          >
            <Save className="w-3.5 h-3.5" /> {j.settingsSave}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
