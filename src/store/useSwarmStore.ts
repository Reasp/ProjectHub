import { create } from 'zustand';
import type {
  SwarmSession,
  StartFanOutOptions,
  StartHandoffOptions,
  SwarmEventPayload
} from '../types/electron';

interface SwarmState {
  swarms: Record<string, SwarmSession[]>;
  activeSwarmId: Record<string, string | null>;
  isLoading: boolean;
  isNewSwarmModalOpen: boolean;
  initialNewSwarmConfig: {
    taskId?: string;
    taskTitle?: string;
    prompt?: string;
  } | null;

  loadSwarmsAction: (projectPath: string) => Promise<void>;
  setActiveSwarmId: (projectPath: string, swarmId: string | null) => void;
  openNewSwarmModal: (initialConfig?: { taskId?: string; taskTitle?: string; prompt?: string }) => void;
  closeNewSwarmModal: () => void;
  startFanOutAction: (options: StartFanOutOptions) => Promise<SwarmSession | null>;
  startHandoffAction: (options: StartHandoffOptions) => Promise<SwarmSession | null>;
  stopSwarmAction: (swarmId: string) => Promise<boolean>;
  pickWinnerAction: (
    swarmId: string,
    winnerAgentId: string,
    mergeIntoBase?: boolean
  ) => Promise<{ success: boolean; error?: string; mergedBranch?: string; conflictedFiles?: string[] }>;
  initSwarmEventListener: () => () => void;
}

export const useSwarmStore = create<SwarmState>((set) => ({
  swarms: {},
  activeSwarmId: {},
  isLoading: false,
  isNewSwarmModalOpen: false,
  initialNewSwarmConfig: null,

  loadSwarmsAction: async (projectPath: string) => {
    if (!projectPath || !window.api?.listSwarms) return;
    try {
      set({ isLoading: true });
      const list = await window.api.listSwarms(projectPath);
      set((state) => {
        const currentActive = state.activeSwarmId[projectPath];
        const nextActive = currentActive && list.some((s) => s.id === currentActive)
          ? currentActive
          : (list[0]?.id || null);

        return {
          swarms: { ...state.swarms, [projectPath]: list },
          activeSwarmId: { ...state.activeSwarmId, [projectPath]: nextActive },
          isLoading: false
        };
      });
    } catch (err) {
      console.error('[SwarmStore] Failed to load swarms:', err);
      set({ isLoading: false });
    }
  },

  setActiveSwarmId: (projectPath: string, swarmId: string | null) => {
    set((state) => ({
      activeSwarmId: { ...state.activeSwarmId, [projectPath]: swarmId }
    }));
  },

  openNewSwarmModal: (initialConfig) => {
    set({
      isNewSwarmModalOpen: true,
      initialNewSwarmConfig: initialConfig || null
    });
  },

  closeNewSwarmModal: () => {
    set({
      isNewSwarmModalOpen: false,
      initialNewSwarmConfig: null
    });
  },

  startFanOutAction: async (options: StartFanOutOptions) => {
    if (!window.api?.startSwarmFanOut) return null;
    try {
      set({ isLoading: true });
      const session = await window.api.startSwarmFanOut(options);
      const projectPath = options.projectPath;

      set((state) => {
        const existing = state.swarms[projectPath] || [];
        const filtered = existing.filter((s) => s.id !== session.id);
        return {
          swarms: { ...state.swarms, [projectPath]: [session, ...filtered] },
          activeSwarmId: { ...state.activeSwarmId, [projectPath]: session.id },
          isLoading: false,
          isNewSwarmModalOpen: false,
          initialNewSwarmConfig: null
        };
      });
      return session;
    } catch (err) {
      console.error('[SwarmStore] Failed to start Fan-Out:', err);
      set({ isLoading: false });
      return null;
    }
  },

  startHandoffAction: async (options: StartHandoffOptions) => {
    if (!window.api?.startSwarmHandoff) return null;
    try {
      set({ isLoading: true });
      const session = await window.api.startSwarmHandoff(options);
      const projectPath = options.projectPath;

      set((state) => {
        const existing = state.swarms[projectPath] || [];
        const filtered = existing.filter((s) => s.id !== session.id);
        return {
          swarms: { ...state.swarms, [projectPath]: [session, ...filtered] },
          activeSwarmId: { ...state.activeSwarmId, [projectPath]: session.id },
          isLoading: false,
          isNewSwarmModalOpen: false,
          initialNewSwarmConfig: null
        };
      });
      return session;
    } catch (err) {
      console.error('[SwarmStore] Failed to start Handoff:', err);
      set({ isLoading: false });
      return null;
    }
  },

  stopSwarmAction: async (swarmId: string) => {
    if (!window.api?.stopSwarm) return false;
    try {
      return await window.api.stopSwarm(swarmId);
    } catch (err) {
      console.error('[SwarmStore] Failed to stop swarm:', err);
      return false;
    }
  },

  pickWinnerAction: async (swarmId: string, winnerAgentId: string, mergeIntoBase = true) => {
    if (!window.api?.pickSwarmWinner) {
      return { success: false, error: 'API not available' };
    }
    try {
      return await window.api.pickSwarmWinner(swarmId, winnerAgentId, mergeIntoBase);
    } catch (err: any) {
      console.error('[SwarmStore] Failed to pick winner:', err);
      return { success: false, error: err.message || String(err) };
    }
  },

  initSwarmEventListener: () => {
    if (!window.api?.onSwarmEvent) return () => {};

    return window.api.onSwarmEvent((event: SwarmEventPayload) => {
      const { session, swarmId } = event;
      if (!session) return;

      set((state) => {
        const projectPath = session.projectPath;
        const projectSwarms = state.swarms[projectPath] || [];
        const idx = projectSwarms.findIndex((s) => s.id === swarmId);

        let updated: SwarmSession[];
        if (idx >= 0) {
          updated = [...projectSwarms];
          updated[idx] = session;
        } else {
          updated = [session, ...projectSwarms];
        }

        return {
          swarms: {
            ...state.swarms,
            [projectPath]: updated
          }
        };
      });
    });
  }
}));
