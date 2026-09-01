import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Settings2,
  Sparkles,
  Zap,
  CheckCircle2,
  XCircle,
  FolderGit2,
  Layers,
  MessageSquarePlus,
  Bot
} from 'lucide-react';
import {
  voiceService,
  type VoiceState,
  type VoiceConfig,
  type VoiceEngine,
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
  const [transcript, setTranscript] = useState('');
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());

  useEffect(() => {
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');
    setVoiceConfig(voiceService.getConfig());

    voiceService.onStateChange((state: VoiceState) => {
      setVoiceState(state);
    });

    voiceService.onResult((text: string, isFinal: boolean) => {
      setTranscript(text);

      if (isFinal && text.trim()) {
        executeCommand(text.trim());
      }
    });

    // Global Hotkey: Ctrl + Shift + V for Voice Toggle
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        voiceService.toggleListening();
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
        // Find best matching project
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
    // 4. ACTION RUNNER (Run Dev, Stop Dev, Deploy, Test)
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

  const isRecording = voiceState === 'recording' || voiceState === 'listening';
  const isTranscribing = voiceState === 'transcribing';

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 select-none">
        {/* Floating Live Transcript / Feedback Pill */}
        {(transcript || lastFeedback || isTranscribing) && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-slate-900/95 border border-indigo-500/50 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-3 duration-200">
            {isTranscribing ? (
              <Zap className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
            ) : (
              <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse shrink-0" />
            )}
            <span className="text-xs font-medium text-slate-200 truncate max-w-sm">
              {isTranscribing
                ? '⚡ Обработка Whisper STT...'
                : lastFeedback
                ? `✓ ${lastFeedback}`
                : `«${transcript}»`}
            </span>
          </div>
        )}

        {/* Mic Trigger Button */}
        <div className="relative flex items-center">
          {isRecording && (
            <span className="absolute -inset-1 rounded-full bg-rose-500/40 animate-ping" />
          )}
          <button
            onClick={() => voiceService.toggleListening()}
            className={`relative p-3 rounded-full shadow-2xl transition transform active:scale-95 flex items-center justify-center ${
              isRecording
                ? 'bg-rose-600 text-white ring-4 ring-rose-500/40'
                : isTranscribing
                ? 'bg-amber-600 text-white ring-2 ring-amber-500/30'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white ring-2 ring-indigo-500/30'
            }`}
            title={
              isRecording
                ? 'Идет запись речи... Кликните для завершения (Whisper)'
                : 'Голосовое управление Whisper (Ctrl+Shift+V)'
            }
          >
            {isRecording ? (
              <Mic className="w-5 h-5 animate-pulse" />
            ) : isTranscribing ? (
              <Zap className="w-5 h-5 animate-bounce" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
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
          title="Настройки голосового ввода Whisper"
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
                  <h3 className="text-sm font-bold text-white">Настройки голосового управления</h3>
                  <p className="text-[11px] text-slate-400">Движок распознавания речи и Whisper STT</p>
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
              {/* Engine Selection */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Движок распознавания</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      voiceService.saveConfig({ engine: 'whisper' });
                      setVoiceConfig((c) => ({ ...c, engine: 'whisper' }));
                    }}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition ${
                      voiceConfig.engine === 'whisper'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white font-medium ring-1 ring-indigo-500/40'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-white">Whisper (AI)</div>
                      <div className="text-[10px] text-slate-400">Высокая точность</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      voiceService.saveConfig({ engine: 'webspeech' });
                      setVoiceConfig((c) => ({ ...c, engine: 'webspeech' }));
                    }}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition ${
                      voiceConfig.engine === 'webspeech'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white font-medium ring-1 ring-indigo-500/40'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Mic className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-white">Web Speech API</div>
                      <div className="text-[10px] text-slate-400">Встроенный движок</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Whisper Provider */}
              {voiceConfig.engine === 'whisper' && (
                <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Провайдер Whisper</label>
                    <select
                      value={voiceConfig.whisperProvider}
                      onChange={(e) => {
                        const prov = e.target.value as WhisperProvider;
                        const model = prov === 'openai' ? 'whisper-1' : 'whisper-large-v3';
                        voiceService.saveConfig({ whisperProvider: prov, whisperModel: model });
                        setVoiceConfig((c) => ({ ...c, whisperProvider: prov, whisperModel: model }));
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                    >
                      <option value="groq">Groq Whisper (whisper-large-v3, сверхбыстрый ~200мс)</option>
                      <option value="openai">OpenAI Whisper (whisper-1)</option>
                      <option value="local">Локальный сервер (whisper.cpp / custom API)</option>
                    </select>
                  </div>

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
                        placeholder="Автоматически из настроек AI Studio или введите gsk_... / sk-..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        Если поле пустое, автоматически используется ключ из настроек Claude AI Studio.
                      </p>
                    </div>
                  )}

                  {/* Local Endpoint */}
                  {voiceConfig.whisperProvider === 'local' && (
                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">URL локального Whisper API</label>
                      <input
                        type="text"
                        value={voiceConfig.whisperEndpoint}
                        onChange={(e) => {
                          const val = e.target.value;
                          voiceService.saveConfig({ whisperEndpoint: val });
                          setVoiceConfig((c) => ({ ...c, whisperEndpoint: val }));
                        }}
                        placeholder="http://127.0.0.1:8000/v1/audio/transcriptions"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Supported Voice Commands Cheat Sheet */}
              <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-[11px] space-y-1.5 text-slate-300">
                <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Поддерживаемые команды:
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  <li><strong className="text-slate-200">«Перейди на проект [Имя]»</strong> — переключение проекта</li>
                  <li><strong className="text-slate-200">«Открой студию»</strong> — вход в Claude Studio</li>
                  <li><strong className="text-slate-200">«Вкладка 1/2/3»</strong>, <strong className="text-slate-200">«Новый диалог»</strong> — управление сессиями</li>
                  <li><strong className="text-slate-200">«Промпт [Текст]»</strong> — отправка запроса агенту</li>
                  <li><strong className="text-slate-200">«Принять» / «Отклонить»</strong>, <strong className="text-slate-200">«Вариант 1/2»</strong> — выбор в меню</li>
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
