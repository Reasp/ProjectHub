import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Cpu,
  Sliders,
  Sparkles,
  Server,
  CheckCircle2,
  Eye,
  EyeOff,
  ShieldCheck,
  FileCode,
  Terminal,
  BookOpen,
  GitFork,
  Plus,
  Trash2,
  SlidersHorizontal,
  Lock,
  LogOut,
  Clock,
  History
} from 'lucide-react';
import { useAIStudioStore, DEFAULT_AUTO_APPROVE_RULES } from '../../store/useAIStudioStore';
import { useHitlStore } from '../../store/useHitlStore';
import type { AIProviderConfig, AutoApproveRules } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { useTimers } from '../../hooks/useTimeoutState';

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODEL_PRESETS: Record<string, string[]> = {
  anthropic: [
    'default',
    'sonnet',
    'opus',
    'haiku',
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest'
  ],
  openrouter: [
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.5-sonnet',
    'deepseek/deepseek-r1',
    'deepseek/deepseek-chat',
    'openai/gpt-4o',
    'google/gemini-2.0-flash-001'
  ],
  deepseek: [
    'deepseek-chat',
    'deepseek-reasoner'
  ],
  ollama: [
    'qwen2.5-coder:7b',
    'deepseek-r1:8b',
    'llama3.3:70b',
    'mistral:latest'
  ],
  custom: [
    'custom-model'
  ]
};

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { config, saveConfig, claudeAuth, startClaudeLogin, claudeLogout, fetchClaudeAuth } = useAIStudioStore();
  const openHitlCenter = useHitlStore((s) => s.openCenter);

  const [activeTab, setActiveTab] = useState<'general' | 'autoApprove'>('general');
  const [form, setForm] = useState<AIProviderConfig>({
    ...config,
    autoApproveRules: config.autoApproveRules || { ...DEFAULT_AUTO_APPROVE_RULES }
  });
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  // Отложенное закрытие после сохранения: таймер снимается при размонтировании (TASK-50)
  const { setTimer } = useTimers();

  // Exclusion list inputs state
  const [newWritePattern, setNewWritePattern] = useState('');
  const [newReadPattern, setNewReadPattern] = useState('');
  const [newCommandPattern, setNewCommandPattern] = useState('');

  useEffect(() => {
    if (isOpen) {
      setForm({
        ...config,
        autoApproveRules: config.autoApproveRules || { ...DEFAULT_AUTO_APPROVE_RULES }
      });
      setSavedSuccess(false);
      fetchClaudeAuth();
    }
  }, [isOpen, config, fetchClaudeAuth]);

  if (!isOpen) return null;

  const rules: AutoApproveRules = form.autoApproveRules || { ...DEFAULT_AUTO_APPROVE_RULES };

  const updateRules = (updated: Partial<AutoApproveRules>) => {
    setForm((prev) => ({
      ...prev,
      autoApproveRules: {
        ...(prev.autoApproveRules || DEFAULT_AUTO_APPROVE_RULES),
        ...updated
      }
    }));
  };

  const handleAddWritePattern = () => {
    const p = newWritePattern.trim();
    if (!p) return;
    const current = rules.writeExcludePatterns || [];
    if (!current.includes(p)) {
      updateRules({ writeExcludePatterns: [...current, p] });
    }
    setNewWritePattern('');
  };

  const handleRemoveWritePattern = (pat: string) => {
    const current = rules.writeExcludePatterns || [];
    updateRules({ writeExcludePatterns: current.filter((p) => p !== pat) });
  };

  const handleAddReadPattern = () => {
    const p = newReadPattern.trim();
    if (!p) return;
    const current = rules.readExcludePatterns || [];
    if (!current.includes(p)) {
      updateRules({ readExcludePatterns: [...current, p] });
    }
    setNewReadPattern('');
  };

  const handleRemoveReadPattern = (pat: string) => {
    const current = rules.readExcludePatterns || [];
    updateRules({ readExcludePatterns: current.filter((p) => p !== pat) });
  };

  const handleAddCommandPattern = () => {
    const p = newCommandPattern.trim();
    if (!p) return;
    const current = rules.commandDenyList || [];
    if (!current.includes(p)) {
      updateRules({ commandDenyList: [...current, p] });
    }
    setNewCommandPattern('');
  };

  const handleRemoveCommandPattern = (pat: string) => {
    const current = rules.commandDenyList || [];
    updateRules({ commandDenyList: current.filter((p) => p !== pat) });
  };

  const handleProviderChange = (provider: AIProviderConfig['provider']) => {
    const defaultModel = MODEL_PRESETS[provider]?.[0] || 'custom';
    let defaultBaseUrl = form.baseUrl;
    if (provider === 'ollama') defaultBaseUrl = 'http://127.0.0.1:11434';
    if (provider === 'deepseek') defaultBaseUrl = 'https://api.deepseek.com';

    setForm((prev) => ({
      ...prev,
      provider,
      model: defaultModel,
      baseUrl: defaultBaseUrl
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveConfig(form);
    setSavedSuccess(true);
    setTimer(() => {
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      <div className="bg-[#121522] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#161a2b]/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-600/20 text-white">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t.aiStudio.settingsModal.title}</h2>
              <p className="text-xs text-slate-400">{t.aiStudio.settingsModal.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="px-6 pt-3 bg-[#141726]/60 border-b border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-2.5 px-3 border-b-2 text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'general'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{t.aiStudio.settingsModal.tabGeneral}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('autoApprove')}
            className={`pb-2.5 px-3 border-b-2 text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'autoApprove'
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.aiStudio.settingsModal.tabAutoApprove}</span>
            {form.autoApprove && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {savedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t.aiStudio.settingsModal.saved}</span>
            </div>
          )}

          {/* TAB 1: GENERAL (LLM PROVIDERS & MODELS) */}
          {activeTab === 'general' && (
            <div className="space-y-5">
              {/* Claude.ai Pro/Team Subscription Info Card */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-[#181a29] to-indigo-600/10 border border-amber-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                    <span className="text-sm font-bold">✳</span>
                    <span>{t.aiStudio.settingsModal.accountInfo} (Claude.ai OAuth)</span>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                    {claudeAuth?.isLoggedIn ? '● ACTIVE' : 'NOT LOGGED IN'}
                  </span>
                </div>

                {claudeAuth?.isLoggedIn ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-slate-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span>
                        {t.aiStudio.loggedInAs}: <strong className="text-amber-300">{claudeAuth.email}</strong>
                      </span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                        {claudeAuth.seatTier || 'Pro / Team'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        Isolated ProjectHub config (<code className="text-amber-300">~/.projecthub/claude_config</code>)
                      </span>
                    </div>
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startClaudeLogin()}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs transition flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>{t.aiStudio.loginClaude}</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await claudeLogout();
                          await fetchClaudeAuth();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium text-xs transition flex items-center gap-1.5"
                        title={t.aiStudio.logoutClaudeTitle}
                      >
                        <LogOut className="w-3.5 h-3.5 text-rose-400" />
                        <span>{t.aiStudio.logoutClaude}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {t.aiStudio.useSubscriptionDesc}
                    </p>
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startClaudeLogin()}
                        className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-md shadow-amber-600/20 transition flex items-center gap-1.5"
                      >
                        <span className="font-bold text-xs">✳</span>
                        <span>{t.aiStudio.loginClaude}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Provider Selection */}
              <div>
                <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-2">
                  {t.aiStudio.settingsModal.provider}:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleProviderChange('anthropic')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                      form.provider === 'anthropic'
                        ? 'bg-amber-500/10 border-amber-500/50 text-white shadow-sm ring-1 ring-amber-500/30'
                        : 'bg-[#161928] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs text-amber-300">Anthropic Claude</span>
                    <span className="text-[10px] text-slate-400">Claude 3.7 Sonnet</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderChange('openrouter')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                      form.provider === 'openrouter'
                        ? 'bg-indigo-600/15 border-indigo-500/50 text-white shadow-sm ring-1 ring-indigo-500/30'
                        : 'bg-[#161928] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs text-indigo-300">OpenRouter</span>
                    <span className="text-[10px] text-slate-400">Multi-Model Proxy</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderChange('deepseek')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                      form.provider === 'deepseek'
                        ? 'bg-blue-600/15 border-blue-500/50 text-white shadow-sm ring-1 ring-blue-500/30'
                        : 'bg-[#161928] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs text-blue-300">DeepSeek API</span>
                    <span className="text-[10px] text-slate-400">V3 & R1</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderChange('ollama')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                      form.provider === 'ollama'
                        ? 'bg-emerald-600/15 border-emerald-500/50 text-white shadow-sm ring-1 ring-emerald-500/30'
                        : 'bg-[#161928] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs text-emerald-300">Local Ollama</span>
                    <span className="text-[10px] text-slate-400">100% Offline</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderChange('custom')}
                    className={`p-3 rounded-xl border text-left transition flex flex-col gap-1 col-span-2 ${
                      form.provider === 'custom'
                        ? 'bg-purple-600/15 border-purple-500/50 text-white shadow-sm ring-1 ring-purple-500/30'
                        : 'bg-[#161928] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-semibold text-xs text-purple-300">Custom OpenAI Endpoint</span>
                    <span className="text-[10px] text-slate-400">vLLM, LM Studio, LiteLLM</span>
                  </button>
                </div>
              </div>

              {/* API Key */}
              {form.provider !== 'ollama' && (
                <div>
                  <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-indigo-400" />
                    {t.aiStudio.settingsModal.apiKey} ({form.provider.toUpperCase()})
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={form.apiKey || ''}
                      onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                      placeholder={
                        form.provider === 'anthropic'
                          ? t.aiStudio.settingsModal.apiKeyPlaceholderAnthropic
                          : form.provider === 'openrouter'
                          ? 'sk-or-v1-...'
                          : 'sk-...'
                      }
                      className="w-full bg-[#161928] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 font-mono focus:outline-none focus:border-indigo-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white p-1 rounded"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>{t.aiStudio.settingsModal.dpapiEncryptionHint}</span>
                  </div>
                </div>
              )}

              {/* Model & Base URL */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                    {t.aiStudio.settingsModal.model}
                  </label>
                  <input
                    type="text"
                    list="model-options"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    className="w-full bg-[#161928] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    placeholder="Model name..."
                  />
                  <datalist id="model-options">
                    {(MODEL_PRESETS[form.provider] || []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>

                {(form.provider === 'ollama' || form.provider === 'custom') && (
                  <div>
                    <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5 flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-indigo-400" />
                      {t.aiStudio.settingsModal.baseUrl}
                    </label>
                    <input
                      type="text"
                      value={form.baseUrl || ''}
                      onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434"
                      className="w-full bg-[#161928] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Sliders: Temperature & Thinking */}
              <div className="p-4 rounded-xl bg-[#161928]/60 border border-slate-800 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-medium text-slate-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                      {t.aiStudio.settingsModal.temperature}
                    </span>
                    <span className="font-mono text-indigo-400 font-semibold">{form.temperature ?? 0.7}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.temperature ?? 0.7}
                    onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {form.provider === 'anthropic' && form.model.includes('3-7') && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium text-slate-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        {t.aiStudio.settingsModal.thinkingBudget}
                      </span>
                      <span className="font-mono text-amber-400 font-semibold">{form.thinkingBudget || 0} tokens</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="8192"
                      step="512"
                      value={form.thinkingBudget ?? 2048}
                      onChange={(e) => setForm({ ...form, thinkingBudget: parseInt(e.target.value) })}
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: AUTO-APPROVE GRANULAR RULES & EXCLUSIONS */}
          {activeTab === 'autoApprove' && (
            <div className="space-y-5">
              {/* Master Toggle Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-[#181d2c] to-indigo-600/10 border-2 border-emerald-500/30 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-bold text-white flex items-center gap-2 text-xs">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <span>{t.aiStudio.settingsModal.autoApproveLabel}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {t.aiStudio.settingsModal.autoApproveSub}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={form.autoApprove || false}
                    onChange={(e) => setForm({ ...form, autoApprove: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Единый HITL-контур: таймаут ожидания решения и история решений (TASK-57) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <div className="p-3 rounded-xl bg-[#141726] border border-slate-800 space-y-1.5">
                  <label className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    {t.hitl.timeoutMinLabel}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={rules.approvalTimeoutMin ?? ''}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      updateRules({ approvalTimeoutMin: Number.isFinite(v) && v > 0 ? v : undefined });
                    }}
                    placeholder="1440"
                    className="w-full bg-[#0c0e17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-amber-500"
                  />
                  <p className="text-[10px] text-slate-400">{t.hitl.timeoutMinDesc}</p>
                </div>
                <div className="p-3 rounded-xl bg-[#141726] border border-slate-800 flex flex-col justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-indigo-400" />
                      {t.hitl.openHistory}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">{t.hitl.openHistoryDesc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openHitlCenter('history')}
                    className="self-start px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 text-xs font-medium transition flex items-center gap-1.5"
                  >
                    <History className="w-3.5 h-3.5" />
                    {t.hitl.openHistory}
                  </button>
                </div>
              </div>

              {/* Action Types Permissions */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block">
                  {t.aiStudio.settingsModal.allowedCategoriesLabel}
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="p-3 rounded-xl bg-[#141726] border border-slate-800 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={rules.allowFileWrite}
                      onChange={(e) => updateRules({ allowFileWrite: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{t.aiStudio.settingsModal.autoApproveWrite}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">{t.aiStudio.settingsModal.autoApproveWriteDesc}</p>
                    </div>
                  </label>

                  <label className="p-3 rounded-xl bg-[#141726] border border-slate-800 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={rules.allowCommands}
                      onChange={(e) => updateRules({ allowCommands: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{t.aiStudio.settingsModal.autoApproveCommands}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">{t.aiStudio.settingsModal.autoApproveCommandsDesc}</p>
                    </div>
                  </label>

                  <label className="p-3 rounded-xl bg-[#141726] border border-slate-800 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={rules.allowFileRead}
                      onChange={(e) => updateRules({ allowFileRead: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-purple-400" />
                        <span>{t.aiStudio.settingsModal.autoApproveRead}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">{t.aiStudio.settingsModal.autoApproveReadDesc}</p>
                    </div>
                  </label>

                  <label className="p-3 rounded-xl bg-[#141726] border border-slate-800 flex items-start gap-3 cursor-pointer hover:border-slate-700 transition">
                    <input
                      type="checkbox"
                      checked={rules.allowSubagents}
                      onChange={(e) => updateRules({ allowSubagents: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                    />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        <GitFork className="w-3.5 h-3.5 text-amber-400" />
                        <span>{t.aiStudio.settingsModal.autoApproveSubagents}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">{t.aiStudio.settingsModal.autoApproveSubagentsDesc}</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Exclusion Lists: 1. File Write Exclusions */}
              <div className="p-4 rounded-xl bg-[#141726] border border-slate-800 space-y-3">
                <div>
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>{t.aiStudio.settingsModal.writeExclusionsTitle}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {t.aiStudio.settingsModal.writeExclusionsDesc}
                  </p>
                </div>

                {/* Pattern Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {(rules.writeExcludePatterns || []).map((pat) => (
                    <span
                      key={pat}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-mono text-amber-300 shadow-sm"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveWritePattern(pat)}
                        className="hover:text-rose-400 text-slate-400 p-0.5 rounded transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add Input */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newWritePattern}
                    onChange={(e) => setNewWritePattern(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddWritePattern();
                      }
                    }}
                    placeholder={t.aiStudio.settingsModal.addPatternPlaceholder}
                    className="flex-1 bg-[#0c0e17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddWritePattern}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 text-xs font-medium transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.aiStudio.settingsModal.addPattern}</span>
                  </button>
                </div>
              </div>

              {/* Exclusion Lists: 2. File Read Exclusions */}
              <div className="p-4 rounded-xl bg-[#141726] border border-slate-800 space-y-3">
                <div>
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                    <EyeOff className="w-3.5 h-3.5 text-purple-400" />
                    <span>{t.aiStudio.settingsModal.readExclusionsTitle}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {t.aiStudio.settingsModal.readExclusionsDesc}
                  </p>
                </div>

                {/* Pattern Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {(rules.readExcludePatterns || []).map((pat) => (
                    <span
                      key={pat}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-mono text-purple-300 shadow-sm"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveReadPattern(pat)}
                        className="hover:text-rose-400 text-slate-400 p-0.5 rounded transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add Input */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newReadPattern}
                    onChange={(e) => setNewReadPattern(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddReadPattern();
                      }
                    }}
                    placeholder={t.aiStudio.settingsModal.readPatternPlaceholder}
                    className="flex-1 bg-[#0c0e17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddReadPattern}
                    className="px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600 text-purple-200 border border-purple-500/40 text-xs font-medium transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.aiStudio.settingsModal.addPattern}</span>
                  </button>
                </div>
              </div>

              {/* Exclusion Lists: 3. Command Deny List */}
              <div className="p-4 rounded-xl bg-[#141726] border border-slate-800 space-y-3">
                <div>
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                    <Terminal className="w-3.5 h-3.5 text-rose-400" />
                    <span>{t.aiStudio.settingsModal.commandDenyTitle}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {t.aiStudio.settingsModal.commandDenyDesc}
                  </p>
                </div>

                {/* Pattern Badges */}
                <div className="flex flex-wrap gap-1.5">
                  {(rules.commandDenyList || []).map((pat) => (
                    <span
                      key={pat}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/40 border border-rose-800/60 text-[11px] font-mono text-rose-300 shadow-sm"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCommandPattern(pat)}
                        className="hover:text-rose-200 text-rose-400 p-0.5 rounded transition"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add Input */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newCommandPattern}
                    onChange={(e) => setNewCommandPattern(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCommandPattern();
                      }
                    }}
                    placeholder={t.aiStudio.settingsModal.commandPatternPlaceholder}
                    className="flex-1 bg-[#0c0e17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddCommandPattern}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600 text-rose-200 border border-rose-500/40 text-xs font-medium transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t.aiStudio.settingsModal.addPattern}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/20 transition flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t.aiStudio.settingsModal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
