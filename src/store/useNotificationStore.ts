import { create } from 'zustand';
import type {
  AppNotification,
  NotificationAction,
  NotificationCapabilities,
  NotificationDelivery,
  NotificationSettings,
  NotificationSeverity
} from '../types/electron';
import { playNotificationSound } from '../lib/notificationSound';

/**
 * Стор уведомлений (TASK-63, decision-13).
 *
 * Настройки доставки живут в main (`<userData>/notifications.json`) — здесь только их копия для
 * UI, журнал последних доставок для «Центра уведомлений» и воспроизведение звука: канал `sound`
 * это событие `notify:sound` из main, потому что тихие часы и матрица каналов считаются там.
 */

/** Сколько уведомлений держим в журнале UI. */
const HISTORY_LIMIT = 100;

interface NotificationState {
  settings: NotificationSettings | null;
  capabilities: NotificationCapabilities | null;
  bot: { running: boolean; processId: string | null; configured: boolean } | null;
  history: AppNotification[];
  isSettingsOpen: boolean;
  isLoading: boolean;
  lastError: string | null;

  init: () => void;
  refresh: () => Promise<void>;
  updateSettings: (patch: Partial<NotificationSettings>) => Promise<void>;
  sendTest: () => Promise<NotificationDelivery | null>;
  toggleBot: (run: boolean) => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  clearHistory: () => void;
}

let cleanup: Array<() => void> = [];

export const useNotificationStore = create<NotificationState>((set, get) => ({
  settings: null,
  capabilities: null,
  bot: null,
  history: [],
  isSettingsOpen: false,
  isLoading: false,
  lastError: null,

  init: () => {
    if (cleanup.length) return;
    const onDelivered = window.api?.onNotificationDelivered?.((delivery) => {
      set((state) => ({ history: [delivery.notification, ...state.history].slice(0, HISTORY_LIMIT) }));
    });
    const onSound = window.api?.onNotificationSound?.((data) => {
      playNotificationSound((data?.severity as NotificationSeverity) || 'info', data?.volume ?? 0.5);
    });
    cleanup = [onDelivered, onSound].filter(Boolean) as Array<() => void>;
    void get().refresh();
  },

  refresh: async () => {
    if (!window.api?.getNotificationSettings) return;
    set({ isLoading: true });
    try {
      const state = await window.api.getNotificationSettings();
      set({ settings: state.settings, capabilities: state.capabilities, bot: state.bot, lastError: null });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  updateSettings: async (patch) => {
    if (!window.api?.updateNotificationSettings) return;
    const current = get().settings;
    // Оптимистично обновляем UI: main возвращает нормализованное значение и перетирает его.
    if (current) set({ settings: { ...current, ...patch } });
    try {
      const settings = await window.api.updateNotificationSettings(patch);
      set({ settings });
      await get().refresh();
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
      await get().refresh();
    }
  },

  sendTest: async () => {
    if (!window.api?.testNotification) return null;
    try {
      return await window.api.testNotification();
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  toggleBot: async (run) => {
    try {
      const result = run ? await window.api?.startTelegramBot?.() : await window.api?.stopTelegramBot?.();
      const error = result && !result.ok ? (result as { error?: string }).error : undefined;
      if (error) set({ lastError: error });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
    await get().refresh();
  },

  openSettings: () => {
    set({ isSettingsOpen: true });
    void get().refresh();
  },

  closeSettings: () => set({ isSettingsOpen: false }),

  clearHistory: () => set({ history: [] })
}));

/** Действие из уведомления/трея — обработчик ставит App (ему доступны проекты и вкладки). */
export type NotificationNavigateHandler = (action: NotificationAction) => void;
