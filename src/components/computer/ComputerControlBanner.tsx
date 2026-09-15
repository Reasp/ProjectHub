import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Monitor, OctagonX, Settings, Unlock } from 'lucide-react';
import type { ComputerUseStatus } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { ComputerUseSettingsModal } from './ComputerUseSettingsModal';

/**
 * Баннер в окне ProjectHub, пока агент управляет компьютером или kill-switch заблокировал прокси
 * (TASK-82). Плавающий глобальный контрол — `z-[10000]` через portal (decision-17); системный
 * оверлей поверх всех окон рисует отдельное окно `ComputerOverlay`.
 */
export const ComputerControlBanner: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    if (!window.api?.getComputerUseStatus) return;
    window.api.getComputerUseStatus().then(setStatus).catch(() => undefined);
    const unsubscribe = window.api.onComputerUseStatusChanged?.((next) => setStatus(next));
    return () => {
      unsubscribe?.();
    };
  }, []);

  const engaged = Boolean(status?.killSwitch.engaged);
  const active = Boolean(status?.activeSession);

  return (
    <>
      {(engaged || active) &&
        createPortal(
          <div
            className={`fixed top-3 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-3 px-4 py-2 rounded-2xl border-2 shadow-2xl text-xs ${
              engaged ? 'bg-rose-950/95 border-rose-500 text-rose-100' : 'bg-[#1a1208]/95 border-orange-500 text-orange-100'
            }`}
          >
            {engaged ? <OctagonX className="w-4 h-4 shrink-0" /> : <Monitor className="w-4 h-4 shrink-0 animate-pulse" />}
            <span className="font-semibold">
              {engaged
                ? t.computerUse.killSwitchEngaged.replace('{reason}', status?.killSwitch.reason ? t.computerUse.reason[status.killSwitch.reason] : '?')
                : t.computerUse.bannerActive.replace('{agent}', status?.activeSession?.label || '')}
            </span>
            {engaged ? (
              <button
                type="button"
                onClick={() => window.api.releaseComputerKillSwitch().then(setStatus)}
                className="px-3 py-1 rounded-lg bg-rose-600/40 hover:bg-rose-600/60 font-semibold flex items-center gap-1"
              >
                <Unlock className="w-3.5 h-3.5" />
                {t.computerUse.release}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => window.api.engageComputerKillSwitch('manual').then(setStatus)}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                {t.computerUse.stop}
              </button>
            )}
            <button
              type="button"
              title={t.computerUse.openSettings}
              onClick={() => setIsSettingsOpen(true)}
              className="p-1 rounded-lg hover:bg-white/10"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>,
          document.body
        )}
      <ComputerUseSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
};
