import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  Activity,
  Zap,
  ShieldCheck,
  Sparkles,
  X,
  Sliders,
  MessageSquareQuote,
  BookOpen,
  Plus,
  RotateCcw,
  Search,
  Check,
  AlertCircle
} from 'lucide-react';
import { voiceService, type VoiceConfig, type WhisperProvider } from '../../services/voiceService';
import { CONFIGURABLE_COMMANDS, type CommandPhraseDefinition } from '../../services/voiceCommandPhrases';
import { useTranslation } from '../../i18n/useTranslation';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'recognition' | 'phrases' | 'cheatsheet';

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({ isOpen, onClose }) => {
  const { t, language } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('phrases');
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());
  const [phrasesMap, setPhrasesMap] = useState<Record<string, string[]>>({});
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'tabs' | 'panels' | 'ai' | 'approval'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newPhraseInputs, setNewPhraseInputs] = useState<Record<string, string>>({});
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVoiceConfig(voiceService.getConfig());
      setPhrasesMap(voiceService.getCommandPhrases());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddPhrase = (intent: string) => {
    const rawInput = newPhraseInputs[intent]?.trim();
    if (!rawInput) return;

    const lower = rawInput.toLowerCase();
    const currentList = phrasesMap[intent] || [];
    if (currentList.includes(lower)) {
      setNewPhraseInputs((prev) => ({ ...prev, [intent]: '' }));
      return;
    }

    const updated = [...currentList, lower];
    const newMap = { ...phrasesMap, [intent]: updated };
    setPhrasesMap(newMap);
    voiceService.saveCommandPhrases(newMap);
    setNewPhraseInputs((prev) => ({ ...prev, [intent]: '' }));
  };

  const handleRemovePhrase = (intent: string, phraseToRemove: string) => {
    const currentList = phrasesMap[intent] || [];
    const updated = currentList.filter((p) => p !== phraseToRemove);
    const newMap = { ...phrasesMap, [intent]: updated };
    setPhrasesMap(newMap);
    voiceService.saveCommandPhrases(newMap);
  };

  const handleResetDefaults = () => {
    if (window.confirm(t.voice.settingsModal.resetConfirm)) {
      const defaults = voiceService.resetCommandPhrases();
      setPhrasesMap(defaults);
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 2500);
    }
  };

  // Filter commands by category and search
  const filteredCommands = CONFIGURABLE_COMMANDS.filter((cmd) => {
    if (categoryFilter !== 'all' && cmd.category !== categoryFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase().trim();
    const phrases = phrasesMap[cmd.intent] || cmd.defaultPhrases;
    const matchesPhrase = phrases.some((p) => p.includes(q));
    const matchesDesc = cmd.feedbackText.toLowerCase().includes(q) || cmd.intent.toLowerCase().includes(q);
    return matchesPhrase || matchesDesc;
  });

  const getCommandTitle = (cmd: CommandPhraseDefinition): string => {
    switch (cmd.intent) {
      case 'navigate_ai':
        return language === 'ru' ? 'Вкладка AI Studio / Чат' : 'Claude AI Studio / Chat Tab';
      case 'navigate_kanban':
        return language === 'ru' ? 'Вкладка Задачи / Бэклог' : 'Tasks / Backlog Tab';
      case 'navigate_milestones':
        return language === 'ru' ? 'Вкладка Дорожная карта / Майлстоуны' : 'Milestones / Roadmap Tab';
      case 'navigate_git':
        return language === 'ru' ? 'Вкладка Git репозиторий' : 'Git Repository Tab';
      case 'navigate_files':
        return language === 'ru' ? 'Вкладка Файлы проекта' : 'Project Files Tab';
      case 'navigate_prs':
        return language === 'ru' ? 'Вкладка Pull Requests' : 'Pull Requests Tab';
      case 'navigate_docs':
        return language === 'ru' ? 'Вкладка Документы и ADR' : 'Docs & ADR Tab';
      case 'navigate_analytics':
        return language === 'ru' ? 'Вкладка Аналитика' : 'Analytics Tab';
      case 'toggle_terminal':
        return language === 'ru' ? 'Панель Терминала' : 'Terminal Panel';
      case 'toggle_sidebar':
        return language === 'ru' ? 'Меню проектов (скрыть / показать)' : 'Project Menu (toggle)';
      case 'hide_sidebar':
        return language === 'ru' ? 'Скрыть меню проектов' : 'Hide Project Menu';
      case 'show_sidebar':
        return language === 'ru' ? 'Показать меню проектов' : 'Show Project Menu';
      case 'new_ai_session':
        return language === 'ru' ? 'Создать новый чат' : 'Create New Chat';
      case 'close_ai_session':
        return language === 'ru' ? 'Закрыть текущий чат' : 'Close Current Chat';
      case 'switch_session_next':
        return language === 'ru' ? 'Следующий чат' : 'Next Chat';
      case 'switch_session_prev':
        return language === 'ru' ? 'Предыдущий чат' : 'Previous Chat';
      case 'agent_approve':
        return language === 'ru' ? 'Одобрить действие агента' : 'Approve Agent Action';
      case 'agent_reject':
        return language === 'ru' ? 'Отклонить действие агента' : 'Reject Agent Action';
      default:
        return cmd.intent;
    }
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
    >
      <div className="w-full max-w-3xl bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-200 font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0e111b]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-400">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">{t.voice.settingsModal.title}</h3>
              <p className="text-[11px] text-slate-400">{t.voice.settingsModal.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-6 border-b border-slate-800 bg-[#151929]/50 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('phrases')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'phrases'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <MessageSquareQuote className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabPhrases}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-[10px] text-indigo-300 font-mono">
                {CONFIGURABLE_COMMANDS.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('recognition')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'recognition'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabRecognition}</span>
            </button>

            <button
              onClick={() => setActiveTab('cheatsheet')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'cheatsheet'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabCheatSheet}</span>
            </button>
          </div>

          {activeTab === 'phrases' && (
            <button
              type="button"
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium border border-slate-700 transition"
              title={t.voice.settingsModal.resetDefaults}
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              <span>{resetSuccess ? (language === 'ru' ? 'Сброшено!' : 'Reset!') : t.voice.settingsModal.resetDefaults}</span>
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 1: PHRASES & SYNONYMS CONFIGURATION                         */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'phrases' && (
            <div className="space-y-4">
              {/* Informational Hint Banner */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900 border border-indigo-500/30 text-xs text-indigo-200 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-white leading-relaxed">
                    {language === 'ru' ? 'Кастомизация голосовых триггеров' : 'Voice Trigger Customization'}
                  </p>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {t.voice.settingsModal.phrasesHint}
                  </p>
                </div>
              </div>

              {/* Filters & Search */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                {/* Category Pills */}
                <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800 text-xs w-full sm:w-auto overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: t.voice.settingsModal.categoryAll },
                      { id: 'tabs', label: t.voice.settingsModal.categoryTabs },
                      { id: 'panels', label: t.voice.settingsModal.categoryPanels },
                      { id: 'ai', label: t.voice.settingsModal.categoryAi },
                      { id: 'approval', label: t.voice.settingsModal.categoryApproval }
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                      className={`px-3 py-1 rounded-lg transition text-[11px] font-medium whitespace-nowrap ${
                        categoryFilter === cat.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={language === 'ru' ? 'Поиск команды или фразы...' : 'Search command or phrase...'}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Commands List */}
              <div className="space-y-3 pt-2">
                {filteredCommands.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs bg-slate-950/30 rounded-2xl border border-slate-800">
                    <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-600" />
                    {language === 'ru' ? 'Команды не найдены по текущему фильтру' : 'No commands found'}
                  </div>
                ) : (
                  filteredCommands.map((cmd) => {
                    const phrases = phrasesMap[cmd.intent] || cmd.defaultPhrases;
                    const inputVal = newPhraseInputs[cmd.intent] || '';

                    return (
                      <div
                        key={cmd.intent}
                        className="p-4 rounded-xl bg-[#151929]/70 border border-slate-800 hover:border-slate-700/80 transition space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs font-semibold text-white tracking-wide">
                              {getCommandTitle(cmd)}
                            </span>
                            <span className="ml-2 font-mono text-[10px] text-indigo-400/80">
                              ({cmd.intent})
                            </span>
                            <p className="text-[11px] text-slate-400 mt-0.5">{cmd.feedbackText}</p>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 border border-slate-700/50">
                            {phrases.length} {language === 'ru' ? 'фраз' : 'phrases'}
                          </span>
                        </div>

                        {/* Current Phrases Tags */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {phrases.map((phrase) => {
                            const isHighlight =
                              cmd.intent === 'navigate_ai' &&
                              ['чат', 'чет', 'чад', 'чят'].includes(phrase.toLowerCase());

                            return (
                              <span
                                key={phrase}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                                  isHighlight
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25'
                                    : 'bg-slate-900/90 text-slate-200 border-slate-700/70 hover:border-indigo-500/50'
                                }`}
                              >
                                <span>«{phrase}»</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemovePhrase(cmd.intent, phrase)}
                                  className="p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition"
                                  title={language === 'ru' ? `Удалить фразу «${phrase}»` : `Remove phrase "${phrase}"`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            );
                          })}

                          {/* Add Phrase Input Inline */}
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={inputVal}
                              onChange={(e) =>
                                setNewPhraseInputs((prev) => ({ ...prev, [cmd.intent]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddPhrase(cmd.intent);
                                }
                              }}
                              placeholder={t.voice.settingsModal.addPhrasePlaceholder}
                              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-44"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddPhrase(cmd.intent)}
                              disabled={!inputVal.trim()}
                              className="p-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition"
                              title={t.voice.settingsModal.addPhraseButton}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 2: RECOGNITION PIPELINE & WHISPER PROVIDER                */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'recognition' && (
            <div className="space-y-4 text-xs">
              {/* Hands-Free Talon Toggle */}
              <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    {language === 'ru' ? 'Непрерывный Hands-Free режим' : 'Continuous Hands-Free Mode'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 max-w-lg">
                    {language === 'ru'
                      ? 'Звук пишется непрерывно и нарезается на фразы с помощью локального детектора VAD без необходимости удерживать горячие клавиши.'
                      : 'Audio is recorded continuously and chunked by local VAD detector without needing to hold hotkeys.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !voiceConfig.handsFree;
                    voiceService.saveConfig({ handsFree: next });
                    setVoiceConfig((c) => ({ ...c, handsFree: next }));
                  }}
                  className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                    voiceConfig.handsFree ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* VAD Silence Threshold Slider */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-300 font-semibold">
                  <span>{language === 'ru' ? 'Чувствительность паузы тишины (VAD)' : 'VAD Silence Threshold'}</span>
                  <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {voiceConfig.vadSilenceThresholdMs} мс
                  </span>
                </div>
                <input
                  type="range"
                  min="300"
                  max="1000"
                  step="20"
                  value={voiceConfig.vadSilenceThresholdMs}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    voiceService.saveConfig({ vadSilenceThresholdMs: val });
                    setVoiceConfig((c) => ({ ...c, vadSilenceThresholdMs: val }));
                  }}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>{language === 'ru' ? 'Быстро (300 мс)' : 'Fast (300 ms)'}</span>
                  <span>{language === 'ru' ? 'Баланс (480 мс)' : 'Balanced (480 ms)'}</span>
                  <span>{language === 'ru' ? 'Длинные паузы (1000 мс)' : 'Long pauses (1000 ms)'}</span>
                </div>
              </div>

              {/* Whisper Provider */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    {language === 'ru' ? 'Движок распознавания речи' : 'Speech Recognition Engine'}
                  </label>
                  <select
                    value={voiceConfig.whisperProvider}
                    onChange={(e) => {
                      const prov = e.target.value as WhisperProvider;
                      const model =
                        prov === 'openai'
                          ? 'whisper-1'
                          : prov === 'groq'
                          ? 'whisper-large-v3'
                          : 'Xenova/whisper-base';
                      voiceService.saveConfig({ whisperProvider: prov, whisperModel: model });
                      setVoiceConfig((c) => ({ ...c, whisperProvider: prov, whisperModel: model }));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="local">
                      {language === 'ru'
                        ? 'Встроенный локальный Whisper (Изолированный Worker поток, 100% офлайн)'
                        : 'Embedded Local Whisper (Isolated Worker thread, 100% offline)'}
                    </option>
                    <option value="groq">Groq Whisper (whisper-large-v3, сверхбыстрый ~150мс)</option>
                    <option value="openai">OpenAI Whisper (whisper-1, облачный)</option>
                  </select>
                </div>

                {voiceConfig.whisperProvider === 'local' && (
                  <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      {language === 'ru'
                        ? 'Инференс локальной модели выполняется в фоновом потоке worker_threads без нагрузки на UI.'
                        : 'Local model inference runs in background worker thread with 0 UI latency.'}
                    </span>
                  </div>
                )}

                {/* API Key */}
                {voiceConfig.whisperProvider !== 'local' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      API Ключ {voiceConfig.whisperProvider === 'groq' ? 'Groq' : 'OpenAI'}
                    </label>
                    <input
                      type="password"
                      value={voiceConfig.whisperApiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        voiceService.saveConfig({ whisperApiKey: val });
                        setVoiceConfig((c) => ({ ...c, whisperApiKey: val }));
                      }}
                      placeholder="Автоматически из настроек AI Studio или введите ключ"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Ключ надёжно защищён системным шифрованием (safeStorage / DPAPI)</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 3: CHEAT SHEET & QUICK REFERENCE                          */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'cheatsheet' && (
            <div className="space-y-3 text-xs">
              <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/40 space-y-3">
                <div className="font-bold text-indigo-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {language === 'ru' ? 'Основные голосовые паттерны' : 'Key Voice Patterns'}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-300">
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">Вкладки и навигация:</span>
                    <p className="text-[11px] text-slate-400">
                      «чат», «студия», «задачи», «гит», «доки», «файлы», «пиары», «аналитика»
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">Проекты:</span>
                    <p className="text-[11px] text-slate-400">
                      «проект 1», «проект 2», «следующий проект», «перейди на проект [Имя]»
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">Панели и интерфейс:</span>
                    <p className="text-[11px] text-slate-400">
                      «скрой меню», «покажи меню», «меню», «терминал», «консоль»
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">Claude AI Studio:</span>
                    <p className="text-[11px] text-slate-400">
                      «новый чат», «чат 1», «промпт [текст]», «принять», «отклонить», «лимиты»
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-[#0e111b]/80 shrink-0">
          <div className="text-[11px] text-slate-500">
            {language === 'ru'
              ? 'Изменения фраз сохраняются мгновенно и сразу учитываются распознаванием.'
              : 'Phrase changes are saved immediately and take effect in real-time.'}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t.voice.settingsModal.doneButton}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
