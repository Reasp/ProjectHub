import { create } from 'zustand';
import type { FederationHost, FederationPeerState, FederationTransport } from '../types/remote';

/**
 * Стор федерации компьютеров (TASK-66, decision-11 п.4): каталог хостов, сопряжённые пиры и
 * данные удалённого хоста в hub-режиме.
 *
 * Данные удалённого хоста НЕ смешиваются с локальными сторами (проекты, задачи, HITL): всё, что
 * пришло с другой машины, живёт здесь и показывается с явной пометкой хоста — иначе очереди двух
 * машин слились бы в одну и было бы непонятно, где на самом деле выполняется действие.
 */

export interface RemoteProjectInfo {
  id?: string;
  name?: string;
  path: string;
}

export interface RemoteTaskInfo {
  id: string;
  title: string;
  status: string;
  assignee?: string[];
  filePath?: string;
  priority?: string;
}

export interface RemoteProcessInfo {
  id: string;
  name: string;
  status: string;
  command?: string;
  port?: number;
}

export interface RemoteApprovalInfo {
  requestId: string;
  sessionId: string;
  projectPath: string;
  tool?: string;
  type?: string;
  title?: string;
  details?: string;
  command?: string;
  filePath?: string;
  createdAt?: number;
  agentName?: string;
  role?: string;
}

export interface RemoteSwarmInfo {
  id: string;
  mode: string;
  status: string;
  taskId?: string;
  taskTitle?: string;
  origin?: string;
  agents: Array<{ id: string; name: string; roleSlug?: string; engine?: string; status: string; error?: string }>;
}

export interface RemoteHostData {
  projects: RemoteProjectInfo[];
  activeProjectPath: string | null;
  tasks: RemoteTaskInfo[];
  processes: RemoteProcessInfo[];
  approvals: RemoteApprovalInfo[];
  swarms: RemoteSwarmInfo[];
  roles: Array<{ slug: string; name: string }>;
  isLoading: boolean;
  error: string | null;
}

export type RemoteHostTab = 'overview' | 'tasks' | 'processes' | 'agents' | 'hitl';

interface FederationState {
  isOpen: boolean;
  peers: FederationPeerState[];
  catalog: FederationHost[];
  selectedHostId: string | null;
  activeTab: RemoteHostTab;
  data: Record<string, RemoteHostData>;
  lastEvent: { hostId: string; machineName: string; event: string; at: number } | null;

  init: () => void;
  open: (hostId?: string) => void;
  close: () => void;
  setActiveTab: (tab: RemoteHostTab) => void;
  refreshPeers: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  addPeer: (options: {
    hostId: string;
    machineName?: string;
    transport: FederationTransport;
    address: string;
    secretKey?: string;
    pin?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  removePeer: (hostId: string) => Promise<void>;
  connectPeer: (hostId: string) => Promise<{ ok: boolean; error?: string }>;
  disconnectPeer: (hostId: string) => Promise<void>;
  selectHost: (hostId: string | null) => void;
  loadHostData: (hostId: string) => Promise<void>;
  selectRemoteProject: (hostId: string, projectPath: string) => Promise<void>;
  decideRemoteApproval: (hostId: string, requestId: string, approved: boolean) => Promise<{ ok: boolean; error?: string }>;
  runRemoteAssignedAgent: (
    hostId: string,
    options: { projectPath: string; taskId: string; taskTitle?: string; roleSlug: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  updateRemoteTaskStatus: (hostId: string, filePath: string, newStatus: string) => Promise<{ ok: boolean; error?: string }>;
  remoteProcessAction: (hostId: string, action: 'stop' | 'restart', processId: string) => Promise<{ ok: boolean; error?: string }>;
}

const emptyData: RemoteHostData = {
  projects: [],
  activeProjectPath: null,
  tasks: [],
  processes: [],
  approvals: [],
  swarms: [],
  roles: [],
  isLoading: false,
  error: null
};

let cleanupPeers: (() => void) | null = null;
let cleanupEvents: (() => void) | null = null;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useFederationStore = create<FederationState>((set, get) => ({
  isOpen: false,
  peers: [],
  catalog: [],
  selectedHostId: null,
  activeTab: 'overview',
  data: {},
  lastEvent: null,

  init: () => {
    if (!window.api) return;
    cleanupPeers?.();
    cleanupEvents?.();

    cleanupPeers = window.api.onFederationPeersChanged?.((peers) => set({ peers })) || null;
    cleanupEvents =
      window.api.onFederationEvent?.((payload) => {
        set({ lastEvent: { hostId: payload.hostId, machineName: payload.machineName, event: payload.event, at: Date.now() } });

        // Очередь HITL и статусы агентов удалённого хоста должны обновляться сами: человек не
        // должен жать «обновить», чтобы увидеть запрос, который ждёт его решения.
        const { selectedHostId } = get();
        if (payload.hostId !== selectedHostId) return;
        if (payload.event.startsWith('ai:hitl') || payload.event.startsWith('agent:') || payload.event === 'backlog:changed') {
          void get().loadHostData(payload.hostId);
        }
      }) || null;

    void get().refreshPeers();
    void get().refreshCatalog();
  },

  open: (hostId) => {
    set({ isOpen: true, ...(hostId ? { selectedHostId: hostId } : {}) });
    void get().refreshPeers();
    void get().refreshCatalog();
    const target = hostId || get().selectedHostId;
    if (target) void get().loadHostData(target);
  },

  close: () => set({ isOpen: false }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  refreshPeers: async () => {
    if (!window.api?.listFederationPeers) return;
    try {
      set({ peers: await window.api.listFederationPeers() });
    } catch {
      // main ещё не поднял сервис — список останется прежним
    }
  },

  refreshCatalog: async () => {
    if (!window.api?.getFederationHosts) return;
    try {
      set({ catalog: await window.api.getFederationHosts() });
    } catch {
      // каталог недоступен — не ошибка интерфейса
    }
  },

  addPeer: async (options) => {
    if (!window.api?.addFederationPeer) return { ok: false, error: 'API недоступен' };
    try {
      const peer = await window.api.addFederationPeer(options);
      await get().refreshPeers();
      set({ selectedHostId: peer.hostId });
      await get().loadHostData(peer.hostId);
      return { ok: peer.status === 'connected', error: peer.error };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  removePeer: async (hostId) => {
    if (!window.api?.removeFederationPeer) return;
    const peers = await window.api.removeFederationPeer(hostId);
    const { selectedHostId, data } = get();
    const rest = { ...data };
    delete rest[hostId];
    set({ peers, data: rest, selectedHostId: selectedHostId === hostId ? null : selectedHostId });
  },

  connectPeer: async (hostId) => {
    if (!window.api?.connectFederationPeer) return { ok: false, error: 'API недоступен' };
    try {
      const peer = await window.api.connectFederationPeer(hostId);
      await get().refreshPeers();
      if (peer.status === 'connected') await get().loadHostData(hostId);
      return { ok: peer.status === 'connected', error: peer.error };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  disconnectPeer: async (hostId) => {
    if (!window.api?.disconnectFederationPeer) return;
    await window.api.disconnectFederationPeer(hostId);
    await get().refreshPeers();
  },

  selectHost: (hostId) => {
    set({ selectedHostId: hostId });
    if (hostId) void get().loadHostData(hostId);
  },

  loadHostData: async (hostId) => {
    if (!window.api?.federationCall) return;
    const peer = get().peers.find((p) => p.hostId === hostId);
    if (!peer || peer.status !== 'connected') {
      set((s) => ({
        data: {
          ...s.data,
          [hostId]: { ...(s.data[hostId] || emptyData), isLoading: false, error: peer?.error || 'Хост не подключён' }
        }
      }));
      return;
    }

    set((s) => ({ data: { ...s.data, [hostId]: { ...(s.data[hostId] || emptyData), isLoading: true, error: null } } }));

    try {
      const call = window.api.federationCall;
      const [status, projects, tasks, processes, approvals, swarms, roles] = await Promise.all([
        call<{ activeProjectPath?: string }>(hostId, 'get_status').catch(() => ({}) as { activeProjectPath?: string }),
        call<RemoteProjectInfo[]>(hostId, 'get_projects').catch(() => []),
        call<RemoteTaskInfo[]>(hostId, 'get_tasks').catch(() => []),
        call<RemoteProcessInfo[]>(hostId, 'get_processes').catch(() => []),
        call<RemoteApprovalInfo[]>(hostId, 'get_pending_approvals').catch(() => []),
        call<RemoteSwarmInfo[]>(hostId, 'get_swarms').catch(() => []),
        call<Array<{ slug: string; name: string }>>(hostId, 'get_roles').catch(() => [])
      ]);

      set((s) => ({
        data: {
          ...s.data,
          [hostId]: {
            projects: Array.isArray(projects) ? projects : [],
            activeProjectPath: status?.activeProjectPath || null,
            tasks: Array.isArray(tasks) ? tasks : [],
            processes: Array.isArray(processes) ? processes : [],
            approvals: Array.isArray(approvals) ? approvals : [],
            swarms: Array.isArray(swarms) ? swarms : [],
            roles: Array.isArray(roles) ? roles : [],
            isLoading: false,
            error: null
          }
        }
      }));
    } catch (err) {
      set((s) => ({
        data: { ...s.data, [hostId]: { ...(s.data[hostId] || emptyData), isLoading: false, error: errorText(err) } }
      }));
    }
  },

  selectRemoteProject: async (hostId, projectPath) => {
    if (!window.api?.federationCall) return;
    try {
      await window.api.federationCall(hostId, 'select_project', { projectPath });
      await get().loadHostData(hostId);
    } catch (err) {
      set((s) => ({ data: { ...s.data, [hostId]: { ...(s.data[hostId] || emptyData), error: errorText(err) } } }));
    }
  },

  decideRemoteApproval: async (hostId, requestId, approved) => {
    if (!window.api?.federationCall) return { ok: false, error: 'API недоступен' };
    try {
      // Решение всегда адресуется по requestId (TASK-57): хост применит его один раз, откуда бы
      // оно ни пришло — с телефона, из своего окна или отсюда.
      const res = await window.api.federationCall<{ ok?: boolean; reason?: string }>(hostId, 'hitl_decision', {
        requestId,
        decision: approved ? 'allow' : 'deny'
      });
      await get().loadHostData(hostId);
      return { ok: Boolean(res?.ok), error: res?.reason };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  runRemoteAssignedAgent: async (hostId, options) => {
    if (!window.api?.federationCall) return { ok: false, error: 'API недоступен' };
    try {
      await window.api.federationCall(hostId, 'start_assigned_agent', {
        projectPath: options.projectPath,
        taskId: options.taskId,
        taskTitle: options.taskTitle,
        roleSlug: options.roleSlug,
        hostId
      });
      await get().loadHostData(hostId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  updateRemoteTaskStatus: async (hostId, filePath, newStatus) => {
    if (!window.api?.federationCall) return { ok: false, error: 'API недоступен' };
    try {
      await window.api.federationCall(hostId, 'update_task_status', { filePath, newStatus });
      await get().loadHostData(hostId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  },

  remoteProcessAction: async (hostId, action, processId) => {
    if (!window.api?.federationCall) return { ok: false, error: 'API недоступен' };
    try {
      await window.api.federationCall(hostId, action === 'stop' ? 'stop_process' : 'restart_process', { processId });
      await get().loadHostData(hostId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  }
}));
