import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, Check, Sparkles, Zap, Cpu, Flame, Layers, Search, HardDrive, Server } from 'lucide-react';
import { useI18n } from '../../i18n';
import { filterModelGroups, sortProfilesForMenu, type ModelGroup } from '../../lib/providerSelect';
import type { ClaudeModelOption, AIProviderConfig, LlmProfileView } from '../../types/electron';

/** Выбор в меню: модель Claude Code CLI (провайдер `anthropic`) или модель профиля (decision-40). */
export type ModelSelection = Pick<AIProviderConfig, 'provider' | 'profileId' | 'model'>;

interface ModelSelectorDropdownProps {
  config: AIProviderConfig;
  onSelect: (selection: ModelSelection) => void;
}

const CLI_GROUP_KEY = 'claude-cli';

interface CatalogState {
  models: string[];
  loading: boolean;
  error?: string;
}

const FALLBACK_MODELS: ClaudeModelOption[] = [
  {
    id: 'default',
    name: 'Default (recommended)',
    description: 'Sonnet 5 · Efficient for routine tasks',
    family: 'default'
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    family: 'sonnet'
  },
  {
    id: 'fable',
    name: 'Fable',
    description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
    badge: 'Requires usage credits',
    family: 'fable'
  },
  {
    id: 'opus[1m]',
    name: 'Opus (1M context)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    badge: '1M context',
    family: 'opus'
  },
  {
    id: 'haiku',
    name: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
    badge: 'Fastest',
    family: 'haiku'
  },
  {
    id: 'best',
    name: 'Best',
    description: 'Auto-selects optimal model for task complexity',
    family: 'default'
  },
  {
    id: 'opusplan',
    name: 'OpusPlan',
    description: 'Opus planning with Sonnet execution',
    family: 'opus'
  },
  {
    id: 'sonnet[1m]',
    name: 'Sonnet (1M context)',
    description: 'Sonnet 5 with extended 1M context window',
    badge: '1M context',
    family: 'sonnet'
  },
  {
    id: 'fable[1m]',
    name: 'Fable (1M context)',
    description: 'Fable 5 with extended 1M context window',
    badge: '1M context',
    family: 'fable'
  }
];

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({ config, onSelect }) => {
  const { t } = useI18n();
  const ps = t.providerSelect;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cliModels, setCliModels] = useState<ClaudeModelOption[]>(FALLBACK_MODELS);
  const [profiles, setProfiles] = useState<LlmProfileView[]>([]);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogState>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.api?.getAvailableModels) {
      window.api.getAvailableModels().then((list) => {
        if (list && list.length > 0) {
          setCliModels(list);
        }
      });
    }
  }, []);

  // Профили — для подписи кнопки сразу и заново при каждом открытии меню (их могли изменить в настройках).
  const loadProfiles = useCallback(async (): Promise<LlmProfileView[]> => {
    if (!window.api?.listLlmProfiles) return [];
    try {
      const list = await window.api.listLlmProfiles();
      setProfiles(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Каталоги профилей (кэш main-процесса, TASK-70.2) — при открытии меню, каждый независимо.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setQuery('');
    setTimeout(() => searchRef.current?.focus(), 0);
    void loadProfiles().then((list) => {
      for (const profile of list) {
        setCatalogs((prev) => ({ ...prev, [profile.id]: { models: prev[profile.id]?.models ?? [], loading: true } }));
        window.api
          .listLlmProfileModels(profile.id)
          .then((res) => {
            if (cancelled) return;
            setCatalogs((prev) => ({ ...prev, [profile.id]: { models: res.models, loading: false, error: res.error } }));
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            const message = err instanceof Error ? err.message : String(err);
            setCatalogs((prev) => ({
              ...prev,
              [profile.id]: { models: prev[profile.id]?.models ?? [], loading: false, error: message }
            }));
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, loadProfiles]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeProfile = config.provider === 'openai-compatible' ? profiles.find((p) => p.id === config.profileId) : undefined;

  const groups: ModelGroup[] = useMemo(() => {
    const list: ModelGroup[] = [
      {
        key: CLI_GROUP_KEY,
        label: ps.claudeCliGroup,
        models: cliModels.map((m) => ({ id: m.id, name: m.name, description: m.description, badge: m.badge, family: m.family }))
      }
    ];
    for (const profile of sortProfilesForMenu(profiles)) {
      const catalog = catalogs[profile.id];
      const models = [...(catalog?.models ?? [])];
      // Модель, введённая вручную, видна в своей группе, даже если её нет в каталоге.
      if (config.provider === 'openai-compatible' && config.profileId === profile.id && config.model && !models.includes(config.model)) {
        models.unshift(config.model);
      }
      list.push({
        key: profile.id,
        label: profile.name,
        local: profile.local,
        models: models.map((id) => ({ id })),
        loading: catalog?.loading,
        error: catalog?.error
      });
    }
    return list;
  }, [cliModels, profiles, catalogs, config.provider, config.profileId, config.model, ps.claudeCliGroup]);

  const visibleGroups = filterModelGroups(groups, query);

  const isLegacyProvider = config.provider !== 'anthropic' && config.provider !== 'openai-compatible';

  const currentCliModel =
    config.provider === 'anthropic'
      ? cliModels.find(
          (m) =>
            m.id === config.model ||
            (m.id === 'default' && (!config.model || config.model === 'default')) ||
            (m.id === 'sonnet' && config.model?.includes('sonnet')) ||
            (m.id === 'haiku' && config.model?.includes('haiku')) ||
            (m.id === 'opus' && config.model?.includes('opus'))
        )
      : undefined;

  const triggerLabel =
    config.provider === 'anthropic'
      ? currentCliModel?.name ?? (config.model && config.model !== 'default' ? config.model : 'Default (recommended)')
      : config.model || ps.noModelSelected;
  const triggerSource =
    config.provider === 'openai-compatible' ? activeProfile?.name ?? config.profileId ?? '' : isLegacyProvider ? config.provider : '';

  const isSelected = (groupKey: string, modelId: string): boolean => {
    if (groupKey === CLI_GROUP_KEY) {
      return config.provider === 'anthropic' && (config.model === modelId || (modelId === 'default' && !config.model));
    }
    return config.provider === 'openai-compatible' && config.profileId === groupKey && config.model === modelId;
  };

  const handlePick = (groupKey: string, modelId: string) => {
    if (groupKey === CLI_GROUP_KEY) {
      onSelect({ provider: 'anthropic', profileId: undefined, model: modelId });
    } else {
      onSelect({ provider: 'openai-compatible', profileId: groupKey, model: modelId });
    }
    setIsOpen(false);
  };

  const getFamilyIcon = (family?: string) => {
    switch (family) {
      case 'opus':
        return <Cpu className="w-3.5 h-3.5 text-purple-400" />;
      case 'fable':
        return <Flame className="w-3.5 h-3.5 text-amber-400" />;
      case 'haiku':
        return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
      case 'sonnet':
        return <Sparkles className="w-3.5 h-3.5 text-indigo-400" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-cyan-400" />;
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0d101a] border border-slate-800 hover:border-slate-700 hover:bg-[#141724] text-slate-200 text-[11px] font-medium transition shadow-sm cursor-pointer"
        title={ps.selectModelTitle}
      >
        <span className="text-amber-400 font-bold text-[10px]">✳</span>
        <span className="font-medium max-w-[160px] truncate">{triggerLabel}</span>
        {triggerSource && <span className="text-[10px] text-slate-400 max-w-[110px] truncate">· {triggerSource}</span>}
        {activeProfile?.local && <HardDrive className="w-3 h-3 text-emerald-400" aria-label={ps.local} />}
        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1.5 w-96 bg-[#121522] border border-slate-800 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-slate-800/80 bg-[#161a2b]/90 space-y-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">{ps.menuTitle}</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#0d101a] border border-slate-800">
              <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsOpen(false);
                }}
                placeholder={ps.modelSearch}
                className="w-full bg-transparent text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-hidden"
              />
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto p-1.5 space-y-2">
            {isLegacyProvider && !query && (
              <div className="px-2 py-1.5 text-[10px] text-slate-400 border border-slate-800 rounded-lg">
                {config.provider}: <span className="font-mono text-slate-200">{config.model || ps.noModelSelected}</span>
              </div>
            )}
            {visibleGroups.map((group) => (
              <div key={group.key} className="space-y-1">
                <div className="flex items-center gap-1.5 px-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {group.key === CLI_GROUP_KEY ? <Sparkles className="w-3 h-3" /> : <Server className="w-3 h-3" />}
                  <span className="truncate normal-case">{group.label}</span>
                  {group.local && (
                    <span className="text-[9px] px-1.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono normal-case">
                      {ps.local}
                    </span>
                  )}
                  {group.loading && <span className="normal-case font-normal text-slate-500">{ps.loadingModels}</span>}
                  {!group.loading && group.error && (
                    <span className="normal-case font-normal text-amber-400 truncate" title={group.error}>
                      {ps.catalogError}
                    </span>
                  )}
                </div>
                {group.models.length === 0 && !group.loading && <p className="px-2 text-[10px] text-slate-500">{ps.noModels}</p>}
                {group.models.map((m) => {
                  const selected = isSelected(group.key, m.id);
                  return (
                    <button
                      key={`${group.key}:${m.id}`}
                      type="button"
                      onClick={() => handlePick(group.key, m.id)}
                      className={`w-full text-left p-2 rounded-lg transition flex items-start justify-between group ${
                        selected
                          ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                          : 'hover:bg-[#181c2e] text-slate-300 border border-transparent'
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {group.key === CLI_GROUP_KEY ? getFamilyIcon(m.family) : null}
                          <span
                            className={`font-semibold text-xs text-slate-100 truncate ${group.key === CLI_GROUP_KEY ? '' : 'font-mono'}`}
                          >
                            {m.name ?? m.id}
                          </span>
                          {m.badge && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                              {m.badge}
                            </span>
                          )}
                        </div>
                        {m.description && (
                          <p className="text-[10px] text-slate-400 group-hover:text-slate-300 leading-tight">{m.description}</p>
                        )}
                      </div>

                      {selected && <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
