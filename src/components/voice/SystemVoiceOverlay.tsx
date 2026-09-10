import React, { useState, useEffect } from 'react';
import { Pause, Play, Square, Zap, Radio } from 'lucide-react';
import { useI18n } from '../../i18n';

interface OverlayState {
  isListening: boolean;
  isPaused: boolean;
  state: string;
  transcript: string;
  audioLevel: number;
}

export const SystemVoiceOverlay: React.FC = () => {
  const { t } = useI18n();
  const [overlayState, setOverlayState] = useState<OverlayState>({
    isListening: true,
    isPaused: false,
    state: 'listening_handsfree',
    transcript: '',
    audioLevel: 0
  });

  useEffect(() => {
    // Make body and html transparent
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';

    if (window.api?.onVoiceOverlayUpdate) {
      const unsub = window.api.onVoiceOverlayUpdate((state) => {
        if (state) {
          setOverlayState((prev) => ({ ...prev, ...state }));
        }
      });
      return unsub;
    }
  }, []);

  const handleTogglePause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.api?.sendVoiceOverlayAction) {
      window.api.sendVoiceOverlayAction('toggle-pause');
    }
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.api?.sendVoiceOverlayAction) {
      window.api.sendVoiceOverlayAction('stop');
    }
  };

  const { isPaused, state, transcript, audioLevel } = overlayState;
  const isSpeech = state === 'speech_detected';
  const isTranscribing = state === 'transcribing';

  return (
    <div
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="w-full h-full p-1 select-none flex items-center justify-center cursor-move"
    >
      <div className="w-full h-full flex items-center justify-between gap-2 px-3 py-1 rounded-2xl bg-[#0e111bd9] border border-indigo-500/50 shadow-2xl backdrop-blur-2xl text-xs text-white">
        {/* Left Side: Status / Visualizer */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isPaused ? (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold tracking-wide shrink-0">
              <Pause className="w-3 h-3" />
              <span>{t.voice.paused}</span>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 h-3 px-1 bg-slate-950/80 rounded border border-slate-800 shrink-0">
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 12)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(4, audioLevel * 16)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 10)}px` }}
              />
            </div>
          )}

          {/* Text Info */}
          <div className="min-w-0 flex-1 truncate text-[11px]">
            {isPaused ? (
              <span className="text-amber-200/90 font-medium truncate block">{t.voice.inputPaused}</span>
            ) : isTranscribing ? (
              <span className="text-amber-300 font-medium flex items-center gap-1 truncate">
                <Zap className="w-3 h-3 animate-spin text-amber-400 shrink-0" />
                {t.voice.inferring}
              </span>
            ) : isSpeech ? (
              <span className="text-emerald-300 font-semibold truncate block">{t.voice.listeningSpeech}</span>
            ) : transcript ? (
              <span className="text-indigo-200 truncate block font-mono">«{transcript}»</span>
            ) : (
              <span className="text-slate-300 font-medium flex items-center gap-1 truncate">
                <Radio className="w-3 h-3 text-indigo-400 animate-pulse shrink-0" />
                ProjectHub Voice
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Action Buttons (Pause / Stop) */}
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1 shrink-0"
        >
          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={handleTogglePause}
            className={`p-1.5 rounded-lg transition ${
              isPaused
                ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/50'
                : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/80'
            }`}
            title={isPaused ? t.voice.resumeListening : t.voice.pauseListening}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Stop Button */}
          <button
            type="button"
            onClick={handleStop}
            className="p-1.5 rounded-lg bg-rose-600/30 text-rose-300 hover:bg-rose-600 hover:text-white border border-rose-500/50 transition"
            title={t.voice.stopVoiceControl}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
};
