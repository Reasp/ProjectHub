import { create } from 'zustand';
import type {
  ArenaConfig,
  ArenaSettings,
  CheckDefinition,
  ComposeResult,
  ComposeSelection,
  JudgeState,
  SwarmSession,
  StartFanOutOptions,
  StartHandoffOptions,
  SwarmEventPayload,
  SwarmExportFormat,
  SwarmTranscript
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
  /** Запустить агента, назначенного на задачу через assignee (decision-9, TASK-60). */
  runAssignedAgentAction: (options: {
    projectPath: string;
    taskId: string;
    taskTitle?: string;
    prompt: string;
    roleSlug: string;
    hostId?: string;
  }) => Promise<SwarmSession | { error: string } | null>;
  stopSwarmAction: (swarmId: string) => Promise<boolean>;
  pickWinnerAction: (
    swarmId: string,
    winnerAgentId: string,
    mergeIntoBase?: boolean
  ) => Promise<{ success: boolean; error?: string; mergedBranch?: string; conflictedFiles?: string[] }>;
  /** Возобновить прерванную перезапуском сессию (TASK-56). */
  resumeSwarmAction: (swarmId: string) => Promise<{ success: boolean; error?: string }>;
  /** Закрыть сессию с очисткой worktree/веток и удалением файлов состояния (TASK-56). */
  discardSwarmAction: (projectPath: string, swarmId: string) => Promise<{ success: boolean; error?: string }>;
  getTranscriptAction: (swarmId: string, agentId: string) => Promise<SwarmTranscript | null>;
  /** Прогон автосудьи по сессии арены (TASK-61). */
  runJudgeAction: (
    swarmId: string,
    options?: { rerunChecks?: boolean; skipReview?: boolean }
  ) => Promise<{ success: boolean; error?: string; state?: JudgeState }>;
  cancelJudgeAction: (swarmId: string) => Promise<boolean>;
  composeResultAction: (swarmId: string, selections: ComposeSelection[]) => Promise<ComposeResult>;
  getArenaConfigAction: (projectPath: string) => Promise<ArenaConfig | null>;
  saveArenaConfigAction: (
    projectPath: string,
    patch: { checks?: CheckDefinition[]; arena?: ArenaSettings }
  ) => Promise<{ success: boolean; config?: ArenaConfig }>;
  exportSwarmAction: (
    swarmId: string,
    format: SwarmExportFormat
  ) => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>;
  initSwarmEventListener: () => () => void;
}

function removeSwarm(state: SwarmState, projectPath: string, swarmId: string) {
  const list = (state.swarms[projectPath] || []).filter((s) => s.id !== swarmId);
  const active = state.activeSwarmId[projectPath];
  return {
    swarms: { ...state.swarms, [projectPath]: list },
    activeSwarmId: {
      ...state.activeSwarmId,
      [projectPath]: active === swarmId ? list[0]?.id || null : active
    }
  };
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

  runAssignedAgentAction: async (options) => {
    if (!window.api?.runAssignedAgent) return null;
    try {
      set({ isLoading: true });
      const result = await window.api.runAssignedAgent(options);
      if (result && !('error' in result)) {
        const projectPath = options.projectPath;
        set((state) => {
          const existing = state.swarms[projectPath] || [];
          const filtered = existing.filter((s) => s.id !== result.id);
          return {
            swarms: { ...state.swarms, [projectPath]: [result, ...filtered] },
            activeSwarmId: { ...state.activeSwarmId, [projectPath]: result.id },
            isLoading: false
          };
        });
      } else {
        set({ isLoading: false });
      }
      return result;
    } catch (err) {
      console.error('[SwarmStore] Failed to run assigned agent:', err);
      set({ isLoading: false });
      return { error: err instanceof Error ? err.message : String(err) };
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

  resumeSwarmAction: async (swarmId: string) => {
    if (!window.api?.resumeSwarm) return { success: false, error: 'API not available' };
    try {
      return await window.api.resumeSwarm(swarmId);
    } catch (err: any) {
      console.error('[SwarmStore] Failed to resume swarm:', err);
      return { success: false, error: err.message || String(err) };
    }
  },

  discardSwarmAction: async (projectPath: string, swarmId: string) => {
    if (!window.api?.discardSwarm) return { success: false, error: 'API not available' };
    try {
      const res = await window.api.discardSwarm(swarmId, true);
      if (res.success) set((state) => removeSwarm(state, projectPath, swarmId));
      return res;
    } catch (err: any) {
      console.error('[SwarmStore] Failed to discard swarm:', err);
      return { success: false, error: err.message || String(err) };
    }
  },

  getTranscriptAction: async (swarmId: string, agentId: string) => {
    if (!window.api?.getSwarmTranscript) return null;
    try {
      return await window.api.getSwarmTranscript(swarmId, agentId);
    } catch (err) {
      console.error('[SwarmStore] Failed to read transcript:', err);
      return null;
    }
  },

  runJudgeAction: async (swarmId: string, options) => {
    if (!window.api?.runSwarmJudge) return { success: false, error: 'API not available' };
    try {
      return await window.api.runSwarmJudge(swarmId, options);
    } catch (err) {
      console.error('[SwarmStore] Failed to run judge:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  cancelJudgeAction: async (swarmId: string) => {
    if (!window.api?.cancelSwarmJudge) return false;
    try {
      return await window.api.cancelSwarmJudge(swarmId);
    } catch (err) {
      console.error('[SwarmStore] Failed to cancel judge:', err);
      return false;
    }
  },

  composeResultAction: async (swarmId: string, selections: ComposeSelection[]) => {
    if (!window.api?.composeSwarmResult) return { success: false, error: 'API not available' };
    try {
      return await window.api.composeSwarmResult(swarmId, selections);
    } catch (err) {
      console.error('[SwarmStore] Failed to compose result:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  getArenaConfigAction: async (projectPath: string) => {
    if (!window.api?.getArenaConfig) return null;
    try {
      return await window.api.getArenaConfig(projectPath);
    } catch (err) {
      console.error('[SwarmStore] Failed to load arena config:', err);
      return null;
    }
  },

  saveArenaConfigAction: async (projectPath, patch) => {
    if (!window.api?.saveArenaConfig) return { success: false };
    try {
      return await window.api.saveArenaConfig(projectPath, patch);
    } catch (err) {
      console.error('[SwarmStore] Failed to save arena config:', err);
      return { success: false };
    }
  },

  exportSwarmAction: async (swarmId: string, format: SwarmExportFormat) => {
    if (!window.api?.exportSwarmToFile) return { success: false, error: 'API not available' };
    try {
      return await window.api.exportSwarmToFile(swarmId, format);
    } catch (err: any) {
      console.error('[SwarmStore] Failed to export swarm:', err);
      return { success: false, error: err.message || String(err) };
    }
  },

  initSwarmEventListener: () => {
    if (!window.api?.onSwarmEvent) return () => {};

    return window.api.onSwarmEvent((event: SwarmEventPayload) => {
      const { session, swarmId } = event;

      if (event.type === 'swarm_removed') {
        set((state) => {
          const projectPath = Object.keys(state.swarms).find((p) => state.swarms[p].some((s) => s.id === swarmId));
          return projectPath ? removeSwarm(state, projectPath, swarmId) : {};
        });
        return;
      }

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
