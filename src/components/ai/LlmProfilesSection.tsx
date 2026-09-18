import React, { useCallback, useEffect, useState } from 'react';
import { Key, Pencil, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import type { LlmCompatFlags, LlmProfile, LlmProfileView, LlmProviderPreset, ModelCatalogResult } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';

/**
 * Профили OpenAI-совместимых провайдеров в настройках AI Studio (TASK-70.1, TASK-70.2, decision-39):
 * выбор профиля, создание из пресета, редактирование, удаление и каталог моделей выбранного профиля.
 * Ключ профиля в renderer не приходит: форма только задаёт новый или удаляет сохранённый.
 */
interface LlmProfilesSectionProps {
  profileId?: string;
  onSelectProfile: (id: string | undefined) => void;
  /** Модели каталога выбранного профиля — подсказки поля «Модель». */
  onCatalogChange: (models: string[]) => void;
}

interface ProfileDraft {
  isNew: boolean;
  profile: LlmProfile;
  apiKey: string;
  removeKey: boolean;
  hasApiKey: boolean;
}

const inputClass =
  'w-full bg-[#161928] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 font-mono focus:outline-none focus:border-indigo-500';
const labelClass = 'font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5';
const smallButton =
  'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#161928] text-[11px] text-slate-300 hover:text-white hover:border-slate-700 transition disabled:opacity-40';

function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function draftFromPreset(preset: LlmProviderPreset): LlmProfile {
  return {
    id: newProfileId(),
    name: preset.name,
    presetId: preset.id,
    baseUrl: preset.baseUrl,
    local: preset.local,
    compat: { ...preset.compat },
    ...(preset.headers ? { headers: { ...preset.headers } } : {})
  };
}

export const LlmProfilesSection: React.FC<LlmProfilesSectionProps> = ({ profileId, onSelectProfile, onCatalogChange }) => {
  const { t } = useTranslation();
  const l = t.llmProfiles;
  const dialog = useDialog();
  const [presets, setPresets] = useState<LlmProviderPreset[]>([]);
  const [profiles, setProfiles] = useState<LlmProfileView[]>([]);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogResult | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const reloadProfiles = useCallback(async () => {
    const list = await window.api.listLlmProfiles();
    setProfiles(list);
    return list;
  }, []);

  useEffect(() => {
    void window.api.getLlmProviderPresets().then(setPresets);
    void reloadProfiles();
  }, [reloadProfiles]);

  const loadCatalog = useCallback(
    async (id: string | undefined, refresh = false) => {
      if (!id) {
        setCatalog(null);
        onCatalogChange([]);
        return;
      }
      setCatalogLoading(true);
      try {
        const result = await window.api.listLlmProfileModels(id, refresh);
        setCatalog(result);
        onCatalogChange(result.models);
      } catch (err) {
        setCatalog({ models: [], fetchedAt: null, cached: false, error: err instanceof Error ? err.message : String(err) });
        onCatalogChange([]);
      } finally {
        setCatalogLoading(false);
      }
    },
    [onCatalogChange]
  );

  useEffect(() => {
    void loadCatalog(profileId);
  }, [profileId, loadCatalog]);

  const selected = profiles.find((p) => p.id === profileId);

  const startNew = () => {
    const preset = presets.find((p) => p.id === 'ollama') ?? presets[0];
    if (!preset) return;
    setError(null);
    setDraft({ isNew: true, profile: draftFromPreset(preset), apiKey: '', removeKey: false, hasApiKey: false });
  };

  const startEdit = () => {
    if (!selected) return;
    const { hasApiKey, ...profile } = selected;
    setError(null);
    setDraft({ isNew: false, profile: { ...profile, compat: { ...profile.compat } }, apiKey: '', removeKey: false, hasApiKey });
  };

  const changePreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset || !draft) return;
    setDraft({ ...draft, profile: { ...draftFromPreset(preset), id: draft.profile.id } });
  };

  const setCompat = <K extends keyof LlmCompatFlags>(key: K, value: LlmCompatFlags[K]) => {
    if (!draft) return;
    setDraft({ ...draft, profile: { ...draft.profile, compat: { ...draft.profile.compat, [key]: value } } });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setError(null);
    try {
      const apiKey = draft.removeKey ? '' : draft.apiKey.trim() ? draft.apiKey.trim() : undefined;
      const saved = await window.api.saveLlmProfile(draft.profile, apiKey);
      await reloadProfiles();
      setDraft(null);
      onSelectProfile(saved.id);
      // Адрес или ключ могли измениться — каталог перечитывается с сервера.
      void loadCatalog(saved.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const ok = await dialog.confirm(l.deleteConfirm.replace('{name}', selected.name));
    if (!ok) return;
    await window.api.deleteLlmProfile(selected.id);
    await reloadProfiles();
    onSelectProfile(undefined);
  };

  const presetOf = (id: string) => presets.find((p) => p.id === id);
  const draftPreset = draft ? presetOf(draft.profile.presetId) : undefined;

  return (
    <div className="space-y-3 p-4 rounded-xl bg-[#161928]/60 border border-slate-800">
      <div>
        <label className={`${labelClass} flex items-center gap-1.5`}>
          <Server className="w-3.5 h-3.5 text-indigo-400" />
          {l.profile}
        </label>
        {profiles.length === 0 && !draft ? (
          <p className="text-[11px] text-slate-400 mb-2">{l.noProfiles}</p>
        ) : (
          <select
            value={profileId ?? ''}
            onChange={(e) => onSelectProfile(e.target.value || undefined)}
            className={`${inputClass} font-sans mb-2`}
          >
            <option value="">{l.selectProfile}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.baseUrl}
              </option>
            ))}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} onClick={startNew} disabled={presets.length === 0}>
            <Plus className="w-3 h-3" /> {l.newProfile}
          </button>
          <button type="button" className={smallButton} onClick={startEdit} disabled={!selected}>
            <Pencil className="w-3 h-3" /> {l.editProfile}
          </button>
          <button type="button" className={smallButton} onClick={() => void deleteSelected()} disabled={!selected}>
            <Trash2 className="w-3 h-3" /> {l.deleteProfile}
          </button>
        </div>
      </div>

      {draft && (
        <div className="space-y-3 p-3 rounded-lg border border-indigo-500/30 bg-[#121522]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{l.preset}</label>
              <select
                value={draft.profile.presetId}
                onChange={(e) => changePreset(e.target.value)}
                disabled={!draft.isNew}
                className={`${inputClass} font-sans`}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{l.name}</label>
              <input
                type="text"
                value={draft.profile.name}
                onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, name: e.target.value } })}
                className={`${inputClass} font-sans`}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>{l.baseUrl}</label>
            <input
              type="text"
              value={draft.profile.baseUrl}
              onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, baseUrl: e.target.value } })}
              placeholder="https://api.example.com/v1"
              className={inputClass}
            />
          </div>

          <div>
            <label className={`${labelClass} flex items-center gap-1.5`}>
              <Key className="w-3.5 h-3.5 text-indigo-400" />
              {l.apiKey}
            </label>
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value, removeKey: false })}
              placeholder={draft.hasApiKey ? l.apiKeyStored : draftPreset?.requiresApiKey ? 'sk-...' : l.apiKeyOptional}
              className={inputClass}
              autoComplete="off"
            />
            {draft.hasApiKey && (
              <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={draft.removeKey}
                  onChange={(e) => setDraft({ ...draft, removeKey: e.target.checked, apiKey: '' })}
                />
                {l.removeKey}
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={draft.profile.local}
              onChange={(e) => setDraft({ ...draft, profile: { ...draft.profile, local: e.target.checked } })}
            />
            {l.local}
          </label>

          <div>
            <span className={labelClass}>{l.compat}</span>
            <div className="grid grid-cols-1 gap-1.5 text-[11px] text-slate-300">
              {(
                [
                  ['tools', l.compatTools],
                  ['vision', l.compatVision],
                  ['streamUsage', l.compatStreamUsage],
                  ['openRouterUsage', l.compatOpenRouterUsage],
                  ['responseFormat', l.compatResponseFormat]
                ] as const
              ).map(([key, text]) => (
                <label key={key} className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.profile.compat[key]} onChange={(e) => setCompat(key, e.target.checked)} />
                  {text}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{l.compatMaxTokensField}</label>
                <select
                  value={draft.profile.compat.maxTokensField}
                  onChange={(e) => setCompat('maxTokensField', e.target.value as LlmCompatFlags['maxTokensField'])}
                  className={inputClass}
                >
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{l.compatReasoning}</label>
                <select
                  value={draft.profile.compat.reasoning}
                  onChange={(e) => setCompat('reasoning', e.target.value as LlmCompatFlags['reasoning'])}
                  className={inputClass}
                >
                  <option value="none">{l.reasoningNone}</option>
                  <option value="reasoning_effort">reasoning_effort</option>
                  <option value="reasoning_object">reasoning: {'{ effort }'}</option>
                  <option value="ollama_think">Ollama /v1 (reasoning_effort, none…max)</option>
                </select>
              </div>
            </div>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className={smallButton} onClick={() => setDraft(null)}>
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void saveDraft()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition"
            >
              {l.saveProfile}
            </button>
          </div>
        </div>
      )}

      {selected && !draft && (
        <div className="flex items-start justify-between gap-2 text-[11px]">
          <div className="text-slate-400 min-w-0">
            <span className="text-slate-300 font-semibold">{l.models}: </span>
            {catalog?.fetchedAt
              ? [
                  l.modelsCount.replace('{count}', String(catalog.models.length)),
                  l.modelsUpdated.replace('{time}', new Date(catalog.fetchedAt).toLocaleString()),
                  catalog.cached ? l.modelsFromCache : null
                ]
                  .filter(Boolean)
                  .join(' · ')
              : l.modelsNever}
            {catalog?.error && <p className="text-amber-400 mt-1 break-words">{catalog.error}</p>}
          </div>
          <button
            type="button"
            className={smallButton}
            onClick={() => void loadCatalog(selected.id, true)}
            disabled={catalogLoading}
            title={l.refreshModels}
          >
            <RefreshCw className={`w-3 h-3 ${catalogLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}
    </div>
  );
};
