import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Layers, Loader2, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import type { ModelTier, ModelTierSettings, ModelTierState, TierEngine, TierModelEntry } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { ProviderProfileSelect, useLlmProfiles } from './ProviderProfileSelect';
import {
  TIERS_TOP_DOWN,
  TIER_ENGINE_OPTIONS,
  addTierEntry,
  entryAvailability,
  entryTargetChoice,
  entryTargetPatch,
  modelSuggestions,
  moveTierEntry,
  referencedProfileIds,
  removeTierEntry,
  tierDraftProblems,
  updateTierEntry,
  type TierCatalogState
} from '../../lib/modelTierEditor';

const inputClass =
  'w-full bg-[#0c0e17] border border-slate-800 rounded-md px-2 py-1 text-[11px] text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500';

const TIER_ACCENT: Record<ModelTier, string> = {
  frontier: 'border-fuchsia-500/30 text-fuchsia-300',
  balanced: 'border-sky-500/30 text-sky-300',
  cheap: 'border-emerald-500/30 text-emerald-300'
};

/** Enter в полях редактора не должен отправлять форму настроек AI Studio. */
function stopEnter(e: React.KeyboardEvent) {
  if (e.key === 'Enter') e.preventDefault();
}

/**
 * Таблица тиров моделей (TASK-79, decision-44): звенья каждого тира по порядку цепочки, движок, провайдер,
 * модель с подсказками каталога профиля и алиасов Claude CLI, подсветка модели вне каталога. Сохраняется
 * своей кнопкой отдельно от настроек AI Studio и применяется к новым ходам агентов без перезапуска.
 */
export const ModelTiersSection: React.FC = () => {
  const { t } = useTranslation();
  const l = t.modelTiers;
  const profiles = useLlmProfiles();
  const [state, setState] = useState<ModelTierState | null>(null);
  const [draft, setDraft] = useState<ModelTierSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'seed' | 'refresh' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, TierCatalogState>>({});

  useEffect(() => {
    let cancelled = false;
    window.api
      .getModelTiers()
      .then((s) => {
        if (cancelled) return;
        setState(s);
        setDraft(s.settings);
      })
      .catch((err: unknown) => !cancelled && setError(String((err as Error)?.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const profileIds = useMemo(() => (draft ? referencedProfileIds(draft, profiles) : []), [draft, profiles]);
  const profileIdsKey = profileIds.join('|');

  const loadCatalogs = useCallback(
    async (ids: string[], refresh: boolean) => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await window.api.listLlmProfileModels(id, refresh);
            return [id, { models: res.models, fetchedAt: res.fetchedAt, ...(res.error ? { error: res.error } : {}) }] as const;
          } catch (err) {
            return [id, { models: [], fetchedAt: null, error: String((err as Error)?.message ?? err) }] as const;
          }
        })
      );
      setCatalogs((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    },
    []
  );

  // Каталоги профилей из кэша main-процесса — для подсказок и подсветки; сеть только по кнопке «Обновить».
  useEffect(() => {
    const missing = profileIdsKey ? profileIdsKey.split('|').filter((id) => !catalogs[id]) : [];
    if (missing.length > 0) void loadCatalogs(missing, false);
  }, [profileIdsKey, catalogs, loadCatalogs]);

  const change = useCallback((next: ModelTierSettings) => {
    setDraft(next);
    setDirty(true);
    setNotice(null);
  }, []);

  if (!state || !draft) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs py-6 justify-center">
        {error ? <span className="text-rose-300">{error}</span> : <Loader2 className="w-4 h-4 animate-spin" />}
      </div>
    );
  }

  const problems = tierDraftProblems(draft);
  const problemAt = (tier: ModelTier, index: number) => problems.find((p) => p.tier === tier && p.index === index);

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const saved = await window.api.saveModelTiers(draft);
      setState(saved);
      setDraft(saved.settings);
      setDirty(false);
      setNotice(l.saved);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const seed = async () => {
    setBusy('seed');
    setError(null);
    try {
      const res = await window.api.seedModelTiers(draft);
      if (res.added > 0) {
        setDraft(res.settings);
        setDirty(true);
        setNotice(l.seedDone.replace('{count}', String(res.added)));
      } else {
        setNotice(l.seedNothing);
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      await loadCatalogs(profileIds, true);
    } finally {
      setBusy(null);
    }
  };

  const catalogErrors = profileIds
    .map((id) => catalogs[id]?.error)
    .filter((e): e is string => Boolean(e));

  const renderEntry = (tier: ModelTier, entry: TierModelEntry, index: number, count: number) => {
    const availability = entryAvailability(entry, profiles, catalogs);
    const suggestions = modelSuggestions(entry, profiles, catalogs);
    const listId = suggestions.length > 0 ? `tier-models-${tier}-${index}` : undefined;
    const problem = problemAt(tier, index);
    const highlight = availability === 'missing' || availability === 'no_profile' || problem;
    return (
      <div
        key={`${tier}-${index}`}
        data-testid={`tier-entry-${tier}-${index}`}
        className={`grid grid-cols-[1.25rem_7.5rem_minmax(0,11rem)_minmax(0,1fr)_auto] gap-2 items-center rounded-lg px-2 py-1.5 border ${
          highlight ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-[#0c0e17]/60'
        }`}
      >
        <span className="text-[10px] text-slate-500 font-mono text-right">{index + 1}</span>
        <select
          value={entry.engine}
          onChange={(e) => change(updateTierEntry(draft, tier, index, { engine: e.target.value as TierEngine }))}
          aria-label={l.engine}
          className={inputClass}
        >
          {TIER_ENGINE_OPTIONS.map((engine) => (
            <option key={engine} value={engine}>
              {engine}
            </option>
          ))}
        </select>
        {entry.engine === 'api' ? (
          <ProviderProfileSelect
            value={entryTargetChoice(entry)}
            onChange={(choice) => change(updateTierEntry(draft, tier, index, entryTargetPatch(choice)))}
            profiles={profiles}
            storeProfileAs="name"
            className={inputClass}
          />
        ) : (
          <span className="text-[10px] text-slate-500 truncate">{entry.engine}</span>
        )}
        <div className="min-w-0">
          <input
            type="text"
            value={entry.model}
            list={listId}
            onChange={(e) => change(updateTierEntry(draft, tier, index, { model: e.target.value }))}
            onKeyDown={stopEnter}
            placeholder={l.model}
            aria-label={l.model}
            className={inputClass}
          />
          {listId && (
            <datalist id={listId}>
              {suggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {(highlight || entry.source === 'auto') && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {entry.source === 'auto' && (
                <span className="px-1 rounded border border-slate-700 text-[9px] uppercase text-slate-400">{l.auto}</span>
              )}
              {availability === 'missing' && <span className="text-[10px] text-amber-300">{l.missing}</span>}
              {availability === 'no_profile' && <span className="text-[10px] text-amber-300">{l.noProfile}</span>}
              {problem && <span className="text-[10px] text-amber-300">{problem.kind === 'empty_model' ? l.emptyModel : l.duplicate}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title={l.moveUp}
            aria-label={l.moveUp}
            disabled={index === 0}
            onClick={() => change(moveTierEntry(draft, tier, index, -1))}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            title={l.moveDown}
            aria-label={l.moveDown}
            disabled={index === count - 1}
            onClick={() => change(moveTierEntry(draft, tier, index, 1))}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <button
            type="button"
            title={l.remove}
            aria-label={l.remove}
            onClick={() => change(removeTierEntry(draft, tier, index))}
            className="p-1 rounded text-slate-400 hover:text-rose-300 hover:bg-slate-800"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="model-tiers-section">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-violet-400" />
            {l.title}
          </h3>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{l.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={refresh}
            disabled={busy !== null || profileIds.length === 0}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy === 'refresh' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {l.refreshCatalogs}
          </button>
          <button
            type="button"
            onClick={seed}
            disabled={busy !== null}
            data-testid="model-tiers-seed"
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] flex items-center gap-1.5 disabled:opacity-40"
          >
            {busy === 'seed' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {l.seed}
          </button>
        </div>
      </div>

      {state.loadError && (
        <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-800/50 text-rose-200 text-[11px]">
          {l.loadError.replace('{error}', state.loadError)}
        </div>
      )}
      {state.problems.length > 0 && (
        <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-amber-200 text-[11px]">
          {l.problems.replace('{list}', state.problems.join('; '))}
        </div>
      )}
      {catalogErrors.map((msg) => (
        <div key={msg} className="p-2 rounded-lg bg-amber-950/20 border border-amber-800/40 text-amber-200 text-[10px]">
          {msg}
        </div>
      ))}

      <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-300">
        <label className="flex items-center gap-2" title={l.fallbackToLowerTierDesc}>
          <input
            type="checkbox"
            checked={draft.fallbackToLowerTier}
            onChange={(e) => change({ ...draft, fallbackToLowerTier: e.target.checked })}
          />
          {l.fallbackToLowerTier}
        </label>
        <label className="flex items-center gap-2">
          {l.maxSwitches}
          <select
            value={draft.maxSwitches}
            onChange={(e) => change({ ...draft, maxSwitches: Number(e.target.value) })}
            className="bg-[#0c0e17] border border-slate-800 rounded-md px-1.5 py-0.5 text-[11px] text-white"
          >
            <option value={0}>0 — {l.maxSwitchesOff}</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          {l.maxWait}
          <input
            type="number"
            min={0}
            max={120}
            value={Math.round(draft.maxWaitMs / 1000)}
            onChange={(e) => change({ ...draft, maxWaitMs: Math.max(0, Math.min(120, Number(e.target.value) || 0)) * 1000 })}
            onKeyDown={stopEnter}
            className="w-16 bg-[#0c0e17] border border-slate-800 rounded-md px-1.5 py-0.5 text-[11px] text-white"
          />
        </label>
      </div>

      {TIERS_TOP_DOWN.map((tier) => {
        const entries = draft.tiers[tier];
        return (
          <div key={tier} className={`rounded-xl border bg-[#141726]/60 p-3 space-y-2 ${TIER_ACCENT[tier].split(' ')[0]}`} data-testid={`tier-${tier}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className={`text-xs font-semibold ${TIER_ACCENT[tier].split(' ')[1]}`}>
                  {l.tier[tier]} <span className="font-mono text-[10px] text-slate-500">{tier}</span>
                </span>
                <span className="ml-2 text-[10px] text-slate-500">{l.tierHint[tier]}</span>
              </div>
              <button
                type="button"
                onClick={() => change(addTierEntry(draft, tier, { engine: 'api', model: '' }))}
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                {l.addEntry}
              </button>
            </div>
            {entries.length === 0 ? (
              <p className="text-[10px] text-slate-500">{l.emptyTier}</p>
            ) : (
              entries.map((entry, index) => renderEntry(tier, entry, index, entries.length))
            )}
          </div>
        );
      })}

      {error && <div className="text-[11px] text-rose-300">{error}</div>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[10px] text-slate-500 font-mono truncate" title={state.filePath}>
          {l.filePath}: {state.filePath}
        </span>
        <div className="flex items-center gap-2">
          {notice && (
            <span className="text-[11px] text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {notice}
            </span>
          )}
          {dirty && !notice && <span className="text-[11px] text-amber-300">{l.unsaved}</span>}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || busy !== null}
            data-testid="model-tiers-save"
            className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy === 'save' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {busy === 'save' ? l.saving : l.save}
          </button>
        </div>
      </div>
    </div>
  );
};
