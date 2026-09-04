import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Settings2,
  Zap,
  Activity,
  AlertTriangle
} from 'lucide-react';
import { voiceService, type VoiceState, type VoiceConfig } from '../../services/voiceService';
import { useTranslation } from '../../i18n/useTranslation';
import { VoiceSettingsModal } from './VoiceSettingsModal';

export const VoiceControlHeader: React.FC = () => {
  const { t } = useTranslation();
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.currentState);
  const [isSpeakingDetected, setIsSpeakingDetected] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    const unsubState = voiceService.onStateChange((state) => {
      setVoiceState(state);
    });

    const unsubLevel = voiceService.onAudioLevel((level, speaking) => {
      setAudioLevel(level);
      setIsSpeakingDetected(speaking);
    });

    return () => {
      unsubState();
      unsubLevel();
    };
  }, []);

  const isHandsFreeActive = voiceService.isListening;
  const isSpeech = voiceState === 'speech_detected' || isSpeakingDetected;
  const isTranscribing = voiceState === 'transcribing';

  const toggleHandsFree = async () => {
    await voiceService.toggleHandsFree();
  };

  const toggleTts = () => {
    const next = !voiceConfig.ttsEnabled;
    voiceService.saveConfig({ ttsEnabled: next });
    setVoiceConfig((prev) => ({ ...prev, ttsEnabled: next }));
  };

  const isError = voiceState === 'error';

  return (
    <>
      <div className="flex items-center gap-0.5 bg-[#181c2b] p-0.5 rounded-lg border border-slate-800 text-xs shrink-0 select-none">
        {/* Master Microphone Button (Stable toggle without jumping contents) */}
        <button
          type="button"
          onClick={toggleHandsFree}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition shrink-0 ${
            isError
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 hover:bg-rose-500/30 shadow-sm'
              : isHandsFreeActive
              ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
          title={
            isError
              ? 'Микрофон не обнаружен (кликните для проверки)'
              : isHandsFreeActive
              ? 'Голосовое управление включено (кликните для выключения)'
              : t.voice.inactiveTitle
          }
        >
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          ) : isHandsFreeActive ? (
            <Mic className="w-3.5 h-3.5 text-indigo-400" />
          ) : (
            <MicOff className="w-3.5 h-3.5 text-slate-500" />
          )}

          <span className="hidden xl:inline font-medium">
            {isError ? 'Ошибка' : isHandsFreeActive ? (t.voice.voiceActive || 'Голос: Вкл') : (t.voice.voiceOff || 'Голос')}
          </span>
        </button>

        {/* TTS Toggle Button */}
        <button
          type="button"
          onClick={toggleTts}
          className={`p-1 rounded text-xs transition ${
            voiceConfig.ttsEnabled
              ? 'text-indigo-400 hover:text-indigo-300 hover:bg-slate-800/60'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
          }`}
          title={voiceConfig.ttsEnabled ? t.voice.ttsOn : t.voice.ttsOff}
        >
          {voiceConfig.ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
        </button>

        {/* Settings Button */}
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition"
          title={t.voice.settingsTitle}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Voice Settings Modal */}
      <VoiceSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
};
