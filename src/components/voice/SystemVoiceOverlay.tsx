import React, { useState, useEffect } from 'react';
import { Pause, Play, Square, Zap, Radio, Keyboard } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * Системный оверлей голоса (TASK-83).
 *
 * Отдельное окно поверх всех приложений: распознанный текст должен быть виден, даже когда окно
 * ProjectHub свёрнуто или пользователь работает в чужой программе. Размер и положение окна задаёт
 * main по полю `mode` (полоса внизу экрана, широкая полоса на время записи, крупное окно по центру
 * в режиме диктовки) — здесь только типографика под каждый режим.
 */

type OverlayMode = 'compact' | 'wide' | 'full';

interface OverlayState {
  isListening: boolean;
  isPaused: boolean;
  state: string;
  transcript: string;
  audioLevel: number;
  mode?: OverlayMode;
  /** Итог последней команды: «Открываю доску задач», «Напечатано: …». */
  feedback?: string;
}

/** Размер текста распознанной фразы по режимам: в диктовке его читают через всю комнату. */
const TRANSCRIPT_FONT: Record<OverlayMode, number> = {
  compact: 18,
  wide: 34,
  full: 52
};

const STATUS_FONT: Record<OverlayMode, number> = {
  compact: 11,
  wide: 14,
  full: 18
};

export const SystemVoiceOverlay: React.FC = () => {
  const { t } = useI18n();
  const [overlayState, setOverlayState] = useState<OverlayState>({
    isListening: true,
    isPaused: false,
    state: 'listening_handsfree',
    transcript: '',
    audioLevel: 0,
    mode: 'compact'
  });

  useEffect(() => {
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
    window.api?.sendVoiceOverlayAction?.('toggle-pause');
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.api?.sendVoiceOverlayAction?.('stop');
  };

  const { isPaused, state, transcript, audioLevel, feedback } = overlayState;
  const mode: OverlayMode = overlayState.mode ?? 'compact';
  const isSpeech = state === 'speech_detected';
  const isTranscribing = state === 'transcribing';
  const isBig = mode !== 'compact';

  // Что показываем крупно: сначала распознанный текст, затем итог команды, иначе подсказка режима.
  const headline = transcript || feedback || '';

  const statusLabel = isPaused
    ? t.voice.inputPaused
    : isTranscribing
      ? t.voice.whisperInferring
      : isSpeech
        ? t.voice.listeningSpeech
        : mode === 'full'
          ? t.voice.feedback.dictationOn
          : t.voice.talonActive;

  const statusColor = isPaused
    ? 'text-amber-300'
    : isTranscribing
      ? 'text-amber-300'
      : isSpeech
        ? 'text-emerald-300'
        : 'text-slate-300';

  return (
    <div
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="w-full h-full p-1 select-none cursor-move"
    >
      <div
        className={`w-full h-full flex flex-col rounded-2xl bg-[#0e111bf2] border shadow-2xl backdrop-blur-2xl text-white ${
          mode === 'full' ? 'border-amber-500/60 px-10 py-8 gap-4' : 'border-indigo-500/50 px-5 py-3 gap-2'
        }`}
      >
        {/* Верхняя строка: индикатор уровня, статус, кнопки */}
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {isPaused ? (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold tracking-wide shrink-0" style={{ fontSize: STATUS_FONT[mode] - 1 }}>
                <Pause className="w-3.5 h-3.5" />
                <span>{t.voice.paused}</span>
              </div>
            ) : (
              <div className="flex items-end gap-0.5 h-5 px-1.5 bg-slate-950/80 rounded border border-slate-800 shrink-0">
                <span className="w-1 bg-indigo-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 16)}px` }} />
                <span className="w-1 bg-indigo-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(5, audioLevel * 20)}px` }} />
                <span className="w-1 bg-indigo-400 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 14)}px` }} />
              </div>
            )}

            <span className={`font-semibold flex items-center gap-1.5 truncate ${statusColor}`} style={{ fontSize: STATUS_FONT[mode] }}>
              {isTranscribing ? (
                <Zap className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              ) : mode === 'full' ? (
                <Keyboard className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <Radio className="w-4 h-4 text-indigo-400 animate-pulse shrink-0" />
              )}
              {statusLabel}
            </span>
          </div>

          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center gap-1 shrink-0"
          >
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

        {/* Распознанный текст — главное содержимое оверлея */}
        <div className={`flex-1 min-h-0 flex ${isBig ? 'items-center' : 'items-start'}`}>
          {headline ? (
            <p
              className={`w-full font-medium leading-tight ${
                transcript ? 'text-white' : 'text-indigo-200'
              } ${isBig ? 'text-center' : 'truncate'}`}
              style={{
                fontSize: TRANSCRIPT_FONT[mode],
                // В крупных режимах текст переносится и обрезается по числу строк, а не по ширине.
                display: isBig ? '-webkit-box' : undefined,
                WebkitLineClamp: isBig ? (mode === 'full' ? 6 : 3) : undefined,
                WebkitBoxOrient: isBig ? ('vertical' as const) : undefined,
                overflow: isBig ? 'hidden' : undefined
              }}
            >
              {transcript ? `«${transcript}»` : headline}
            </p>
          ) : (
            <p className="w-full text-slate-500 text-center" style={{ fontSize: STATUS_FONT[mode] }}>
              {t.voice.speakCommand}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
