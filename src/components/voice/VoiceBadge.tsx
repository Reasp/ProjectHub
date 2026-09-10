import React from 'react';
import { Mic } from 'lucide-react';
import { useVoiceState } from '../../hooks/useVoiceState';
import { useI18n } from '../../i18n';

export interface VoiceBadgeProps {
  /** Voice command text or phrase to speak, e.g. "задачи", "старт дев" */
  command: string;
  /** Optional secondary command or synonym */
  altCommand?: string;
  /** Positioning mode */
  position?: 'inline' | 'top' | 'bottom' | 'top-right' | 'bottom-right';
  /** Visual color theme */
  variant?: 'indigo' | 'emerald' | 'amber' | 'purple' | 'cyan';
  /** Extra CSS classes */
  className?: string;
  /** Force show even if hands-free is inactive (e.g. for preview/help) */
  alwaysShow?: boolean;
}

export const VoiceBadge: React.FC<VoiceBadgeProps> = ({
  command,
  altCommand,
  position = 'inline',
  variant = 'indigo',
  className = '',
  alwaysShow = false
}) => {
  const { isListening } = useVoiceState();
  const { t, language } = useI18n();

  if (!isListening && !alwaysShow) {
    return null;
  }

  const altText = altCommand ? t.voice.altCommandFormat.replace('{altCommand}', altCommand) : '';
  const tooltip = t.voice.speakHint.replace('{command}', command).replace('{alt}', altText);

  const variantStyles = {
    indigo:
      'bg-indigo-950/90 text-indigo-200 border-indigo-500/60 shadow-indigo-950/60 hover:border-indigo-400',
    emerald:
      'bg-emerald-950/90 text-emerald-200 border-emerald-500/60 shadow-emerald-950/60 hover:border-emerald-400',
    amber:
      'bg-amber-950/90 text-amber-200 border-amber-500/60 shadow-amber-950/60 hover:border-amber-400',
    purple:
      'bg-purple-950/90 text-purple-200 border-purple-500/60 shadow-purple-950/60 hover:border-purple-400',
    cyan:
      'bg-cyan-950/90 text-cyan-200 border-cyan-500/60 shadow-cyan-950/60 hover:border-cyan-400'
  };

  const positionStyles = {
    inline: 'relative inline-flex items-center ml-1.5',
    top: 'absolute -top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none whitespace-nowrap',
    bottom: 'absolute -bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none whitespace-nowrap',
    'top-right': 'absolute -top-2 -right-2 z-30 pointer-events-none whitespace-nowrap',
    'bottom-right': 'absolute -bottom-2 -right-1 z-30 pointer-events-none whitespace-nowrap'
  };

  return (
    <span
      className={`select-none pointer-events-none inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9.5px] font-mono font-semibold backdrop-blur-md shadow-md animate-in fade-in zoom-in-95 duration-150 transition-all ${variantStyles[variant]} ${positionStyles[position]} ${className}`}
      title={tooltip}
    >
      <Mic className="w-2.5 h-2.5 shrink-0 opacity-80 animate-pulse text-indigo-400" />
      <span className="tracking-tight whitespace-nowrap">
        «{command}»
      </span>
      {altCommand && (
        <span className="hidden 2xl:inline opacity-60 text-[8.5px]">
          / «{altCommand}»
        </span>
      )}
    </span>
  );
};
