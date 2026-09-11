import React from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useNotificationStore } from '../../store/useNotificationStore';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Бейдж уведомлений в шапке (TASK-63): состояние доставки и вход в настройки каналов,
 * тихих часов и Telegram-бота. Число — уведомления, доставленные за текущую сессию окна.
 */
export const NotificationsBadge: React.FC = () => {
  const { t } = useTranslation();
  const settings = useNotificationStore((s) => s.settings);
  const historyCount = useNotificationStore((s) => s.history.length);
  const openSettings = useNotificationStore((s) => s.openSettings);

  const muted = settings ? !settings.enabled : false;
  const Icon = muted ? BellOff : historyCount > 0 ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={openSettings}
      title={muted ? t.notifications.badgeMuted : t.notifications.badgeTooltip}
      className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition shrink-0 ${
        muted
          ? 'bg-slate-800/80 border-slate-700/60 text-slate-500 hover:text-slate-300'
          : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {historyCount > 0 && <span className="font-bold">{historyCount > 99 ? '99+' : historyCount}</span>}
    </button>
  );
};
