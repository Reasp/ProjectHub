import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldAlert,
  ShieldCheck,
  X,
  History,
  ListChecks,
  Check,
  Ban,
  RefreshCw,
  Download,
  Terminal,
  FileCode,
  HelpCircle,
  GitFork,
  Clock,
  Bot,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  FolderOpen
} from 'lucide-react';
import { useHitlStore } from '../../store/useHitlStore';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useToast } from '../../hooks/useTimeoutState';
import { InteractiveApprovalCard } from '../ai/InteractiveApprovalCard';
import type { ApprovalRequest, HitlAuditEntry, HitlDecisionSourceKind } from '../../types/electron';

const DECIDED_BY: HitlDecisionSourceKind[] = ['local', 'remote', 'mcp', 'auto', 'timeout', 'cancelled', 'shutdown'];

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

const TypeIcon: React.FC<{ type: ApprovalRequest['type']; className?: string }> = ({ type, className = 'w-4 h-4' }) => {
  if (type === 'command') return <Terminal className={className} />;
  if (type === 'file_write') return <FileCode className={className} />;
  if (type === 'subagent_dispatch') return <GitFork className={className} />;
  return <HelpCircle className={className} />;
};

const originStyle: Record<string, string> = {
  studio: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  swarm: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  handoff: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  assigned: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
};

export const HitlCenterModal: React.FC = () => {
  const { t } = useTranslation();
  const {
    isCenterOpen,
    closeCenter,
    centerTab,
    setCenterTab,
    pending,
    decide,
    refreshPending,
    audit,
    auditMonths,
    auditQuery,
    setAuditQuery,
    loadAudit,
    isAuditLoading,
    auditInfo,
    exportAudit
  } = useHitlStore();
  const { projects } = useProjectStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Уведомление гаснет само; таймер снимается при размонтировании (TASK-50)
  const [notice, showNotice] = useToast<string>(4000);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isCenterOpen) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isCenterOpen]);

  useEffect(() => {
    if (!isCenterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !expandedId) closeCenter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCenterOpen, expandedId, closeCenter]);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.path, p.name]));
    return (path: string) => map.get(path) || baseName(path);
  }, [projects]);

  if (!isCenterOpen) return null;

  const handleDecide = async (request: ApprovalRequest, approved: boolean, text?: string) => {
    const result = await decide(request.id, approved, text);
    setExpandedId(null);
    if (!result.ok) {
      showNotice(result.reason === 'already_decided' ? t.hitl.decideAlready : t.hitl.decideNotFound);
    }
  };

  const handleExport = async (format: 'jsonl' | 'json' | 'csv') => {
    const res = await exportAudit(format);
    if (res.success && res.path) showNotice(t.hitl.exported.replace('{path}', res.path));
    else if (!res.canceled) showNotice(t.hitl.exportError.replace('{error}', res.error || '?'));
  };

  const renderQueue = () => {
    if (pending.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <ShieldCheck className="w-10 h-10 text-emerald-400/70" />
          <div className="text-sm font-semibold text-slate-200">{t.hitl.queueEmpty}</div>
          <div className="text-xs text-slate-500 max-w-sm">{t.hitl.queueEmptyHint}</div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {pending.map((req) => {
          const isExpanded = expandedId === req.id;
          const origin = req.origin || 'studio';
          const waited = now - req.createdAt;
          const left = typeof req.expiresAt === 'number' ? req.expiresAt - now : null;
          return (
            <div
              key={req.id}
              className={`rounded-xl border bg-[#141726] transition ${
                req.orphaned ? 'border-slate-700/60 opacity-80' : 'border-amber-500/40 shadow-sm shadow-amber-900/20'
              }`}
            >
              <div className="px-4 py-3 flex items-start gap-3">
                <div className={`p-1.5 rounded-lg border shrink-0 ${req.orphaned ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
                  <TypeIcon type={req.type} />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${originStyle[origin] || originStyle.studio}`}>
                      {t.hitl.origin[origin as keyof typeof t.hitl.origin] || origin}
                    </span>
                    {(req.agentName || req.role) && (
                      <span className="text-[11px] text-slate-300 flex items-center gap-1">
                        <Bot className="w-3 h-3 text-slate-500" />
                        {req.agentName || req.agentId}
                        {req.role ? <span className="text-slate-500">/ {req.role}</span> : null}
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 truncate" title={req.projectPath}>
                      <FolderOpen className="w-3 h-3 text-slate-500" />
                      {projectName(req.projectPath)}
                    </span>
                    {req.tool && <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">{req.tool}</span>}
                  </div>
                  <div className="text-xs font-semibold text-slate-100 break-words">{req.title}</div>
                  {req.command && (
                    <pre className="text-[11px] font-mono text-amber-200/90 bg-[#0c0e17] border border-slate-800 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-all max-h-24 overflow-auto">
                      $ {req.command}
                    </pre>
                  )}
                  {!req.command && req.filePath && (
                    <div className="text-[11px] font-mono text-slate-300 truncate" title={req.filePath}>{req.filePath}</div>
                  )}
                  {req.details && !req.command && <div className="text-[11px] text-slate-400 line-clamp-2">{req.details}</div>}
                  <div className="flex items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{t.hitl.waitingFor.replace('{time}', formatDuration(waited))}</span>
                    {left !== null && <span>{t.hitl.expiresIn.replace('{time}', formatDuration(left))}</span>}
                    <span className="font-mono text-slate-600">{req.id}</span>
                  </div>
                  {req.orphaned && (
                    <div className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {t.hitl.orphanedNotice}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {req.type !== 'question' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDecide(req, true)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {t.aiStudio.approval.approve}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecide(req, false)}
                        className="px-3 py-1.5 rounded-lg bg-rose-600/70 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        {t.aiStudio.approval.reject}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : req.id)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1.5 transition"
                  >
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {isExpanded ? t.hitl.hideDetails : t.hitl.showDetails}
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="px-4 pb-3 border-t border-slate-800/70">
                  <InteractiveApprovalCard
                    key={req.id}
                    request={req}
                    onApprove={(text) => handleDecide(req, true, text)}
                    onReject={(text) => handleDecide(req, false, text)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAuditRow = (e: HitlAuditEntry, idx: number) => {
    const by = e.decidedBy ? t.hitl.by[e.decidedBy] : '';
    const action = e.commandPreview
      ? `$ ${e.commandPreview}`
      : e.filePath || e.title || e.tool || '';
    return (
      <tr key={`${e.requestId}-${e.ts}-${idx}`} className="border-t border-slate-800/60 hover:bg-slate-800/30 align-top">
        <td className="px-2 py-1.5 whitespace-nowrap text-slate-400 font-mono text-[10px]">{new Date(e.ts).toLocaleString()}</td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
            e.kind === 'fallback' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
              : e.kind === 'outcome' ? 'bg-slate-700/40 text-slate-300 border-slate-600/50'
                : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
          }`}>{t.hitl.kind[e.kind]}</span>
        </td>
        <td className="px-2 py-1.5 text-slate-300 max-w-[160px]">
          <div className="truncate" title={`${e.origin || ''} ${e.agentName || ''} ${e.role || ''}`}>
            <span className="text-slate-500">{e.origin ? t.hitl.origin[e.origin] : ''}</span>
            {e.agentName ? ` · ${e.agentName}` : ''}
            {e.role ? <span className="text-slate-500"> / {e.role}</span> : null}
          </div>
          <div className="text-[10px] text-slate-500 truncate" title={e.projectPath}>{projectName(e.projectPath)}</div>
        </td>
        <td className="px-2 py-1.5 text-slate-200 max-w-[360px]">
          <div className="flex items-center gap-1.5">
            {e.tool && <span className="text-[10px] font-mono text-slate-500 shrink-0">{e.tool}</span>}
            <span className="truncate font-mono text-[11px]" title={action}>{action}</span>
          </div>
          {e.kind === 'outcome' && e.outcome && (
            <div className="text-[10px] text-slate-400">{t.hitl.outcome[e.outcome]}{e.detail ? `: ${e.detail}` : ''}</div>
          )}
          {e.kind === 'fallback' && e.detail && <div className="text-[10px] text-rose-300/80">{e.detail}</div>}
          {e.comment && <div className="text-[10px] text-slate-400 italic">«{e.comment}»</div>}
        </td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          {e.decision && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${e.decision === 'allow' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
              {e.decision === 'allow' ? t.hitl.decisionAllow : t.hitl.decisionDeny}
            </span>
          )}
          {e.kind === 'decision' && e.outcome === 'session_gone' && (
            <div className="text-[10px] text-slate-500">{t.hitl.outcome.session_gone}</div>
          )}
        </td>
        <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap text-[11px]">
          {by}
          {e.deviceName ? <div className="text-[10px] text-slate-500">{e.deviceName}</div> : null}
          {e.rule ? <div className="text-[10px] font-mono text-slate-500">{e.rule}</div> : null}
        </td>
        <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap text-[10px] font-mono">
          {typeof e.waitedMs === 'number' ? formatDuration(e.waitedMs) : ''}
        </td>
      </tr>
    );
  };

  const renderHistory = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={auditQuery.month || ''}
          onChange={(e) => setAuditQuery({ month: e.target.value || undefined })}
          className="bg-[#0c0e17] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          title={t.hitl.filterMonth}
        >
          <option value="">{t.hitl.filterAllMonths}</option>
          {auditMonths.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={auditQuery.decidedBy || ''}
          onChange={(e) => setAuditQuery({ decidedBy: (e.target.value || undefined) as HitlDecisionSourceKind | undefined })}
          className="bg-[#0c0e17] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          title={t.hitl.filterBy}
        >
          <option value="">{t.hitl.filterBy}: {t.hitl.filterAny}</option>
          {DECIDED_BY.map((k) => <option key={k} value={k}>{t.hitl.by[k]}</option>)}
        </select>
        <select
          value={auditQuery.decision || ''}
          onChange={(e) => setAuditQuery({ decision: (e.target.value || undefined) as 'allow' | 'deny' | undefined })}
          className="bg-[#0c0e17] border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          title={t.hitl.filterDecision}
        >
          <option value="">{t.hitl.filterDecision}: {t.hitl.filterAny}</option>
          <option value="allow">{t.hitl.decisionAllow}</option>
          <option value="deny">{t.hitl.decisionDeny}</option>
        </select>
        <input
          type="text"
          defaultValue={auditQuery.search || ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setAuditQuery({ search: (e.target as HTMLInputElement).value.trim() || undefined });
          }}
          onBlur={(e) => {
            const v = e.target.value.trim() || undefined;
            if (v !== auditQuery.search) setAuditQuery({ search: v });
          }}
          placeholder={t.hitl.filterSearch}
          className="flex-1 min-w-[180px] bg-[#0c0e17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={() => loadAudit()}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
          title={t.hitl.refresh}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isAuditLoading ? 'animate-spin' : ''}`} />
        </button>
        <div className="flex items-center gap-1">
          {(['csv', 'jsonl', 'json'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => handleExport(fmt)}
              className="px-2 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 border border-indigo-500/40 text-[11px] font-medium transition flex items-center gap-1"
              title={`${t.hitl.export} ${fmt.toUpperCase()}`}
            >
              <Download className="w-3 h-3" />
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {audit.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <History className="w-10 h-10 text-slate-600" />
          <div className="text-sm text-slate-400">{t.hitl.historyEmpty}</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-auto max-h-[52vh]">
          <table className="w-full text-xs">
            <thead className="bg-[#10121c] text-[10px] uppercase tracking-wider text-slate-500 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colTime}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colEvent}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colAgent}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colAction}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colDecision}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colBy}</th>
                <th className="px-2 py-2 text-left font-semibold">{t.hitl.colWaited}</th>
              </tr>
            </thead>
            <tbody>{audit.map(renderAuditRow)}</tbody>
          </table>
        </div>
      )}
      {auditInfo?.auditDir && (
        <div className="text-[10px] text-slate-600 font-mono truncate" title={auditInfo.auditDir}>
          {t.hitl.auditDir}: {auditInfo.auditDir}
        </div>
      )}
    </div>
  );

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCenter(); }}>
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-[#12151f] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 bg-[#161a27]">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-xl border ${pending.length > 0 ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>
              {pending.length > 0 ? <ShieldAlert className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">{t.hitl.title}</h2>
              <p className="text-[11px] text-slate-400 truncate">{t.hitl.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5 bg-[#0c0e17] p-0.5 rounded-lg border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setCenterTab('queue')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition ${centerTab === 'queue' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <ListChecks className="w-3.5 h-3.5" />
                {t.hitl.tabQueue}
                {pending.length > 0 && <span className="ml-1 text-[10px] bg-amber-500 text-black font-bold rounded-full px-1.5">{pending.length}</span>}
              </button>
              <button
                type="button"
                onClick={() => setCenterTab('history')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 font-medium transition ${centerTab === 'history' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <History className="w-3.5 h-3.5" />
                {t.hitl.tabHistory}
              </button>
            </div>
            {centerTab === 'queue' && (
              <button
                type="button"
                onClick={() => refreshPending()}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition"
                title={t.hitl.refresh}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="button" onClick={closeCenter} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {notice && (
          <div className="px-5 py-2 bg-indigo-950/70 border-b border-indigo-500/40 text-xs text-indigo-100">{notice}</div>
        )}

        <div className="flex-1 overflow-auto p-5">
          {centerTab === 'queue' ? renderQueue() : renderHistory()}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
