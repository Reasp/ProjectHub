import { create } from 'zustand';
import type { AutomationLogEntry, AutomationRuleView, AutomationsSettings } from '../types/electron';

/**
 * Стор Automations (TASK-74, decision-52). Правила, состояние и журнал живут в main
 * (`<userData>/automations*.json`, `.projecthub.json` проектов) — здесь копия для модалки и
 * бейджа. Main шлёт `automations:changed` при запусках и изменениях; стор перечитывает список.
 */

interface AutomationsState {
  isOpen: boolean;
  /** Проект, к которому открыли модалку из уведомления, — его правила показываются первыми. */
  focusProject: string | null;
  rules: AutomationRuleView[];
  settings: AutomationsSettings | null;
  log: AutomationLogEntry[];
  loading: boolean;
  error: string | null;

  init: () => void;
  open: (projectPath?: string) => void;
  close: () => void;
  refresh: () => Promise<void>;
  refreshLog: () => Promise<void>;
}

let initialized = false;

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  isOpen: false,
  focusProject: null,
  rules: [],
  settings: null,
  log: [],
  loading: false,
  error: null,

  init: () => {
    if (initialized || !window.api?.listAutomations) return;
    initialized = true;
    void get().refresh();
    window.api.onAutomationsChanged(() => {
      void get().refresh();
      if (get().isOpen) void get().refreshLog();
    });
  },

  open: (projectPath) => {
    set({ isOpen: true, focusProject: projectPath ?? null });
    void get().refresh();
    void get().refreshLog();
  },

  close: () => set({ isOpen: false, focusProject: null }),

  refresh: async () => {
    if (!window.api?.listAutomations) return;
    set({ loading: true });
    try {
      const { rules, settings } = await window.api.listAutomations();
      set({ rules, settings, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  refreshLog: async () => {
    if (!window.api?.getAutomationLog) return;
    try {
      set({ log: await window.api.getAutomationLog(200) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  }
}));
