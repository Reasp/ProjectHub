import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, Play, Bot, Power, TriangleAlert, Trash2 } from 'lucide-react';
import { useNotificationStore } from '../../store/useNotificationStore';
import { useTranslation } from '../../i18n';
import type { NotificationChannel, NotificationKind } from '../../types/electron';

/**
 * Настройки доставки уведомлений (TASK-63, decision-13 п.3, п.6): матрица «тип события × канал»,
 * тихие часы, дедупликация, звук, сворачивание в трей и управление демоном Telegram-бота.
 *
 * Рендерится через createPortal в document.body с `z-[9999]` (правило 19 infra-dev, decision-17):
 * бейдж живёт в шапке с `backdrop-filter`, который иначе запер бы `fixed`-окно за интерфейсом.
 */

const KINDS: NotificationKind[] = [
  'hitl',
  'agentFinished',
  'agentFailed',
  'swarmFinished',
  'processCrashed',
  'prCreated',
  'prChecksFailed',
  'deviceConnected'
];

const CHANNELS: NotificationChannel[] = ['tray', 'os', 'sound', 'telegram', 'remote'];

export const NotificationSettingsModal: React.FC = () => {
  const { t } = useTranslation();
  const isOpen = useNotificationStore((s) => s.isSettingsOpen);
  const close = useNotificationStore((s) => s.closeSettings);
  const settings = useNotificationStore((s) => s.settings);
  const capabilities = useNotificationStore((s) => s.capabilities);
  const bot = useNotificationStore((s) => s.bot);
  const history = useNotificationStore((s) => s.history);
  const lastError = useNotificationStore((s) => s.lastError);
  const updateSettings = useNotificationStore((s) => s.updateSettings);
  const sendTest = useNotificationStore((s) => s.sendTest);
  const toggleBot = useNotificationStore((s) => s.toggleBot);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const toggleChannel = (kind: NotificationKind, channel: NotificationChannel) => {
    if (!settings) return;
    const current = settings.channels[kind] || [];
    const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
    void updateSettings({ channels: { ...settings.channels, [kind]: next } });
  };

  const channelDisabled = (channel: NotificationChannel): string | null => {
    if (!capabilities) return null;
    if (channel === 'os' && !capabilities.osNotifications) return t.notifications.unsupportedOs;
    if (channel === 'telegram' && !capabilities.telegram) return t.notifications.telegramNotConfigured;
    if (channel === 'tray' && !capabilities.tray) return t.notifications.trayUnavailable;
    return null;
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl h-[86vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{t.notifications.title}</h2>
              <p className="text-[11px] text-muted-foreground">{t.notifications.subtitle}</p>
            </div>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {lastError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/40 text-xs text-destructive">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{lastError}</span>
            </div>
          )}

          {!settings && <div className="text-xs text-muted-foreground">{t.common.loading}</div>}

          {settings && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => void updateSettings({ enabled: e.target.checked })}
                />
                <span className="font-medium">{t.notifications.enabled}</span>
                <span className="text-[11px] text-muted-foreground">{t.notifications.enabledDesc}</span>
              </label>

              {/* Матрица «событие × канал» */}
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t.notifications.matrixTitle}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/30">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">{t.notifications.colEvent}</th>
                        {CHANNELS.map((channel) => (
                          <th key={channel} className="px-3 py-2 font-medium text-center whitespace-nowrap">
                            {t.notifications.channel[channel]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {KINDS.map((kind) => (
                        <tr key={kind} className="border-t border-border">
                          <td className="px-3 py-2">{t.notifications.kind[kind]}</td>
                          {CHANNELS.map((channel) => {
                            const disabledReason = channelDisabled(channel);
                            return (
                              <td key={channel} className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={(settings.channels[kind] || []).includes(channel)}
                                  onChange={() => toggleChannel(kind, channel)}
                                  title={disabledReason || undefined}
                                  className={disabledReason ? 'opacity-50' : ''}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {capabilities && !capabilities.osActions && (
                  <p className="mt-2 text-[11px] text-amber-400 flex items-start gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {t.notifications.osActionsUnsupported}
                  </p>
                )}
              </section>

              {/* Тихие часы */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.notifications.quietTitle}
                </h3>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.quietHours.enabled}
                    onChange={(e) => void updateSettings({ quietHours: { ...settings.quietHours, enabled: e.target.checked } })}
                  />
                  {t.notifications.quietEnabled}
                </label>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    {t.notifications.quietFrom}
                    <input
                      type="time"
                      value={settings.quietHours.from}
                      onChange={(e) => void updateSettings({ quietHours: { ...settings.quietHours, from: e.target.value } })}
                      className="rounded-sm border border-border bg-background px-2 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    {t.notifications.quietTo}
                    <input
                      type="time"
                      value={settings.quietHours.to}
                      onChange={(e) => void updateSettings({ quietHours: { ...settings.quietHours, to: e.target.value } })}
                      className="rounded-sm border border-border bg-background px-2 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={settings.quietHours.allowCritical}
                      onChange={(e) =>
                        void updateSettings({ quietHours: { ...settings.quietHours, allowCritical: e.target.checked } })
                      }
                    />
                    {t.notifications.quietAllowCritical}
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">{t.notifications.quietDesc}</p>
              </section>

              {/* Звук, дедупликация, трей */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    {t.notifications.volume}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings.soundVolume * 100)}
                    onChange={(e) => void updateSettings({ soundVolume: Number(e.target.value) / 100 })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    {t.notifications.dedup}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={Math.round(settings.dedupWindowMs / 1000)}
                    onChange={(e) => void updateSettings({ dedupWindowMs: Math.max(0, Number(e.target.value)) * 1000 })}
                    className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">{t.notifications.dedupDesc}</p>
                </div>
                <label className="flex items-center gap-2 text-xs sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={settings.minimizeToTray}
                    onChange={(e) => void updateSettings({ minimizeToTray: e.target.checked })}
                  />
                  {t.notifications.minimizeToTray}
                </label>
              </section>

              {/* Telegram */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.notifications.telegramTitle}
                </h3>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={settings.telegramBotAutoStart}
                    onChange={(e) => void updateSettings({ telegramBotAutoStart: e.target.checked })}
                  />
                  {t.notifications.telegramAutoStart}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] border ${
                      bot?.running
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                        : 'bg-secondary border-border text-muted-foreground'
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {bot?.running ? t.notifications.botRunning : t.notifications.botStopped}
                  </span>
                  <button
                    type="button"
                    onClick={() => void toggleBot(!bot?.running)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-border hover:bg-secondary"
                  >
                    <Power className="w-3.5 h-3.5" />
                    {bot?.running ? t.notifications.botStop : t.notifications.botStart}
                  </button>
                  {bot?.processId && <span className="text-[11px] text-muted-foreground">{bot.processId}</span>}
                </div>
                {!capabilities?.telegram && (
                  <p className="text-[11px] text-amber-400">{t.notifications.telegramNotConfigured}</p>
                )}
              </section>

              {/* Журнал доставок */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.notifications.historyTitle}
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void sendTest()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-border hover:bg-secondary"
                    >
                      <Play className="w-3.5 h-3.5" /> {t.notifications.test}
                    </button>
                    <button
                      type="button"
                      onClick={clearHistory}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] border border-border hover:bg-secondary"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> {t.notifications.clearHistory}
                    </button>
                  </div>
                </div>
                {history.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t.notifications.historyEmpty}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {history.slice(0, 20).map((n) => (
                      <li key={n.id} className="px-3 py-2 rounded-lg border border-border bg-secondary/20 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{n.title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(n.at).toLocaleTimeString()}
                          </span>
                        </div>
                        {n.body && <div className="text-[11px] text-muted-foreground mt-0.5">{n.body}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
