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
  AlertCircle,
  Headphones,
  Keyboard,
  Volume2,
  RefreshCw,
  CheckCircle2,
  Radio,
  Download,
  Trash2,
  Upload,
  Play,
  Speech
} from 'lucide-react';
import {
  voiceService,
  type VoiceConfig,
  type VoiceEngine,
  type WhisperProvider,
  type AudioDeviceInfo
} from '../../services/voiceService';
import type {
  LocalWhisperStatusInfo,
  PushToTalkSettings,
  PushToTalkStatus,
  TtsDownloadProgress,
  TtsStatusInfo,
  TtsVoiceListItem
} from '../../types/electron';
import { CONFIGURABLE_COMMANDS, type CommandPhraseDefinition } from '../../services/voiceCommandPhrases';
import { describeTtsStatus } from '../../services/ttsStatusView';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { useTimeoutState, useToast, useTimers } from '../../hooks/useTimeoutState';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'devices' | 'phrases' | 'recognition' | 'tts' | 'dialog' | 'cheatsheet';

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({ isOpen, onClose }) => {
  const { t, language } = useTranslation();
  const dialog = useDialog();
  const [activeTab, setActiveTab] = useState<TabType>('devices');
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());
  const [phrasesMap, setPhrasesMap] = useState<Record<string, string[]>>({});
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'tabs' | 'panels' | 'ai' | 'approval' | 'dialog'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newPhraseInputs, setNewPhraseInputs] = useState<Record<string, string>>({});
  // Индикатор сброса гаснет сам; таймер снимается при размонтировании (TASK-50)
  const [resetSuccess, showResetSuccess] = useTimeoutState(false, 2500);

  // Audio Devices State
  const [devices, setDevices] = useState<{ inputs: AudioDeviceInfo[]; outputs: AudioDeviceInfo[] }>({
    inputs: [],
    outputs: []
  });
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPlayingTest, setIsPlayingTest] = useState(false);
  const { setTimer } = useTimers();
  const [deviceNotice, showDeviceNotice] = useToast<string>(4500);
  const [activeMicLabel, setActiveMicLabel] = useState<string | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Local Whisper model status (ленивая загрузка: модель грузится только по прогреву/первому hands-free)
  const [whisperStatus, setWhisperStatus] = useState<LocalWhisperStatusInfo | null>(null);
  const [isWarmingUp, setIsWarmingUp] = useState(false);

  const refreshWhisperStatus = async () => {
    const st = await voiceService.getLocalWhisperStatus();
    setWhisperStatus(st);
    return st;
  };

  const handleWarmupWhisper = async () => {
    setIsWarmingUp(true);
    try {
      const st = await voiceService.warmupLocalWhisper();
      setWhisperStatus(st);
    } finally {
      setIsWarmingUp(false);
    }
  };

  // ── Локальный TTS на голосах Piper (TASK-69) ──
  const [ttsStatus, setTtsStatus] = useState<TtsStatusInfo | null>(null);
  const [ttsVoices, setTtsVoices] = useState<TtsVoiceListItem[]>([]);
  const [ttsProgress, setTtsProgress] = useState<Record<string, TtsDownloadProgress>>({});
  const [isImportingVoice, setIsImportingVoice] = useState(false);
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);
  const [ttsNotice, showTtsNotice] = useToast<string>(6000);

  // ── Push-to-talk, ключевое слово и разбор моделью (TASK-83) ──
  const [pttStatus, setPttStatus] = useState<PushToTalkStatus | null>(null);
  const [acceleratorDraft, setAcceleratorDraft] = useState('');
  const [acceleratorRejected, setAcceleratorRejected] = useState(false);
  const [newWakePhrase, setNewWakePhrase] = useState('');

  useEffect(() => {
    if (!isOpen || activeTab !== 'dialog') return;
    let cancelled = false;

    void window.api?.getPushToTalkStatus?.().then((status) => {
      if (cancelled || !status) return;
      setPttStatus(status);
      setAcceleratorDraft(status.settings.accelerator);
    });

    // Статус приходит из main и когда настройки меняет другое окно, и когда идёт запись.
    const unsub = window.api?.onPushToTalkStatus?.((status) => setPttStatus(status));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [isOpen, activeTab]);

  /** main возвращает код ошибки, а текст живёт здесь — иначе строки интерфейса утекли бы в main. */
  const ttsStatusView = describeTtsStatus(ttsStatus);

  const translateTtsError = (code?: string, fallback?: string): string =>
    (code && t.voice.settingsModal.ttsErrors[code]) || fallback || '';

  const refreshTtsState = async () => {
    if (!window.api?.getTtsStatus) return;
    const [status, voices] = await Promise.all([
      window.api.getTtsStatus().catch(() => null),
      window.api.listTtsVoices?.().catch(() => []) ?? []
    ]);
    setTtsStatus(status);
    setTtsVoices(voices);
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'tts') return;
    void refreshTtsState();
    // Прогресс загрузки приходит событиями из main, а не опросом по таймеру
    const unsub = window.api?.onTtsDownloadProgress?.((progress) => {
      setTtsProgress((prev) => ({ ...prev, [progress.voiceId]: progress }));
      if (progress.phase === 'done') void refreshTtsState();
    });
    // Ошибка синтеза (в том числе при чтении голосовой командой) меняет статус голоса — показываем причину
    const unsubError = window.api?.onTtsError?.(() => {
      void refreshTtsState();
    });
    return () => {
      unsub?.();
      unsubError?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  const handleSelectTtsVoice = (voiceId: string) => {
    voiceService.saveConfig({ ttsVoiceId: voiceId });
    setVoiceConfig((c) => ({ ...c, ttsVoiceId: voiceId }));
  };

  const handleDownloadVoice = async (voiceId: string) => {
    const res = await window.api?.downloadTtsVoice?.(voiceId);
    if (res && !res.ok && !res.canceled) {
      showTtsNotice(translateTtsError(res.errorCode, res.error));
    } else if (res?.ok) {
      handleSelectTtsVoice(voiceId);
    }
    await refreshTtsState();
  };

  const handleCancelVoiceDownload = async (voiceId: string) => {
    await window.api?.cancelTtsVoiceDownload?.(voiceId);
    await refreshTtsState();
  };

  const handleDeleteVoice = async (voice: TtsVoiceListItem) => {
    const confirmed = await dialog.confirm(
      t.voice.settingsModal.ttsDeleteConfirm.replace('{name}', voice.label)
    );
    if (!confirmed) return;
    await window.api?.deleteTtsVoice?.(voice.id);
    await refreshTtsState();
  };

  const handleImportVoice = async () => {
    setIsImportingVoice(true);
    try {
      const res = await window.api?.importTtsVoice?.();
      if (res?.ok && res.voice) {
        showTtsNotice(t.voice.settingsModal.ttsImported.replace('{name}', res.voice.label || res.voice.id));
        voiceService.saveConfig({ ttsVoiceId: res.voice.id });
        setVoiceConfig(voiceService.getConfig());
      } else if (res && !res.ok && !res.canceled) {
        showTtsNotice(translateTtsError(res.errorCode, res.error));
      }
    } finally {
      setIsImportingVoice(false);
      await refreshTtsState();
    }
  };

  const handlePreviewVoice = async () => {
    if (isPreviewingVoice) return;
    setIsPreviewingVoice(true);
    try {
      await voiceService.speak(t.voice.settingsModal.ttsPreviewText, language === 'ru' ? 'ru' : 'en');
    } finally {
      setIsPreviewingVoice(false);
      // Прослушивание могло загрузить голос или упасть в системный движок — статус должен это отразить
      await refreshTtsState();
    }
  };

  useEffect(() => {
    if (!isOpen || activeTab !== 'recognition') return;
    if (voiceConfig.engine !== 'whisper' || voiceConfig.whisperProvider !== 'local') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const st = await refreshWhisperStatus();
      if (cancelled) return;
      // Пока модель грузится — опрашиваем чаще, иначе редко
      timer = setTimeout(tick, st?.status === 'loading' ? 1500 : 5000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, activeTab, voiceConfig.engine, voiceConfig.whisperProvider]);

  const loadDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const devs = await voiceService.getAvailableAudioDevices();
      setDevices(devs);
      setActiveMicLabel(voiceService.getActiveTrackLabel());
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleSelectInputDevice = async (deviceId: string) => {
    await voiceService.selectAudioInputDevice(deviceId);
    setVoiceConfig((c) => ({ ...c, audioInputDeviceId: deviceId }));
    setActiveMicLabel(voiceService.getActiveTrackLabel());
  };

  const handleSelectOutputDevice = async (deviceId: string) => {
    await voiceService.selectAudioOutputDevice(deviceId);
    setVoiceConfig((c) => ({ ...c, audioOutputDeviceId: deviceId }));
  };

  const handlePlayTestSound = async () => {
    if (isPlayingTest) return;
    setIsPlayingTest(true);
    await voiceService.playTestTone();
    setTimer(() => setIsPlayingTest(false), 600);
  };

  useEffect(() => {
    if (isOpen) {
      setVoiceConfig(voiceService.getConfig());
      setPhrasesMap(voiceService.getCommandPhrases());
      loadDevices();

      const unsubDevices = voiceService.onDevicesChange((devs) => {
        setDevices(devs);
        setActiveMicLabel(voiceService.getActiveTrackLabel());
      });

      const unsubAudio = voiceService.onAudioLevel((lvl) => {
        setAudioLevel(lvl);
      });

      const unsubNotice = voiceService.onDeviceNotice((n) => {
        showDeviceNotice(n.message);
        setActiveMicLabel(voiceService.getActiveTrackLabel());
      });

      return () => {
        unsubDevices();
        unsubAudio();
        unsubNotice();
      };
    }
  }, [isOpen, showDeviceNotice]);

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

  const handleResetDefaults = async () => {
    if (await dialog.confirm(t.voice.settingsModal.resetConfirm)) {
      const defaults = voiceService.resetCommandPhrases();
      setPhrasesMap(defaults);
      showResetSuccess(true);
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
    return t.voice.settingsModal.commandTitles[cmd.intent] || cmd.intent;
  };

  /**
   * Настройки горячей клавиши живут в main (`<userData>/voice-hotkey.json`), а не в localStorage:
   * main должен знать сочетание при старте, до загрузки окна. Проверку значения делает тот же
   * санитайзер, что и при чтении файла, поэтому UI просто сравнивает отправленное с принятым.
   */
  const savePushToTalk = async (patch: Partial<PushToTalkSettings>) => {
    const status = await window.api?.savePushToTalkSettings?.(patch);
    if (!status) return;
    setPttStatus(status);
    setAcceleratorDraft(status.settings.accelerator);
    setAcceleratorRejected(
      typeof patch.accelerator === 'string' && patch.accelerator.trim() !== status.settings.accelerator
    );
  };

  const wakePhrases = voiceConfig.wakeWordPhrases ?? [];

  const applyWakePhrases = (next: string[]) => {
    voiceService.saveConfig({ wakeWordPhrases: next });
    setVoiceConfig((c) => ({ ...c, wakeWordPhrases: next }));
  };

  const handleAddWakePhrase = () => {
    const value = newWakePhrase.trim().toLowerCase();
    setNewWakePhrase('');
    if (!value || wakePhrases.includes(value)) return;
    applyWakePhrases([...wakePhrases, value]);
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
              onClick={() => setActiveTab('devices')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'devices'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Headphones className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabDevices}</span>
            </button>

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
              onClick={() => setActiveTab('tts')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'tts'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Speech className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabTts}</span>
            </button>

            <button
              onClick={() => setActiveTab('dialog')}
              className={`flex items-center gap-2 py-3 px-3 text-xs font-semibold border-b-2 transition-all ${
                activeTab === 'dialog'
                  ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Keyboard className="w-4 h-4" />
              <span>{t.voice.settingsModal.tabDialog}</span>
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
              <span>{resetSuccess ? t.voice.settingsModal.resetDone : t.voice.settingsModal.resetDefaults}</span>
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 0: AUDIO DEVICES & HOT-PLUG                                */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'devices' && (
            <div className="space-y-4 text-xs">
              {/* Hotplug Notice Banner */}
              {deviceNotice && (
                <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 flex items-center gap-2.5 animate-in slide-in-from-top-2 duration-150">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-medium">{deviceNotice}</span>
                </div>
              )}

              {/* 1. Input Device (Microphone) */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Mic className="w-4 h-4" />
                    </div>
                    <span>{t.voice.settingsModal.deviceInputTitle}</span>
                  </div>
                  <button
                    type="button"
                    onClick={loadDevices}
                    disabled={isLoadingDevices}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/80 hover:bg-slate-800 transition disabled:opacity-50"
                    title={t.voice.settingsModal.deviceRefresh}
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                    <span>{t.voice.settingsModal.refreshList}</span>
                  </button>
                </div>

                <div>
                  <select
                    value={voiceConfig.audioInputDeviceId || ''}
                    onChange={(e) => handleSelectInputDevice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t.voice.settingsModal.deviceDefault}</option>
                    {devices.inputs.map((dev) => (
                      <option key={dev.deviceId} value={dev.deviceId}>
                        {dev.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Live Mic Level & Channel Indicator */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate">
                    <span className="text-slate-500">{t.voice.settingsModal.deviceActiveChannel}:</span>
                    <span className="font-mono text-indigo-300 truncate font-medium">
                      {activeMicLabel || (voiceConfig.audioInputDeviceId ? t.voice.settingsModal.deviceSelected : t.voice.settingsModal.deviceDefault)}
                    </span>
                  </div>

                  {/* VU-meter */}
                  <div className="flex items-center gap-1.5 shrink-0 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                    <span className="text-[10px] text-slate-500 font-mono">VU</span>
                    <div className="flex items-center gap-0.5 h-3">
                      {[1, 2, 3, 4, 5].map((barIdx) => {
                        const threshold = barIdx * 0.15;
                        const isLit = audioLevel >= threshold;
                        return (
                          <span
                            key={barIdx}
                            className={`w-1 rounded-full transition-all duration-75 ${
                              isLit
                                ? barIdx >= 4
                                  ? 'bg-amber-400 h-3.5'
                                  : 'bg-emerald-400 h-3'
                                : 'bg-slate-800 h-1.5'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Output Device (Headphones / Speakers) */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      <Headphones className="w-4 h-4" />
                    </div>
                    <span>{t.voice.settingsModal.deviceOutputTitle}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handlePlayTestSound}
                    disabled={isPlayingTest}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-300 hover:text-white px-2.5 py-1 rounded-lg bg-purple-950/40 border border-purple-500/30 hover:bg-purple-900/50 transition disabled:opacity-50"
                  >
                    <Volume2 className={`w-3.5 h-3.5 ${isPlayingTest ? 'animate-bounce text-purple-400' : ''}`} />
                    <span>{isPlayingTest ? t.voice.settingsModal.playingSignal : t.voice.settingsModal.deviceTestSound}</span>
                  </button>
                </div>

                <div>
                  <select
                    value={voiceConfig.audioOutputDeviceId || ''}
                    onChange={(e) => handleSelectOutputDevice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t.voice.settingsModal.deviceDefault}</option>
                    {devices.outputs.map((dev) => (
                      <option key={dev.deviceId} value={dev.deviceId}>
                        {dev.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. Automatic Headset Hotplug Switching */}
              <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-semibold text-white flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>{t.voice.settingsModal.hotplugTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed max-w-xl">
                    {t.voice.settingsModal.hotplugDesc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !voiceConfig.autoSwitchOnDeviceChange;
                    voiceService.saveConfig({ autoSwitchOnDeviceChange: next });
                    setVoiceConfig((c) => ({ ...c, autoSwitchOnDeviceChange: next }));
                  }}
                  className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                    voiceConfig.autoSwitchOnDeviceChange ? 'bg-emerald-600 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                </button>
              </div>
            </div>
          )}

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
                    {t.voice.settingsModal.customTriggers}
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
                      { id: 'approval', label: t.voice.settingsModal.categoryApproval },
                      { id: 'dialog', label: t.voice.settingsModal.categoryDialog }
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
                    placeholder={t.voice.settingsModal.searchCommandsPlaceholder}
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
                    {t.voice.settingsModal.noCommandsFound}
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
                            {phrases.length} {t.voice.settingsModal.phrasesCount}
                          </span>
                        </div>

                        {/* Current Phrases Tags */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {phrases.map((phrase) => {
                            const isHighlight =
                              cmd.intent === 'navigate_ai' &&
                              ['chat', '\u0447\u0430\u0442', '\u0447\u0435\u0442', '\u0447\u0430\u0434', '\u0447\u044f\u0442'].includes(phrase.toLowerCase());

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
                                  title={t.voice.settingsModal.removePhraseTitle.replace('{phrase}', phrase)}
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
                    {t.voice.settingsModal.continuousHandsFree}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 max-w-lg">
                    {t.voice.settingsModal.continuousHandsFreeDesc}
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
                  <span>{t.voice.settingsModal.vadSilenceThreshold}</span>
                  <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                    {voiceConfig.vadSilenceThresholdMs} ms
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
                  <span>{t.voice.settingsModal.vadFast}</span>
                  <span>{t.voice.settingsModal.vadBalanced}</span>
                  <span>{t.voice.settingsModal.vadLong}</span>
                </div>
              </div>

              {/* Recognition Engine: Whisper pipeline vs browser Web Speech API */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <label className="block text-slate-300 font-semibold mb-1.5">
                  {t.voice.settingsModal.recognitionEngine}
                </label>
                <select
                  value={voiceConfig.engine}
                  onChange={(e) => {
                    const engine = e.target.value as VoiceEngine;
                    const wasListening = voiceService.isListening;
                    if (wasListening) voiceService.stopListening();
                    voiceService.saveConfig({ engine });
                    setVoiceConfig((c) => ({ ...c, engine }));
                    if (wasListening) void voiceService.startHandsFreeListening();
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="whisper">
                    {t.voice.settingsModal.engineWhisperOption}
                  </option>
                  <option value="webspeech" disabled={!voiceService.isWebSpeechAvailable}>
                    {t.voice.settingsModal.engineWebSpeechOption}{voiceService.isWebSpeechAvailable ? '' : ' — N/A'}
                  </option>
                </select>
                {voiceConfig.engine === 'webspeech' && (
                  <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      {t.voice.settingsModal.engineWebSpeechDesc}
                    </span>
                  </div>
                )}
              </div>

              {/* Whisper Provider */}
              {voiceConfig.engine === 'whisper' && (
              <div className="space-y-3 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    {t.voice.settingsModal.whisperProviderLabel}
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
                      {t.voice.settingsModal.whisperLocalWorkerOption}
                    </option>
                    <option value="groq">Groq Whisper (whisper-large-v3, ~150ms)</option>
                    <option value="openai">OpenAI Whisper (whisper-1)</option>
                  </select>
                </div>

                {voiceConfig.whisperProvider === 'local' && (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>
                        {t.voice.settingsModal.whisperLocalWorkerNotice}
                      </span>
                    </div>

                    {/* Model status + warm-up */}
                    <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        {whisperStatus?.status === 'ready' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : whisperStatus?.status === 'loading' ? (
                          <RefreshCw className="w-4 h-4 text-indigo-400 shrink-0 animate-spin" />
                        ) : whisperStatus?.status === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : (
                          <Radio className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-slate-200 font-semibold truncate">
                            {t.voice.settingsModal.whisperModelLabel}: {whisperStatus?.model || voiceConfig.whisperModel}
                          </div>
                          <div className="text-slate-400 truncate">
                            {whisperStatus?.status === 'ready'
                              ? t.voice.settingsModal.whisperReady +
                                (whisperStatus.loadTimeMs ? ` (${(whisperStatus.loadTimeMs / 1000).toFixed(1)} s)` : '')
                              : whisperStatus?.status === 'loading'
                              ? t.voice.settingsModal.whisperLoading
                              : whisperStatus?.status === 'error'
                              ? t.voice.settingsModal.whisperError + (whisperStatus.error || '')
                              : t.voice.settingsModal.whisperNotLoaded}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleWarmupWhisper()}
                        disabled={isWarmingUp || whisperStatus?.status === 'loading' || whisperStatus?.status === 'ready'}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white font-semibold shrink-0 transition"
                      >
                        {t.voice.settingsModal.whisperWarmup}
                      </button>
                    </div>
                  </div>
                )}

                {/* API Key */}
                {voiceConfig.whisperProvider !== 'local' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      {t.voice.settingsModal.apiKeyLabel} {voiceConfig.whisperProvider === 'groq' ? 'Groq' : 'OpenAI'}
                    </label>
                    <input
                      type="password"
                      value={voiceConfig.whisperApiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        voiceService.saveConfig({ whisperApiKey: val });
                        setVoiceConfig((c) => ({ ...c, whisperApiKey: val }));
                      }}
                      placeholder={t.voice.settingsModal.apiKeyPlaceholder}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>{t.voice.settingsModal.apiKeySafeNotice}</span>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 3: LOCAL NEURAL TTS (PIPER VOICES)                        */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'tts' && (
            <div className="space-y-4 text-xs">
              {ttsNotice && (
                <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span className="font-medium">{ttsNotice}</span>
                </div>
              )}

              {/* Выбор движка озвучки */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                <label className="block text-slate-300 font-semibold mb-1.5">
                  {t.voice.settingsModal.ttsEngineLabel}
                </label>
                <select
                  value={voiceConfig.ttsEngine}
                  onChange={(e) => {
                    const ttsEngine = e.target.value as 'system' | 'piper';
                    void voiceService.stopSpeaking();
                    voiceService.saveConfig({ ttsEngine });
                    setVoiceConfig((c) => ({ ...c, ttsEngine }));
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="system">{t.voice.settingsModal.ttsEngineSystem}</option>
                  <option value="piper">{t.voice.settingsModal.ttsEnginePiper}</option>
                </select>

                {voiceConfig.ttsEngine === 'piper' && (
                  <>
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-start gap-2">
                      <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{t.voice.settingsModal.ttsEngineHint}</span>
                    </div>

                    {/* Статус движка: причина недоступности или ошибки голоса видна сразу (AC#7) */}
                    <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2 text-[11px]">
                      {ttsStatusView.kind === 'ready' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : ttsStatusView.kind === 'loading' ? (
                        <RefreshCw className="w-4 h-4 text-indigo-400 shrink-0 animate-spin" />
                      ) : ttsStatusView.kind === 'unavailable' || ttsStatusView.kind === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      ) : (
                        <Radio className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                      <span className="text-slate-300 min-w-0 truncate">
                        {ttsStatusView.kind === 'ready'
                          ? t.voice.settingsModal.ttsStatusReady +
                            (ttsStatusView.loadTimeSec !== null ? ` (${ttsStatusView.loadTimeSec.toFixed(1)} s)` : '')
                          : ttsStatusView.kind === 'loading'
                          ? t.voice.settingsModal.ttsStatusLoading
                          : ttsStatusView.kind === 'unavailable'
                          ? `${t.voice.settingsModal.ttsStatusUnavailable}: ${translateTtsError(ttsStatusView.errorCode, ttsStatusView.error)}`
                          : ttsStatusView.kind === 'error'
                          ? `${t.voice.settingsModal.ttsStatusVoiceError}: ${translateTtsError(ttsStatusView.errorCode, ttsStatusView.error)}`
                          : t.voice.settingsModal.ttsStatusNotLoaded}
                      </span>
                    </div>

                    {ttsStatus && !ttsStatus.espeakDataInstalled && (
                      <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <span>{t.voice.settingsModal.ttsEspeakMissing}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Каталог голосов */}
              {voiceConfig.ttsEngine === 'piper' && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        <Speech className="w-4 h-4" />
                      </div>
                      <span>{t.voice.settingsModal.ttsVoiceLabel}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleImportVoice()}
                      disabled={isImportingVoice}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-300 hover:text-white px-2.5 py-1 rounded-lg bg-purple-950/40 border border-purple-500/30 hover:bg-purple-900/50 transition disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{t.voice.settingsModal.ttsImport}</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {ttsVoices.length === 0 && (
                      <div className="p-4 text-center text-slate-500 text-[11px] bg-slate-900/40 rounded-lg border border-slate-800">
                        {t.voice.settingsModal.ttsNoVoices}
                      </div>
                    )}

                    {ttsVoices.map((voice) => {
                      const progress = ttsProgress[voice.id];
                      const isBusy = Boolean(progress && progress.phase !== 'done') || voice.downloading;
                      // totalBytes = 0 означает «размер неизвестен» (ответ без Content-Length):
                      // показываем скачанные мегабайты, а не выдуманные проценты (TASK-87, дефект 6)
                      const hasPercent = Boolean(progress && progress.totalBytes > 0);
                      const percent =
                        hasPercent && progress
                          ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
                          : 0;
                      const downloadedLabel = hasPercent
                        ? `${percent}%`
                        : `${Math.round((progress?.receivedBytes ?? 0) / 1048576)} MB`;
                      const isSelected = voiceConfig.ttsVoiceId === voice.id;

                      return (
                        <div
                          key={voice.id}
                          className={`p-3 rounded-lg border transition flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-indigo-950/30 border-indigo-500/40'
                              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                            <input
                              type="radio"
                              name="tts-voice"
                              checked={isSelected}
                              disabled={!voice.installed}
                              onChange={() => handleSelectTtsVoice(voice.id)}
                              className="accent-indigo-500 shrink-0 disabled:opacity-40"
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-white truncate">{voice.label}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono uppercase">
                                  {voice.language}
                                </span>
                                {voice.source === 'imported' && (
                                  <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-[10px] text-purple-300 border border-purple-500/30">
                                    {t.voice.settingsModal.ttsSourceImported}
                                  </span>
                                )}
                              </span>
                              <span className="block text-[10px] text-slate-500 truncate mt-0.5">
                                {isBusy
                                  ? progress?.phase === 'verify'
                                    ? t.voice.settingsModal.ttsDownloadVerify
                                    : progress?.phase === 'extract'
                                    ? t.voice.settingsModal.ttsDownloadExtract
                                    : `${t.voice.settingsModal.ttsDownloading} ${downloadedLabel}`
                                  : voice.installed
                                  ? `${t.voice.settingsModal.ttsVoiceInstalled}${
                                      voice.sizeBytes ? ` · ${Math.round(voice.sizeBytes / 1048576)} MB` : ''
                                    }`
                                  : `${t.voice.settingsModal.ttsVoiceNotInstalled}${
                                      voice.archiveBytes ? ` · ${Math.round(voice.archiveBytes / 1048576)} MB` : ''
                                    }`}
                              </span>
                            </span>
                          </label>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isBusy ? (
                              <button
                                type="button"
                                onClick={() => void handleCancelVoiceDownload(voice.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                              >
                                {t.voice.settingsModal.ttsCancelDownload}
                              </button>
                            ) : voice.installed ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteVoice(voice)}
                                title={t.voice.settingsModal.ttsDelete}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleDownloadVoice(voice.id)}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>{t.voice.settingsModal.ttsDownload}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Скорость, громкость и прослушивание */}
              {voiceConfig.ttsEngine === 'piper' && (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-slate-300 font-semibold">
                      <span>{t.voice.settingsModal.ttsSpeed}</span>
                      <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        {voiceConfig.ttsSpeed.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.05"
                      value={voiceConfig.ttsSpeed}
                      onChange={(e) => {
                        const ttsSpeed = Number(e.target.value);
                        voiceService.saveConfig({ ttsSpeed });
                        setVoiceConfig((c) => ({ ...c, ttsSpeed }));
                      }}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-slate-300 font-semibold">
                      <span>{t.voice.settingsModal.ttsVolume}</span>
                      <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        {Math.round(voiceConfig.ttsVolume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={voiceConfig.ttsVolume}
                      onChange={(e) => {
                        const ttsVolume = Number(e.target.value);
                        voiceService.saveConfig({ ttsVolume });
                        setVoiceConfig((c) => ({ ...c, ttsVolume }));
                      }}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {t.voice.settingsModal.ttsImportHint}
                    </p>
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      disabled={isPreviewingVoice}
                      className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold transition"
                    >
                      <Play className={`w-3.5 h-3.5 ${isPreviewingVoice ? 'animate-pulse' : ''}`} />
                      <span>{t.voice.settingsModal.ttsPreview}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 4: DIALOG, PUSH-TO-TALK, WAKE WORD & DICTATION            */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'dialog' && (
            <div className="space-y-4 text-xs">
              {/* Глобальный push-to-talk */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        <Keyboard className="w-4 h-4" />
                      </div>
                      <span>{t.voice.settingsModal.pttTitle}</span>
                      {pttStatus?.recording && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-[10px] text-rose-300 border border-rose-500/40 animate-pulse">
                          {t.voice.settingsModal.pttRecordingNow}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                      {t.voice.settingsModal.pttDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void savePushToTalk({ enabled: !(pttStatus?.settings.enabled ?? true) })}
                    title={t.voice.settingsModal.pttEnable}
                    className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                      pttStatus?.settings.enabled ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    {t.voice.settingsModal.pttHotkey}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={acceleratorDraft}
                      onChange={(e) => {
                        setAcceleratorDraft(e.target.value);
                        setAcceleratorRejected(false);
                      }}
                      onBlur={() => {
                        if (acceleratorDraft.trim() && acceleratorDraft.trim() !== pttStatus?.settings.accelerator) {
                          void savePushToTalk({ accelerator: acceleratorDraft.trim() });
                        }
                      }}
                      placeholder={t.voice.settingsModal.pttHotkeyHint}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                    {acceleratorRejected ? (
                      <span className="text-rose-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {t.voice.settingsModal.pttHotkeyInvalid}
                      </span>
                    ) : pttStatus?.settings.enabled && !pttStatus.registered ? (
                      <span className="text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {t.voice.settingsModal.pttHotkeyTaken}
                      </span>
                    ) : pttStatus?.registered ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {t.voice.settingsModal.pttHotkeyOk}
                      </span>
                    ) : (
                      <span className="text-slate-500">{t.voice.settingsModal.pttHotkeyHint}</span>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">{t.voice.settingsModal.pttMode}</label>
                  <select
                    value={pttStatus?.settings.mode ?? 'toggle'}
                    onChange={(e) => void savePushToTalk({ mode: e.target.value as PushToTalkSettings['mode'] })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="hold" disabled={pttStatus ? !pttStatus.supportsHold : false}>
                      {t.voice.settingsModal.pttModeHold}
                    </option>
                    <option value="toggle">{t.voice.settingsModal.pttModeToggle}</option>
                  </select>
                  {pttStatus && !pttStatus.supportsHold && (
                    <div className="mt-1.5 text-[10px] text-slate-500">
                      {t.voice.settingsModal.pttModeHoldUnavailable}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-4 pt-1">
                  <span className="text-slate-300 font-semibold">{t.voice.settingsModal.pttTray}</span>
                  <button
                    type="button"
                    onClick={() => void savePushToTalk({ trayIndicator: !(pttStatus?.settings.trayIndicator ?? true) })}
                    className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                      pttStatus?.settings.trayIndicator ? 'bg-emerald-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Ключевое слово */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-white flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        <Radio className="w-4 h-4" />
                      </div>
                      <span>{t.voice.settingsModal.wakeWordTitle}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                      {t.voice.settingsModal.wakeWordDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !voiceConfig.wakeWordEnabled;
                      voiceService.saveConfig({ wakeWordEnabled: next });
                      setVoiceConfig((c) => ({ ...c, wakeWordEnabled: next }));
                    }}
                    className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                      voiceConfig.wakeWordEnabled ? 'bg-purple-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    {t.voice.settingsModal.wakeWordPhrases}
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {wakePhrases.map((phrase) => (
                      <span
                        key={phrase}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border bg-slate-900/90 text-slate-200 border-slate-700/70 hover:border-purple-500/50 transition"
                      >
                        <span>«{phrase}»</span>
                        <button
                          type="button"
                          onClick={() => applyWakePhrases(wakePhrases.filter((p) => p !== phrase))}
                          className="p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition"
                          title={t.voice.settingsModal.removePhraseTitle.replace('{phrase}', phrase)}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="text"
                        value={newWakePhrase}
                        onChange={(e) => setNewWakePhrase(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddWakePhrase();
                          }
                        }}
                        placeholder={t.voice.settingsModal.wakeWordAddPlaceholder}
                        className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700/80 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 w-44"
                      />
                      <button
                        type="button"
                        onClick={handleAddWakePhrase}
                        disabled={!newWakePhrase.trim()}
                        className="p-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600 text-white transition"
                        title={t.voice.settingsModal.addPhraseButton}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Диалог: озвучка ответов, вопросов и перебивание */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
                {(
                  [
                    {
                      key: 'speakAgentAnswers' as const,
                      title: t.voice.settingsModal.dialogSpeakTitle,
                      desc: t.voice.settingsModal.dialogSpeakDesc,
                      on: voiceConfig.speakAgentAnswers === true
                    },
                    {
                      key: 'speakHitlQuestions' as const,
                      title: t.voice.settingsModal.dialogHitlTitle,
                      desc: t.voice.settingsModal.dialogHitlDesc,
                      on: voiceConfig.speakHitlQuestions === true
                    },
                    {
                      key: 'bargeInEnabled' as const,
                      title: t.voice.settingsModal.bargeInTitle,
                      desc: t.voice.settingsModal.bargeInDesc,
                      on: voiceConfig.bargeInEnabled !== false
                    }
                  ]
                ).map((row) => (
                  <div key={row.key} className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-semibold text-white flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-emerald-400" />
                        <span>{row.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">{row.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !row.on;
                        voiceService.saveConfig({ [row.key]: next });
                        setVoiceConfig((c) => ({ ...c, [row.key]: next }));
                      }}
                      className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                        row.on ? 'bg-emerald-600 justify-end' : 'bg-slate-800 justify-start'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Системная диктовка */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="space-y-1">
                  <div className="font-semibold text-white flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Keyboard className="w-4 h-4" />
                    </div>
                    <span>{t.voice.settingsModal.dictationTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                    {t.voice.settingsModal.dictationDesc}
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4 pt-1">
                  <div className="space-y-1">
                    <div className="text-slate-300 font-semibold">
                      {t.voice.settingsModal.dictationPunctuationTitle}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
                      {t.voice.settingsModal.dictationPunctuationDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !voiceConfig.dictationPunctuation;
                      voiceService.saveConfig({ dictationPunctuation: next });
                      setVoiceConfig((c) => ({ ...c, dictationPunctuation: next }));
                    }}
                    className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                      voiceConfig.dictationPunctuation ? 'bg-amber-600 justify-end' : 'bg-slate-800 justify-start'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                  </button>
                </div>
              </div>

              {/* Разбор свободных команд моделью */}
              <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-semibold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>{t.voice.settingsModal.llmFallbackTitle}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed max-w-xl">
                    {t.voice.settingsModal.llmFallbackDesc}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = voiceConfig.llmFallbackEnabled === false;
                    voiceService.saveConfig({ llmFallbackEnabled: next });
                    setVoiceConfig((c) => ({ ...c, llmFallbackEnabled: next }));
                  }}
                  className={`w-12 h-6 rounded-full transition p-0.5 flex items-center shrink-0 ${
                    voiceConfig.llmFallbackEnabled !== false ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                </button>
              </div>
            </div>
          )}

          {/* ───────────────────────────────────────────────────────────── */}
          {/* TAB 5: CHEAT SHEET & QUICK REFERENCE                          */}
          {/* ───────────────────────────────────────────────────────────── */}
          {activeTab === 'cheatsheet' && (
            <div className="space-y-3 text-xs">
              <div className="p-4 rounded-xl bg-indigo-950/20 border border-indigo-900/40 space-y-3">
                <div className="font-bold text-indigo-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  {t.voice.settingsModal.keyPatternsTitle}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-300">
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">{t.voice.settingsModal.cheatTabsLabel}</span>
                    <p className="text-[11px] text-slate-400">
                      {t.voice.settingsModal.cheatTabsExamples}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">{t.voice.settingsModal.cheatProjectsLabel}</span>
                    <p className="text-[11px] text-slate-400">
                      {t.voice.settingsModal.cheatProjectsExamples}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">{t.voice.settingsModal.cheatPanelsLabel}</span>
                    <p className="text-[11px] text-slate-400">
                      {t.voice.settingsModal.cheatPanelsExamples}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950/50 border border-slate-800 space-y-1">
                    <span className="font-semibold text-white">{t.voice.settingsModal.cheatAiLabel}</span>
                    <p className="text-[11px] text-slate-400">
                      {t.voice.settingsModal.cheatAiExamples}
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
            {t.voice.settingsModal.instantSaveHint}
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
