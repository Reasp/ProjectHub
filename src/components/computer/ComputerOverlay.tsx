import React, { useEffect, useState } from 'react';
import { Monitor, OctagonX } from 'lucide-react';
import type { ComputerOverlayState } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Содержимое окна-оверлея «Агент управляет компьютером» (TASK-82, AC #4). Окно создаёт main-процесс
 * поверх всех окон системы (`#/computer-overlay`); кнопка «Стоп» включает kill-switch.
 */
export const ComputerOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<ComputerOverlayState | null>(null);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const unsubscribe = window.api?.onComputerOverlayState?.((next) => setState(next));
    window.api?.getComputerUseStatus?.().then((s) =>
      setState(
        (prev) =>
          prev ?? {
            active: Boolean(s.activeSession) || s.killSwitch.engaged,
            label: s.activeSession?.label,
            killSwitch: s.killSwitch.engaged,
            hotkey: s.hotkey.accelerator
          }
      )
    );
    return () => {
      unsubscribe?.();
    };
  }, []);

  if (!state?.active) return null;

  if (state.killSwitch) {
    return (
      <div className="w-screen h-screen flex items-center justify-center p-1 select-none">
        <div className="w-full h-full flex items-center gap-3 px-4 rounded-2xl bg-rose-950/95 border-2 border-rose-500 text-rose-100 shadow-2xl">
          <OctagonX className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-bold truncate">{t.computerUse.overlayBlocked}</div>
            <div className="text-[10px] text-rose-300 truncate">{t.computerUse.overlayBlockedHint}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center p-1 select-none">
      <div className="w-full h-full flex items-center gap-3 px-4 rounded-2xl bg-[#1a1208]/95 border-2 border-orange-500 text-orange-100 shadow-2xl">
        <span className="relative flex w-3 h-3 shrink-0">
          <span className="absolute inline-flex w-full h-full rounded-full bg-orange-400 opacity-75 animate-ping" />
          <span className="relative inline-flex w-3 h-3 rounded-full bg-orange-500" />
        </span>
        <Monitor className="w-4 h-4 shrink-0 text-orange-300" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold truncate">
            {t.computerUse.overlayTitle}
            {state.label ? <span className="font-normal text-orange-300"> · {state.label}</span> : null}
          </div>
          <div className="text-[10px] text-orange-300/80 truncate">{t.computerUse.overlayHint.replace('{hotkey}', state.hotkey)}</div>
        </div>
        <button
          type="button"
          onClick={() => window.api?.engageComputerKillSwitch?.('overlay')}
          className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shrink-0"
        >
          {t.computerUse.stop}
        </button>
      </div>
    </div>
  );
};
