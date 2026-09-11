import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Server,
  Plus,
  RefreshCw,
  Wifi,
  Globe,
  Play,
  Square,
  RotateCw,
  Check,
  Ban,
  Bot,
  ListChecks,
  Activity,
  AlertTriangle,
  Trash2,
  Link2,
  Unlink
} from 'lucide-react';
import { useFederationStore, type RemoteHostTab } from '../../store/useFederationStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { parseAssignee } from '../../utils/assignee';
import type { FederationPeerState, FederationTransport } from '../../types/remote';

/**
 * Hub-режим федерации (TASK-66, decision-11 п.4): проекты, задачи, процессы, агенты и очередь
 * HITL другого компьютера в этом же интерфейсе, с явной пометкой хоста.
 *
 * Модалка рендерится через `createPortal` в `document.body` c `z-[9999]` — по правилу 19
 * infra-dev (decision-17): инлайн внутри сайдбара она оказалась бы за `backdrop-filter` предка.
 */

const statusDot: Record<FederationPeerState['status'], string> = {
  idle: 'bg-slate-500',
  connecting: 'bg-amber-400 animate-pulse',
  connected: 'bg-emerald-400',
  offline: 'bg-slate-600',
  error: 'bg-red-500'
};

interface AddPeerForm {
  hostId: string;
  machineName: string;
  transport: FederationTransport;
  address: string;
  secretKey: string;
  pin: string;
}

const emptyForm: AddPeerForm = {
  hostId: '',
  machineName: '',
  transport: 'lan',
  address: '',
  secretKey: '',
  pin: ''
};

export const RemoteHostsModal: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    isOpen,
    close,
    peers,
    catalog,
    selectedHostId,
    selectHost,
    activeTab,
    setActiveTab,
    data,
    refreshPeers,
    refreshCatalog,
    addPeer,
    removePeer,
    connectPeer,
    disconnectPeer,
    loadHostData,
    selectRemoteProject,
    decideRemoteApproval,
    runRemoteAssignedAgent,
    remoteProcessAction
  } = useFederationStore();

  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<AddPeerForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void refreshPeers();
    void refreshCatalog();
  }, [isOpen, refreshPeers, refreshCatalog]);

  const selectedPeer = useMemo(() => peers.find((p) => p.hostId === selectedHostId) || null, [peers, selectedHostId]);
  const hostData = selectedHostId ? data[selectedHostId] : undefined;

  /** Хосты из каталога релея/LAN, с которыми ещё не сопряжены — их можно добавить в один клик. */
  const discovered = useMemo(
    () => catalog.filter((h) => h.source !== 'self' && !peers.some((p) => p.hostId === h.hostId)),
    [catalog, peers]
  );

  if (!isOpen) return null;

  const submitPeer = async () => {
    setFormError(null);
    if (!form.hostId.trim() || !form.address.trim()) {
      setFormError(t.federation.fieldHostId);
      return;
    }
    setIsSubmitting(true);
    const result = await addPeer({
      hostId: form.hostId.trim(),
      machineName: form.machineName.trim() || undefined,
      transport: form.transport,
      address: form.address.trim(),
      secretKey: form.secretKey.trim() || undefined,
      pin: form.pin.trim() || undefined
    });
    setIsSubmitting(false);
    if (result.ok) {
      setIsAdding(false);
      setForm(emptyForm);
    } else {
      setFormError(result.error || t.federation.notConnected);
    }
  };

  const handleRemove = async (hostId: string) => {
    const confirmed = await dialog.confirm({ message: t.federation.removeConfirm, title: t.federation.remove });
    if (confirmed) await removePeer(hostId);
  };

  const renderTab = () => {
    if (!selectedPeer) {
      return <div className="flex-1 flex items-center justify-center text-sm text-slate-500">{t.federation.selectHostHint}</div>;
    }

    if (selectedPeer.status !== 'connected') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <p className="text-sm text-slate-300">{selectedPeer.error || t.federation.notConnected}</p>
          <p className="text-xs text-slate-500 max-w-md">{t.federation.offlineHint}</p>
          <button
            type="button"
            onClick={() => void connectPeer(selectedPeer.hostId)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition"
          >
            <Link2 className="w-3.5 h-3.5" />
            {t.federation.connect}
          </button>
        </div>
      );
    }

    if (hostData?.isLoading && !hostData.tasks.length) {
      return <div className="flex-1 flex items-center justify-center text-sm text-slate-500">{t.federation.loading}</div>;
    }

    if (activeTab === 'overview') {
      const catalogEntry = catalog.find((h) => h.hostId === selectedPeer.hostId);
      const stats = [
        { label: t.federation.overviewProjects, value: hostData?.projects.length ?? 0, icon: Server },
        { label: t.federation.overviewProcesses, value: hostData?.processes.length ?? 0, icon: Activity },
        { label: t.federation.overviewAgents, value: hostData?.swarms.length ?? 0, icon: Bot },
        { label: t.federation.overviewHitl, value: hostData?.approvals.length ?? 0, icon: ListChecks }
      ];

      return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stats.map((s) => (
              <div key={s.label} className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <s.icon className="w-3.5 h-3.5" />
                  {s.label}
                </div>
                <div className="text-xl font-semibold text-slate-100 mt-1">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-xs text-slate-400 space-y-1">
            <div>
              {t.federation.overviewVersion}: <span className="text-slate-200">{catalogEntry?.appVersion || '—'}</span>
            </div>
            <div>
              {t.federation.overviewProtocol}: <span className="text-slate-200">{selectedPeer.protocolVersion ?? '—'}</span>
            </div>
            <div>
              {t.federation.activeProject}: <span className="text-slate-200">{hostData?.activeProjectPath || '—'}</span>
            </div>
          </div>

          <div className="space-y-1">
            {hostData?.projects.length ? (
              hostData.projects.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => void selectRemoteProject(selectedPeer.hostId, p.path)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition ${
                    hostData.activeProjectPath === p.path
                      ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200'
                      : 'border-slate-700/60 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="font-medium">{p.name || p.path}</div>
                  <div className="text-[10px] text-slate-500 truncate">{p.path}</div>
                </button>
              ))
            ) : (
              <p className="text-xs text-slate-500">{t.federation.noProjects}</p>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'tasks') {
      return (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {hostData?.tasks.length ? (
            hostData.tasks.map((task) => {
              const assigned = parseAssignee(task.assignee?.[0]);
              const roleSlug = assigned?.kind === 'agent' ? assigned.roleSlug : null;
              return (
                <div key={task.id} className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-200 truncate">
                        {task.id} — {task.title}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {task.status}
                        {assigned ? ` · ${assigned.raw}` : ''}
                      </div>
                    </div>
                    {roleSlug && hostData.activeProjectPath && (
                      <button
                        type="button"
                        title={t.federation.runAssigned}
                        onClick={() =>
                          void runRemoteAssignedAgent(selectedPeer.hostId, {
                            projectPath: hostData.activeProjectPath as string,
                            taskId: task.id,
                            taskTitle: task.title,
                            roleSlug
                          })
                        }
                        className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-[10px] font-medium text-white transition"
                      >
                        <Play className="w-3 h-3" />
                        {t.federation.runAssigned}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-xs text-slate-500">{t.federation.noTasks}</p>
          )}
        </div>
      );
    }

    if (activeTab === 'processes') {
      return (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {hostData?.processes.length ? (
            hostData.processes.map((proc) => (
              <div key={proc.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{proc.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {proc.status}
                    {proc.port ? ` · :${proc.port}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    title={t.federation.restartProcess}
                    onClick={() => void remoteProcessAction(selectedPeer.hostId, 'restart', proc.id)}
                    className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title={t.federation.stopProcess}
                    onClick={() => void remoteProcessAction(selectedPeer.hostId, 'stop', proc.id)}
                    className="p-1.5 rounded-md bg-red-600/70 hover:bg-red-500 text-white transition"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500">{t.federation.noProcesses}</p>
          )}
        </div>
      );
    }

    if (activeTab === 'agents') {
      return (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {hostData?.swarms.length ? (
            hostData.swarms.map((swarm) => (
              <div key={swarm.id} className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                <div className="text-xs font-semibold text-slate-200">
                  {swarm.taskId ? `${swarm.taskId} — ` : ''}
                  {swarm.taskTitle || swarm.mode}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {swarm.status} · {swarm.origin || swarm.mode}
                </div>
                <div className="mt-2 space-y-1">
                  {swarm.agents.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="truncate">
                        {agent.name}
                        {agent.roleSlug ? ` · ${agent.roleSlug}` : ''}
                      </span>
                      <span className={agent.status === 'running' ? 'text-emerald-400' : 'text-slate-500'}>{agent.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500">{t.federation.noAgents}</p>
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {hostData?.approvals.length ? (
          hostData.approvals.map((req) => (
            <div key={req.requestId} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="text-xs font-semibold text-amber-100">{req.title || req.tool || req.type}</div>
              {req.command && <pre className="mt-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all">{req.command}</pre>}
              {req.filePath && <div className="mt-1 text-[10px] text-slate-500 truncate">{req.filePath}</div>}
              <div className="text-[10px] text-slate-500 mt-1">
                {req.agentName || req.sessionId}
                {req.role ? ` · ${req.role}` : ''}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void decideRemoteApproval(selectedPeer.hostId, req.requestId, true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[11px] font-medium text-white transition"
                >
                  <Check className="w-3 h-3" />
                  {t.federation.approve}
                </button>
                <button
                  type="button"
                  onClick={() => void decideRemoteApproval(selectedPeer.hostId, req.requestId, false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-[11px] font-medium text-slate-100 transition"
                >
                  <Ban className="w-3 h-3" />
                  {t.federation.deny}
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500">{t.federation.noApprovals}</p>
        )}
      </div>
    );
  };

  const tabs: Array<{ id: RemoteHostTab; label: string }> = [
    { id: 'overview', label: t.federation.tabOverview },
    { id: 'tasks', label: t.federation.tabTasks },
    { id: 'processes', label: t.federation.tabProcesses },
    { id: 'agents', label: t.federation.tabAgents },
    { id: 'hitl', label: t.federation.tabHitl }
  ];

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-5xl h-[80vh] flex flex-col rounded-2xl border border-slate-700/70 bg-[#12141f] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              {t.federation.title}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{t.federation.subtitle}</p>
          </div>
          <button type="button" onClick={close} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Список хостов */}
          <div className="w-64 shrink-0 border-r border-slate-800 flex flex-col">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t.federation.hostsSection}</div>
                {peers.length ? (
                  <div className="space-y-1">
                    {peers.map((peer) => (
                      <div
                        key={peer.hostId}
                        className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition ${
                          peer.hostId === selectedHostId
                            ? 'border-indigo-500/60 bg-indigo-500/10'
                            : 'border-slate-700/60 bg-slate-900/40 hover:bg-slate-800/60'
                        }`}
                        onClick={() => selectHost(peer.hostId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[peer.status]}`} />
                          <span className="text-xs font-medium text-slate-200 truncate flex-1">{peer.machineName}</span>
                          {peer.transport === 'lan' ? (
                            <Wifi className="w-3 h-3 text-slate-500" />
                          ) : (
                            <Globe className="w-3 h-3 text-slate-500" />
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {t.federation.status[peer.status]}
                          {peer.rights ? ` · ${t.federation.rights[peer.rights]}` : ''}
                        </div>
                        <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition">
                          {peer.status === 'connected' ? (
                            <button
                              type="button"
                              title={t.federation.disconnect}
                              onClick={(e) => {
                                e.stopPropagation();
                                void disconnectPeer(peer.hostId);
                              }}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
                            >
                              <Unlink className="w-3 h-3" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title={t.federation.connect}
                              onClick={(e) => {
                                e.stopPropagation();
                                void connectPeer(peer.hostId);
                              }}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400"
                            >
                              <Link2 className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            title={t.federation.remove}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRemove(peer.hostId);
                            }}
                            className="p-1 rounded bg-slate-800 hover:bg-red-600/70 text-slate-400 hover:text-white"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 space-y-1">
                    <p>{t.federation.noPeers}</p>
                    <p className="text-[10px] text-slate-600">{t.federation.noPeersHint}</p>
                  </div>
                )}
              </div>

              {discovered.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{t.federation.discoveredSection}</div>
                  <div className="space-y-1">
                    {discovered.map((host) => (
                      <button
                        key={host.hostId}
                        type="button"
                        onClick={() => {
                          setForm({
                            ...emptyForm,
                            hostId: host.hostId,
                            machineName: host.machineName,
                            transport: host.localIps?.length ? 'lan' : 'relay',
                            address: host.localIps?.length ? `${host.localIps[0]}:${host.port || 42050}` : ''
                          });
                          setIsAdding(true);
                        }}
                        className="w-full text-left rounded-lg border border-slate-700/60 bg-slate-900/40 hover:bg-slate-800/60 px-2.5 py-2 transition"
                      >
                        <div className="text-xs text-slate-200 truncate">{host.machineName}</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {host.isOnline ? host.platform : t.federation.status.offline}
                          {host.protocolIncompatible ? ` · ${t.federation.protocolMismatch}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAdding(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                {t.federation.addPeer}
              </button>
            </div>
          </div>

          {/* Контент хоста */}
          <div className="flex-1 flex flex-col min-w-0">
            {isAdding ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                <h3 className="text-xs font-semibold text-slate-200">{t.federation.addPeerTitle}</h3>
                {[
                  { key: 'hostId' as const, label: t.federation.fieldHostId },
                  { key: 'machineName' as const, label: t.federation.fieldMachineName }
                ].map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{field.label}</span>
                    <input
                      value={form[field.key]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                ))}

                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">{t.federation.fieldTransport}</span>
                  <select
                    value={form.transport}
                    onChange={(e) => setForm({ ...form, transport: e.target.value as FederationTransport })}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="lan">{t.federation.transportLan}</option>
                    <option value="relay">{t.federation.transportRelay}</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">{t.federation.fieldAddress}</span>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder={form.transport === 'lan' ? t.federation.fieldAddressLanHint : t.federation.fieldAddressRelayHint}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </label>

                {[
                  { key: 'secretKey' as const, label: t.federation.fieldSecretKey },
                  { key: 'pin' as const, label: t.federation.fieldPin }
                ].map((field) => (
                  <label key={field.key} className="block">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{field.label}</span>
                    <input
                      type="password"
                      value={form[field.key]}
                      onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </label>
                ))}

                {formError && <p className="text-[11px] text-red-400">{formError}</p>}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void submitPeer()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-medium text-white transition"
                  >
                    {t.federation.save}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdding(false);
                      setFormError(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition"
                  >
                    {t.federation.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-800">
                  <div className="flex items-center gap-1">
                    {tabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                          activeTab === tab.id ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {tab.label}
                        {tab.id === 'hitl' && hostData?.approvals.length ? ` (${hostData.approvals.length})` : ''}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    title={t.federation.refresh}
                    disabled={!selectedHostId}
                    onClick={() => selectedHostId && void loadHostData(selectedHostId)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 disabled:opacity-40 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${hostData?.isLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {hostData?.error && (
                  <div className="px-4 py-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">{hostData.error}</div>
                )}

                {renderTab()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
