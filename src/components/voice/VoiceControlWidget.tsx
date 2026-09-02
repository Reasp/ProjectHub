import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Settings2,
  Sparkles,
  Zap,
  Activity,
  Check,
  CheckCircle2,
  Sliders,
  ShieldCheck
} from 'lucide-react';
import {
  voiceService,
  type VoiceState,
  type VoiceConfig,
  type WhisperProvider
} from '../../services/voiceService';
import { parseVoiceCommand } from '../../services/voiceCommandParser';
import { useProjectStore } from '../../store/useProjectStore';
import { useAIStudioStore } from '../../store/useAIStudioStore';

export const VoiceControlWidget: React.FC = () => {
  const {
    projects,
    selectedProject,
    selectProject,
    activeTab,
    setActiveTab,
    toggleTerminal,
    startProcessAction,
    stopProcessAction,
    processes,
    language
  } = useProjectStore();

  const {
    sessions,
    activeSessionId,
    createSession,
    switchSession,
    sendMessage,
    pendingApprovals,
    sendApprovalResponse
  } = useAIStudioStore();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isSpeakingDetected, setIsSpeakingDetected] = useState<boolean>(false);
  const [transcript, setTranscript] = useState('');
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());
  const [workerReady, setWorkerReady] = useState<boolean>(false);

  useEffect(() => {
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');
    setVoiceConfig(voiceService.getConfig());

    // Check worker status
    if (window.api?.getLocalWhisperStatus) {
      window.api.getLocalWhisperStatus().then((st) => {
        setWorkerReady(st.status === 'ready');
      }).catch(() => {});
    }

    voiceService.onStateChange((state: VoiceState) => {
      setVoiceState(state);
    });

    voiceService.onAudioLevel((level: number, speaking: boolean) => {
      setAudioLevel(level);
      setIsSpeakingDetected(speaking);
    });

    voiceService.onResult((text: string, isFinal: boolean) => {
      setTranscript(text);

      if (isFinal && text.trim()) {
        executeCommand(text.trim());
      }
    });

    // Global Hotkey: Ctrl + Shift + V for Talon Voice Hands-Free Toggle
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        voiceService.toggleHandsFree();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [language, selectedProject, projects, sessions, activeSessionId, pendingApprovals]);

  const executeCommand = async (rawText: string) => {
    const cmd = parseVoiceCommand(rawText);
    setLastFeedback(cmd.feedbackText);

    if (voiceConfig.ttsEnabled) {
      voiceService.speak(cmd.feedbackText, language === 'ru' ? 'ru' : 'en');
    }

    // ─────────────────────────────────────────────────────────────
    // 1. AI CONTROL (Studio Tabs, Sessions, Prompts, Approvals)
    // ─────────────────────────────────────────────────────────────
    if (cmd.type === 'ai_control') {
      const projectPath = selectedProject?.path;

      // A. Create new AI Session
      if (cmd.intent === 'create_ai_session' && projectPath) {
        setActiveTab('ai');
        createSession(projectPath);
      }

      // B. Switch Studio Tab / Session by index (0, 1, 2...)
      else if (cmd.intent === 'switch_ai_session' && projectPath) {
        setActiveTab('ai');
        const projectSessions = sessions[projectPath] || [];
        const targetIdx = cmd.payload?.sessionIndex ?? 0;
        if (projectSessions[targetIdx]) {
          switchSession(projectPath, projectSessions[targetIdx].id);
        } else if (projectSessions.length > 0) {
          switchSession(projectPath, projectSessions[0].id);
        }
      }

      // C. Send / Dictate Prompt
      else if (cmd.intent === 'send_prompt' && projectPath) {
        setActiveTab('ai');
        const promptText = cmd.payload?.text;
        if (promptText) {
          await sendMessage(projectPath, promptText);
        }
      }

      // D. Human-in-the-Loop Approvals (Approve / Reject / Option Select)
      else if (projectPath) {
        const activeApprovals = pendingApprovals[projectPath] || [];
        const topApproval = activeApprovals[0];

        if (cmd.intent === 'agent_approve') {
          if (topApproval) {
            await sendApprovalResponse(projectPath, topApproval.id, true);
          }
        } else if (cmd.intent === 'agent_reject') {
          if (topApproval) {
            await sendApprovalResponse(projectPath, topApproval.id, false);
          }
        } else if (cmd.intent === 'agent_select_option' && topApproval?.questionData) {
          const optIdx = cmd.payload?.optionIndex ?? 0;
          const options = topApproval.questionData.options || [];
          if (options[optIdx]) {
            await sendApprovalResponse(projectPath, topApproval.id, true, options[optIdx].label);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. PROJECT NAVIGATION (Fuzzy Search & Select)
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'navigation' && cmd.intent === 'navigate_project') {
      const query = (cmd.payload?.projectName || '').toLowerCase().trim();
      if (query && projects.length > 0) {
        const matched = projects.find((p) => {
          const pName = p.name.toLowerCase();
          const pPath = p.path.toLowerCase();
          return pName === query || pName.includes(query) || query.includes(pName) || pPath.includes(query);
        });

        if (matched) {
          selectProject(matched);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. MAIN TAB NAVIGATION
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'navigation') {
      if (cmd.intent === 'toggle_terminal') {
        toggleTerminal();
      } else if (cmd.payload) {
        setActiveTab(cmd.payload);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION RUNNER
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'action') {
      if (!selectedProject) return;

      if (cmd.intent === 'run_dev') {
        await startProcessAction('npm run dev', 'dev');
      } else if (cmd.intent === 'stop_dev') {
        const p = processes.find((proc) => proc.status === 'running' && proc.name === 'dev');
        if (p) await stopProcessAction(p.id);
      } else if (cmd.intent === 'run_deploy') {
        await startProcessAction('npm run deploy', 'deploy');
      } else if (cmd.intent === 'run_tests') {
        await startProcessAction('npm test', 'test');
      }
    }

    setTimeout(() => {
      setTranscript('');
      setLastFeedback(null);
    }, 4500);
  };

  const isHandsFreeActive = voiceService.isListening;
  const isSpeech = voiceState === 'speech_detected';
  const isTranscribing = voiceState === 'transcribing';

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 select-none">
        {/* Talon Voice Floating Live HUD Pill */}
        {isHandsFreeActive && (
          <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-slate-900/95 border border-indigo-500/50 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-200">
            {/* Audio Wave Visualizer Bars */}
            <div className="flex items-center gap-0.5 h-3.5 px-1 bg-slate-950/80 rounded-md border border-slate-800">
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 14)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(4, audioLevel * 18)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 12)}px` }}
              />
            </div>

            {/* Status Indicator */}
            <div className="flex items-center gap-1.5 text-xs font-medium max-w-sm truncate">
              {isTranscribing ? (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">⚡ Whisper инференс...</span>
                </>
              ) : isSpeech ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <span className="text-emerald-300 font-semibold">Слушаю речь...</span>
                </>
              ) : lastFeedback ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="text-indigo-200">{lastFeedback}</span>
                </>
              ) : transcript ? (
                <>
                  <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse shrink-0" />
                  <span className="text-slate-200">«{transcript}»</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                  <span className="text-slate-300">Talon Voice (Hands-Free)</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Talon Mic Master Button */}
        <div className="relative flex items-center">
          {isHandsFreeActive && (
            <span
              className={`absolute -inset-1 rounded-full animate-ping ${
                isSpeech ? 'bg-emerald-500/40' : 'bg-indigo-500/30'
              }`}
            />
          )}
          <button
            onClick={() => voiceService.toggleHandsFree()}
            className={`relative p-3 rounded-full shadow-2xl transition transform active:scale-95 flex items-center justify-center ${
              isSpeech
                ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/40'
                : isTranscribing
                ? 'bg-amber-600 text-white ring-2 ring-amber-500/40'
                : isHandsFreeActive
                ? 'bg-indigo-600 text-white ring-4 ring-indigo-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white ring-1 ring-slate-700'
            }`}
            title={
              isHandsFreeActive
                ? 'Talon Voice активен (Hands-Free). Кликните для отключения'
                : 'Включить непрерывный Hands-Free режим (Ctrl+Shift+V)'
            }
          >
            {isHandsFreeActive ? <Mic className="w-5 h-5 animate-pulse" /> : <MicOff className="w-5 h-5" />}
          </button>
        </div>

        {/* TTS Toggle Button */}
        <button
          onClick={() => {
            const next = !voiceConfig.ttsEnabled;
            voiceService.saveConfig({ ttsEnabled: next });
            setVoiceConfig((prev) => ({ ...prev, ttsEnabled: next }));
          }}
          className={`p-2.5 rounded-xl text-xs transition border ${
            voiceConfig.ttsEnabled
              ? 'bg-slate-900/90 border-slate-700/70 text-indigo-400 hover:bg-slate-800'
              : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:text-slate-300'
          }`}
          title={voiceConfig.ttsEnabled ? 'Озвучка ответов включена' : 'Озвучка ответов выключена'}
        >
          {voiceConfig.ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Voice Settings Gear Button */}
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2.5 rounded-xl text-xs transition bg-slate-900/90 border border-slate-700/70 text-slate-400 hover:text-white hover:bg-slate-800"
          title="Настройки Talon Voice и Whisper"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>

      {/* Voice Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 font-sans">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Mic className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Настройки Talon Voice & Whisper</h3>
                  <p className="text-[11px] text-slate-400">Многопоточный конвейер Hands-Free</p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Hands-Free Talon Toggle */}
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-indigo-400" />
                    Непрерывный Hands-Free режим
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Не требует нажатия кнопок: звук пишется и нарезается на лету.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !voiceConfig.handsFree;
                    voiceService.saveConfig({ handsFree: next });
                    setVoiceConfig((c) => ({ ...c, handsFree: next }));
                  }}
                  className={`w-11 h-6 rounded-full transition p-0.5 flex items-center ${
                    voiceConfig.handsFree ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* VAD Silence Threshold Slider */}
              <div>
                <div className="flex items-center justify-between mb-1 text-slate-300 font-semibold">
                  <span>Чувствительность паузы тишины (VAD)</span>
                  <span className="font-mono text-indigo-400">{voiceConfig.vadSilenceThresholdMs} мс</span>
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
                <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                  <span>Быстро (300мс)</span>
                  <span>Баланс (480мс)</span>
                  <span>Длинные паузы (1000мс)</span>
                </div>
              </div>

              {/* Whisper Provider */}
              <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Движок распознавания</label>
                  <select
                    value={voiceConfig.whisperProvider}
                    onChange={(e) => {
                      const prov = e.target.value as WhisperProvider;
                      const model = prov === 'openai' ? 'whisper-1' : prov === 'groq' ? 'whisper-large-v3' : 'Xenova/whisper-base';
                      voiceService.saveConfig({ whisperProvider: prov, whisperModel: model });
                      setVoiceConfig((c) => ({ ...c, whisperProvider: prov, whisperModel: model }));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="local">Встроенный локальный Whisper (Изолированный Worker поток, 100% офлайн)</option>
                    <option value="groq">Groq Whisper (whisper-large-v3, облачный ~150мс)</option>
                    <option value="openai">OpenAI Whisper (whisper-1, облачный)</option>
                  </select>
                </div>

                {voiceConfig.whisperProvider === 'local' && (
                  <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Инференс работает в отдельном потоке worker_threads без нагрузки на UI.</span>
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

              {/* Supported Voice Commands Cheat Sheet */}
              <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-[11px] space-y-1.5 text-slate-300">
                <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Hands-Free команды (говорите вслух):
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><strong className="text-slate-200">«Перейди на проект [Имя]»</strong> — переключение проекта</li>
                  <li><strong className="text-slate-200">«Открой студию»</strong> — вход в Claude Studio</li>
                  <li><strong className="text-slate-200">«Вкладка 1/2/3»</strong>, <strong className="text-slate-200">«Новый диалог»</strong> — сессии</li>
                  <li><strong className="text-slate-200">«Промпт [Текст]»</strong> — диктовка и отправка агенту</li>
                  <li><strong className="text-slate-200">«Принять» / «Отклонить»</strong>, <strong className="text-slate-200">«Вариант 1/2»</strong> — выбор в диалогах</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
