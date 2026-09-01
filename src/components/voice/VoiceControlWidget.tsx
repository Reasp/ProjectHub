import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, Sparkles, Radio, CheckCircle, AlertCircle } from 'lucide-react';
import { voiceService, type VoiceState } from '../../services/voiceService';
import { parseVoiceCommand } from '../../services/voiceCommandParser';
import { useProjectStore } from '../../store/useProjectStore';

export const VoiceControlWidget: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    toggleTerminal,
    selectedProject,
    startProcessAction,
    stopProcessAction,
    processes,
    language
  } = useProjectStore();

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(true);

  useEffect(() => {
    setVoiceSupported(voiceService.supported);
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');

    voiceService.onStateChange((state: VoiceState) => {
      setIsListening(state === 'listening');
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
  }, [language, selectedProject, processes]);

  const executeCommand = async (rawText: string) => {
    const cmd = parseVoiceCommand(rawText);
    setLastCommand(cmd.feedbackText);

    if (ttsEnabled) {
      voiceService.speak(cmd.feedbackText, language === 'ru' ? 'ru' : 'en');
    }

    if (cmd.type === 'navigation') {
      if (cmd.intent === 'toggle_terminal') {
        toggleTerminal();
      } else if (cmd.payload) {
        setActiveTab(cmd.payload);
      }
    } else if (cmd.type === 'action') {
      if (!selectedProject) return;

      if (cmd.intent === 'run_dev') {
        await startProcessAction('npm run dev', 'dev');
      } else if (cmd.intent === 'stop_dev') {
        const p = processes.find(proc => proc.status === 'running' && proc.name === 'dev');
        if (p) await stopProcessAction(p.id);
      } else if (cmd.intent === 'run_deploy') {
        await startProcessAction('npm run deploy', 'deploy');
      } else if (cmd.intent === 'run_tests') {
        await startProcessAction('npm test', 'test');
      }
    }

    setTimeout(() => {
      setTranscript('');
      setLastCommand(null);
    }, 4000);
  };

  if (!voiceSupported) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 select-none">
      {/* Floating Transcript Pill */}
      {(transcript || lastCommand) && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/95 border border-indigo-500/50 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200">
          <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse shrink-0" />
          <span className="text-xs font-medium text-slate-200 truncate max-w-xs">
            {lastCommand ? `✓ ${lastCommand}` : `«${transcript}»`}
          </span>
        </div>
      )}

      {/* Mic Trigger Button */}
      <div className="relative flex items-center">
        {isListening && (
          <span className="absolute -inset-1 rounded-full bg-indigo-500/40 animate-ping" />
        )}
        <button
          onClick={() => voiceService.toggleListening()}
          className={`relative p-3 rounded-full shadow-xl transition transform active:scale-95 flex items-center justify-center ${
            isListening
              ? 'bg-rose-600 text-white ring-4 ring-rose-500/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white ring-2 ring-indigo-500/30'
          }`}
          title={isListening ? 'Идет прослушивание... Кликните для отключения' : 'Голосовое управление (Ctrl+Shift+V)'}
        >
          {isListening ? (
            <Mic className="w-5 h-5 animate-pulse" />
          ) : (
            <Mic className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* TTS Toggle Button */}
      <button
        onClick={() => setTtsEnabled(v => !v)}
        className={`p-2 rounded-lg text-xs transition border ${
          ttsEnabled
            ? 'bg-slate-900/80 border-slate-700/60 text-indigo-400 hover:bg-slate-800'
            : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:text-slate-300'
        }`}
        title={ttsEnabled ? 'Голосовой ответ ассистента включен' : 'Голосовой ответ ассистента выключен'}
      >
        {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};
