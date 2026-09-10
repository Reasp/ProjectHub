import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Sparkles, Zap, Cpu, Flame, Layers } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { ClaudeModelOption, AIProviderConfig } from '../../types/electron';

interface ModelSelectorDropdownProps {
  config: AIProviderConfig;
  onSelectModel: (modelId: string) => void;
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

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  config,
  onSelectModel
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<ClaudeModelOption[]>(FALLBACK_MODELS);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.api?.getAvailableModels) {
      window.api.getAvailableModels().then((list) => {
        if (list && list.length > 0) {
          setModels(list);
        }
      });
    }
  }, []);

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

  const currentModel = models.find(
    (m) =>
      m.id === config.model ||
      (m.id === 'default' && (!config.model || config.model === 'default')) ||
      (m.id === 'sonnet' && config.model?.includes('sonnet')) ||
      (m.id === 'haiku' && config.model?.includes('haiku')) ||
      (m.id === 'opus' && config.model?.includes('opus'))
  ) || {
    id: config.model || 'default',
    name: config.model === 'default' ? 'Default (recommended)' : config.model || 'Default (recommended)',
    description: 'Active model'
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
        title={t.aiStudio.selectModelTitle}
      >
        <span className="text-amber-400 font-bold text-[10px]">✳</span>
        <span className="font-medium max-w-[130px] truncate">{currentModel.name}</span>
        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1.5 w-84 bg-[#121522] border border-slate-800 rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2.5 border-b border-slate-800/80 bg-[#161a2b]/90 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
              Select a model
            </span>
            <span className="text-[9px] text-slate-500 font-mono">Claude Code CLI</span>
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5 space-y-1">
            {models.map((m) => {
              const isSelected = config.model === m.id || (m.id === 'default' && !config.model);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onSelectModel(m.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left p-2 rounded-lg transition flex items-start justify-between group ${
                    isSelected
                      ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                      : 'hover:bg-[#181c2e] text-slate-300 border border-transparent'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      {getFamilyIcon(m.family)}
                      <span className="font-semibold text-xs text-slate-100">{m.name}</span>
                      {m.badge && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 group-hover:text-slate-300 leading-tight">
                      {m.description}
                    </p>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
