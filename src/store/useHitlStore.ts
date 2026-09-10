import { create } from 'zustand';
import type { AppBusEvent, ApprovalRequest, HitlAuditEntry, HitlAuditQuery, HitlDecideResult } from '../types/electron';
import { useAIStudioStore } from './useAIStudioStore';

/**
 * Стор единого HITL-контура (TASK-57): очередь запросов всех сессий и хостов, история решений,
 * подписка на шину событий main (`bus:event`). Решение всегда адресуется по requestId.
 */

export type HitlCenterTab = 'queue' | 'history';

interface HitlState {
  pending: ApprovalRequest[];
  isCenterOpen: boolean;
  centerTab: HitlCenterTab;
  audit: HitlAuditEntry[];
  auditMonths: string[];
  auditQuery: HitlAuditQuery;
  isAuditLoading: boolean;
  auditInfo: { auditDir: string | null; queueDir: string | null; hostId: string } | null;
  /** Последнее предупреждение о запуске агента без HITL (fallback). */
  fallbackNotice: string | null;
  lastAgentEvent: AppBusEvent | null;

  init: () => void;
  refreshPending: () => Promise<void>;
  decide: (requestId: string, approved: boolean, text?: string) => Promise<HitlDecideResult>;
  openCenter: (tab?: HitlCenterTab) => void;
  closeCenter: () => void;
  setCenterTab: (tab: HitlCenterTab) => void;
  setAuditQuery: (patch: Partial<HitlAuditQuery>) => void;
  loadAudit: () => Promise<void>;
  exportAudit: (format: 'jsonl' | 'json' | 'csv') => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>;
  dismissFallbackNotice: () => void;
}

let busCleanup: (() => void) | null = null;

function upsert(list: ApprovalRequest[], request: ApprovalRequest): ApprovalRequest[] {
  const idx = list.findIndex((r) => r.id === request.id);
  if (idx === -1) return [...list, request].sort((a, b) => a.createdAt - b.createdAt);
  const next = [...list];
  next[idx] = request;
  return next;
}

export const useHitlStore = create<HitlState>((set, get) => ({
  pending: [],
  isCenterOpen: false,
  centerTab: 'queue',
  audit: [],
  auditMonths: [],
  auditQuery: { limit: 300 },
  isAuditLoading: false,
  auditInfo: null,
  fallbackNotice: null,
  lastAgentEvent: null,

  init: () => {
    if (busCleanup || !window.api?.onBusEvent) return;
    busCleanup = window.api.onBusEvent((event) => {
      if (event.type === 'hitl:requested') {
        set((state) => ({ pending: upsert(state.pending, event.request) }));
      } else if (event.type === 'hitl:decided' || event.type === 'hitl:expired' || event.type === 'hitl:cancelled') {
        const { id, projectPath } = event.request;
        set((state) => ({ pending: state.pending.filter((r) => r.id !== id) }));
        useAIStudioStore.getState().removePendingApproval(projectPath, id);
      } else if (event.type === 'hitl:fallback') {
        set({ fallbackNotice: event.reason });
      } else if (event.type === 'agent:started' || event.type === 'agent:finished' || event.type === 'agent:failed') {
        set({ lastAgentEvent: event });
      }
    });
    void get().refreshPending();
  },

  refreshPending: async () => {
    if (!window.api?.listPendingApprovals) return;
    try {
      const list = await window.api.listPendingApprovals();
      set({ pending: [...list].sort((a, b) => a.createdAt - b.createdAt) });
    } catch (err) {
      console.error('[HITL] Failed to load pending approvals:', err);
    }
  },

  decide: async (requestId, approved, text) => {
    if (!window.api?.decideApproval) return { ok: false, reason: 'not_found' };
    const result = await window.api.decideApproval(requestId, { approved, text });
    if (result.ok) {
      set((state) => ({ pending: state.pending.filter((r) => r.id !== requestId) }));
      useAIStudioStore.getState().removePendingApproval(result.projectPath, requestId);
    } else {
      void get().refreshPending();
    }
    return result;
  },

  openCenter: (tab) => {
    set({ isCenterOpen: true, centerTab: tab ?? get().centerTab });
    void get().refreshPending();
    if ((tab ?? get().centerTab) === 'history') void get().loadAudit();
  },

  closeCenter: () => set({ isCenterOpen: false }),

  setCenterTab: (tab) => {
    set({ centerTab: tab });
    if (tab === 'history') void get().loadAudit();
  },

  setAuditQuery: (patch) => {
    set((state) => ({ auditQuery: { ...state.auditQuery, ...patch } }));
    void get().loadAudit();
  },

  loadAudit: async () => {
    if (!window.api?.listHitlAudit) return;
    set({ isAuditLoading: true });
    try {
      const [audit, auditMonths, auditInfo] = await Promise.all([
        window.api.listHitlAudit(get().auditQuery),
        window.api.listHitlAuditMonths?.() ?? Promise.resolve([]),
        window.api.getHitlInfo?.() ?? Promise.resolve(null)
      ]);
      set({ audit, auditMonths, auditInfo });
    } catch (err) {
      console.error('[HITL] Failed to load audit:', err);
    } finally {
      set({ isAuditLoading: false });
    }
  },

  exportAudit: async (format) => {
    if (!window.api?.exportHitlAudit) return { success: false, error: 'API недоступен' };
    return window.api.exportHitlAudit(get().auditQuery, format);
  },

  dismissFallbackNotice: () => set({ fallbackNotice: null })
}));
