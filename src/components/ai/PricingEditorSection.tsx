import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, CloudDownload, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { AgentPricingState, OpenRouterImportResult, PriceOverrides } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import {
  applyImportSelection,
  buildPriceRows,
  draftFromPrice,
  filterImportEntries,
  formatPrice,
  normalizeDraftModelId,
  priceFromDraft,
  removeOverride,
  setOverride,
  type PriceDraft,
  type PriceRowStatus
} from '../../lib/pricingEditor';

/** Сколько строк импорта показывать сразу: полный список OpenRouter — сотни моделей. */
const IMPORT_VISIBLE_LIMIT = 150;

const inputClass =
  'w-full bg-[#0c0e17] border border-slate-800 rounded-md px-2 py-1 text-[11px] text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500';

/** Enter в полях редактора не должен отправлять форму настроек AI Studio. */
function stopEnter(e: React.KeyboardEvent) {
  if (e.key === 'Enter') e.preventDefault();
}

interface PriceInputsProps {
  draft: PriceDraft;
  onChange: (draft: PriceDraft) => void;
}

const PriceInputs: React.FC<PriceInputsProps> = ({ draft, onChange }) => {
  const { t } = useTranslation();
  const l = t.pricing;
  const fields: Array<[keyof PriceDraft, string]> = [
    ['input', l.input],
    ['output', l.output],
    ['cacheRead', `${l.cacheRead} (${l.optional})`],
    ['cacheWrite', `${l.cacheWrite} (${l.optional})`]
  ];
  return (
    <>
      {fields.map(([key, label]) => (
        <input
          key={key}
          type="text"
          inputMode="decimal"
          value={draft[key]}
          onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
          onKeyDown={stopEnter}
          placeholder={label}
          title={label}
          aria-label={label}
          className={inputClass}
        />
      ))}
    </>
  );
};

/**
 * Редактор таблицы цен агентов (TASK-70.4, decision-42): встроенные цены и переопределения
 * `agent-pricing.json` отдельно, сброс к встроенной, свои модели, импорт из OpenRouter по кнопке.
 * Сохраняется отдельно от настроек AI Studio и применяется без перезапуска.
 */
export const PricingEditorSection: React.FC = () => {
  const { t } = useTranslation();
  const l = t.pricing;
  const [state, setState] = useState<AgentPricingState | null>(null);
  const [draft, setDraft] = useState<PriceOverrides>({ models: {} });
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; draft: PriceDraft } | null>(null);
  const [adding, setAdding] = useState<{ id: string; draft: PriceDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importState, setImportState] = useState<{ loading: boolean; result?: OpenRouterImportResult; error?: string }>({ loading: false });
  const [importQuery, setImportQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    window.api
      .getAgentPricing()
      .then((s: AgentPricingState) => {
        if (cancelled) return;
        setState(s);
        setDraft(s.overrides);
      })
      .catch((err: unknown) => !cancelled && setError(String((err as Error)?.message ?? err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const updateDraft = useCallback((next: PriceOverrides) => {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  }, []);

  const rows = useMemo(() => (state ? buildPriceRows(state.builtin, draft, query) : []), [state, draft, query]);

  const importEntries = useMemo(
    () => (importState.result ? filterImportEntries(importState.result.entries, importQuery) : []),
    [importState.result, importQuery]
  );
  const visibleImport = importEntries.slice(0, IMPORT_VISIBLE_LIMIT);

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-xs py-6 justify-center">
        {error ? <span className="text-rose-300">{error}</span> : <Loader2 className="w-4 h-4 animate-spin" />}
      </div>
    );
  }

  const statusBadge = (status: PriceRowStatus, source?: string) => {
    const label =
      source === 'openrouter' ? l.statusImported : status === 'custom' ? l.statusCustom : status === 'overridden' ? l.statusOverridden : l.statusBuiltin;
    const cls =
      status === 'builtin'
        ? 'bg-slate-800/60 text-slate-400 border-slate-700'
        : status === 'overridden'
          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
          : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
    return <span className={`px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wide ${cls}`}>{label}</span>;
  };

  const applyEdit = () => {
    if (!editing) return;
    const price = priceFromDraft(editing.draft);
    if (!price) {
      setError(l.invalidPrice);
      return;
    }
    updateDraft(setOverride(draft, editing.id, price));
    setEditing(null);
    setError(null);
  };

  const applyAdd = () => {
    if (!adding) return;
    const id = normalizeDraftModelId(adding.id);
    if (!id) {
      setError(l.invalidModelId);
      return;
    }
    const price = priceFromDraft(adding.draft);
    if (!price) {
      setError(l.invalidPrice);
      return;
    }
    updateDraft(setOverride(draft, id, price));
    setAdding(null);
    setError(null);
    setQuery(id);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.api.saveAgentPricing(draft);
      setState(next);
      setDraft(next.overrides);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const loadImport = async () => {
    setImportState({ loading: true });
    setSelected(new Set());
    try {
      const result = await window.api.fetchOpenRouterPrices();
      setImportState({ loading: false, result });
    } catch (err) {
      setImportState({ loading: false, error: String((err as Error)?.message ?? err) });
    }
  };

  const addSelected = () => {
    if (!importState.result) return;
    updateDraft(applyImportSelection(draft, importState.result.entries, selected));
    setSelected(new Set());
    setImportState({ loading: false });
    setImportQuery('');
  };

  const overridesCount = Object.keys(draft.models).length;
  const longContextCount = importState.result?.entries.filter((e) => e.hasLongContextTier).length ?? 0;

  return (
    <div className="space-y-3" data-testid="pricing-editor">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-white">{l.title}</h3>
        <p className="text-slate-400">{l.subtitle}</p>
        <p className="text-[11px] text-slate-500">
          {l.builtinDate.replace('{date}', state.builtin.updatedAt)} · {l.overridesCount.replace('{count}', String(overridesCount))}
        </p>
        <p className="text-[10px] text-slate-600 font-mono break-all">{l.filePath.replace('{path}', state.filePath)}</p>
        <p className="text-[11px] text-emerald-300/80">{l.localNote}</p>
        {state.loadError && <p className="text-[11px] text-amber-300">{l.loadError.replace('{error}', state.loadError)}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={stopEnter}
            placeholder={l.search}
            className={`${inputClass} pl-7`}
            data-testid="pricing-search"
          />
        </div>
        <button
          type="button"
          onClick={() => setAdding({ id: '', draft: draftFromPrice() })}
          className="px-2.5 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 font-medium transition flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          {l.addModel}
        </button>
        <button
          type="button"
          onClick={loadImport}
          disabled={importState.loading}
          title={l.importNote}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition flex items-center gap-1 disabled:opacity-60"
          data-testid="pricing-import-openrouter"
        >
          {importState.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
          {importState.loading ? l.importing : l.importOpenRouter}
        </button>
      </div>

      {adding && (
        <div className="p-2.5 rounded-lg border border-indigo-500/30 bg-indigo-950/20 space-y-2">
          <input
            type="text"
            value={adding.id}
            onChange={(e) => setAdding({ ...adding, id: e.target.value })}
            onKeyDown={stopEnter}
            placeholder={l.modelId}
            className={inputClass}
            autoFocus
          />
          <div className="grid grid-cols-4 gap-1.5">
            <PriceInputs draft={adding.draft} onChange={(d) => setAdding({ ...adding, draft: d })} />
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setAdding(null)} className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300">
              {l.cancelEdit}
            </button>
            <button type="button" onClick={applyAdd} className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white">
              {l.add}
            </button>
          </div>
        </div>
      )}

      {(importState.result || importState.error) && (
        <div className="p-2.5 rounded-lg border border-slate-700 bg-[#0f1220] space-y-2" data-testid="pricing-import-panel">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-slate-400">{l.importNote}</p>
            <button type="button" onClick={() => setImportState({ loading: false })} className="p-1 rounded text-slate-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {importState.error && <p className="text-[11px] text-rose-300">{l.importError.replace('{error}', importState.error)}</p>}
          {importState.result && (
            <>
              <p className="text-[11px] text-slate-300">
                {l.importSummary
                  .replace('{total}', String(importState.result.total))
                  .replace('{count}', String(importState.result.entries.length))
                  .replace('{variant}', String(importState.result.skipped.variant))
                  .replace('{dynamic}', String(importState.result.skipped.dynamic))
                  .replace('{duplicate}', String(importState.result.skipped.duplicate))
                  .replace('{invalid}', String(importState.result.skipped.invalid))}
              </p>
              {longContextCount > 0 && <p className="text-[11px] text-amber-300/80">{l.importLongContext.replace('{count}', String(longContextCount))}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={importQuery}
                  onChange={(e) => setImportQuery(e.target.value)}
                  onKeyDown={stopEnter}
                  placeholder={l.importSearch}
                  className={`${inputClass} flex-1 min-w-[140px]`}
                  data-testid="pricing-import-search"
                />
                <button
                  type="button"
                  onClick={() => setSelected(new Set([...selected, ...visibleImport.map((e) => e.sourceId)]))}
                  className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  {l.importSelectVisible}
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300">
                  {l.importClear}
                </button>
                <button
                  type="button"
                  onClick={addSelected}
                  disabled={selected.size === 0}
                  className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                  data-testid="pricing-import-add"
                >
                  {l.importAdd.replace('{count}', String(selected.size))}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800/70">
                {visibleImport.map((e) => (
                  <label key={e.sourceId} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(e.sourceId)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(e.sourceId)) next.delete(e.sourceId);
                        else next.add(e.sourceId);
                        setSelected(next);
                      }}
                      className="accent-indigo-500"
                    />
                    <span className="font-mono text-[11px] text-slate-200 truncate flex-1" title={e.name}>
                      {e.sourceId}
                      {draft.models[e.id] || state.builtin.models[e.id] ? <span className="text-amber-400/80"> → {e.id}</span> : null}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {formatPrice(e.price.input)} / {formatPrice(e.price.output)}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                {l.importShown.replace('{shown}', String(visibleImport.length)).replace('{count}', String(importEntries.length))}
              </p>
            </>
          )}
        </div>
      )}

      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="grid grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_64px] gap-1.5 px-2 py-1.5 bg-slate-900/60 text-[10px] uppercase tracking-wide text-slate-500">
          <span>{l.model}</span>
          <span>{l.input}</span>
          <span>{l.output}</span>
          <span>{l.cacheRead}</span>
          <span>{l.cacheWrite}</span>
          <span />
        </div>
        <div className="max-h-[42vh] overflow-y-auto divide-y divide-slate-800/70" data-testid="pricing-rows">
          {rows.length === 0 && <p className="px-2 py-3 text-center text-slate-500">{l.empty}</p>}
          {rows.map((row) => {
            const isEditing = editing?.id === row.id;
            return (
              <div
                key={row.id}
                className="grid grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_64px] gap-1.5 px-2 py-1.5 items-center hover:bg-slate-800/30"
                data-testid={`pricing-row-${row.id}`}
              >
                <div className="min-w-0 flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-slate-200 truncate" title={row.id}>
                    {row.id}
                  </span>
                  {statusBadge(row.status, row.override?.source)}
                </div>
                {isEditing ? (
                  <PriceInputs draft={editing.draft} onChange={(d) => setEditing({ id: row.id, draft: d })} />
                ) : (
                  (['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
                    <span
                      key={key}
                      className="font-mono text-[11px] text-slate-300"
                      title={row.status === 'overridden' && row.builtin ? `${l.statusBuiltin}: ${formatPrice(row.builtin[key])}` : undefined}
                    >
                      {formatPrice(row.price[key])}
                    </span>
                  ))
                )}
                <div className="flex items-center justify-end gap-0.5">
                  {isEditing ? (
                    <>
                      <button type="button" onClick={applyEdit} title={l.apply} className="p-1 rounded text-emerald-400 hover:bg-slate-800">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditing(null)} title={l.cancelEdit} className="p-1 rounded text-slate-400 hover:bg-slate-800">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing({ id: row.id, draft: draftFromPrice(row.price) })}
                        title={l.edit}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {row.status === 'overridden' && (
                        <button
                          type="button"
                          onClick={() => updateDraft(removeOverride(draft, row.id))}
                          title={l.resetToBuiltin}
                          className="p-1 rounded text-amber-400 hover:bg-slate-800"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {row.status === 'custom' && (
                        <button
                          type="button"
                          onClick={() => updateDraft(removeOverride(draft, row.id))}
                          title={l.remove}
                          className="p-1 rounded text-rose-400 hover:bg-slate-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && <p className="text-[11px] text-rose-300">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-emerald-300 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {l.saved}
          </span>
        )}
        {dirty && <span className="text-amber-300 text-[11px]">{l.unsaved}</span>}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition flex items-center gap-1.5 disabled:opacity-50"
          data-testid="pricing-save"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {saving ? l.saving : l.save}
        </button>
      </div>
    </div>
  );
};
