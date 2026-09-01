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
  ShieldCheck
} from 'lucide-react';
import { useAIStudioStore } from '../../store/useAIStudioStore';
import type { AIProviderConfig } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

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
  const { config, saveConfig, claudeAuth, startClaudeLogin, fetchClaudeAuth } = useAIStudioStore();

  const [form, setForm] = useState<AIProviderConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm(config);
      setSavedSuccess(false);
      fetchClaudeAuth();
    }
  }, [isOpen, config, fetchClaudeAuth]);

  if (!isOpen) return null;

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
    setTimeout(() => {
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      <div className="bg-[#121522] border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
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

        {/* Body Form */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {savedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t.aiStudio.settingsModal.saved}</span>
            </div>
          )}

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
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
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

          {/* Provider Selector Tabs */}
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

          {/* API Key Field */}
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
                      ? 'sk-ant-api03-...'
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
            </div>
          )}

          {/* Model Selection */}
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

            {/* Base URL for Ollama / Custom */}
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
