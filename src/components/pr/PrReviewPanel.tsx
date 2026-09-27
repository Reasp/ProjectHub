import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, Play, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useRolesStore } from '../../store/useRolesStore';
import type { PrReviewFinding, PrReviewRecord } from '../../types/electron';

/**
 * Ревью PR агентами во вкладке PR (TASK-81, decision-53 п. 9): запуск человеком, история ревью этого
 * PR с находками и их проверкой, стоимость, публикация комментария кнопкой, переход в сессии роя.
 */

interface Props {
  projectPath: string;
  prNumber: number;
  prOpen: boolean;
  hasCli: boolean;
}

const MAX_REVIEWERS = 3;
const PREFS_KEY = 'projecthub.prReview.prefs';

interface Prefs {
  reviewers: string[];
  verifier: string;
  budget: string;
  publish: 'hitl' | 'manual';
}

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) return { reviewers: [], verifier: '', budget: '1', publish: 'hitl', ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // хранилище недоступно — значения по умолчанию
  }
  return { reviewers: [], verifier: '', budget: '1', publish: 'hitl' };
}

function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // удобство, а не данные: без хранилища просто не запоминаем
  }
}

const SEVERITY_CLS: Record<PrReviewFinding['severity'], string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  major: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  minor: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  nit: 'bg-slate-500/10 text-slate-400 border-slate-600/40'
};

const VERDICT_CLS: Record<string, string> = {
  confirmed: 'text-emerald-300',
  refuted: 'text-slate-500 line-through',
  uncertain: 'text-amber-300',
  unverified: 'text-slate-400'
};

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), template);
}

export const PrReviewPanel: React.FC<Props> = ({ projectPath, prNumber, prOpen, hasCli }) => {
  const { t, language } = useTranslation();
  const p = t.prReview;
  const rolesByProject = useRolesStore((s) => s.rolesByProject);
  const loadRoles = useRolesStore((s) => s.loadRolesAction);
  const [reviews, setReviews] = useState<PrReviewRecord[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void loadRoles(projectPath);
  }, [loadRoles, projectPath]);
  const roles = useMemo(() => rolesByProject[projectPath] ?? [], [rolesByProject, projectPath]);

  const refresh = useCallback(async () => {
    const res = await window.api.listPrReviews(projectPath, prNumber);
    setReviews(res.reviews);
    if (!res.ok && res.error) setNotice({ kind: 'error', text: res.error });
  }, [projectPath, prNumber]);

  useEffect(() => {
    void refresh();
    return window.api.onPrReviewChanged(() => void refresh());
  }, [refresh]);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });

  const toggleReviewer = (slug: string) =>
    update({ reviewers: prefs.reviewers.includes(slug) ? prefs.reviewers.filter((r) => r !== slug) : [...prefs.reviewers, slug].slice(0, MAX_REVIEWERS) });

  const start = async (force: boolean) => {
    setBusy(true);
    setNotice(null);
    const budget = Number(prefs.budget.replace(',', '.'));
    const res = await window.api.startPrReview(projectPath, prNumber, {
      reviewers: prefs.reviewers,
      ...(prefs.verifier ? { verifier: prefs.verifier } : {}),
      ...(Number.isFinite(budget) && budget > 0 ? { budgetUsd: budget } : {}),
      publish: prefs.publish,
      force
    });
    setBusy(false);
    setNotice(res.ok ? { kind: 'ok', text: p.started } : { kind: 'error', text: res.error });
    await refresh();
  };

  const publish = async (review: PrReviewRecord) => {
    const res = await window.api.publishPrReview(projectPath, review.id);
    setNotice(res.ok ? { kind: 'ok', text: p.published } : { kind: 'error', text: res.error });
    await refresh();
  };

  const openSession = (swarmId: string) => {
    void window.api.notificationNavigate({ type: 'openSwarm', projectPath, sessionId: swarmId });
  };

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const latestHead = reviews[0]?.headSha;
  const canStart = hasCli && prOpen && prefs.reviewers.length > 0 && !busy;

  const renderFinding = (f: PrReviewFinding) => {
    const verdict = f.verdict ?? 'unverified';
    return (
      <div key={f.id} className={`rounded-md border border-slate-800 bg-[#0f121b] p-3 ${verdict === 'refuted' ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-mono text-slate-500">{f.id}</span>
          <span className={`rounded border px-1.5 py-0.5 ${SEVERITY_CLS[f.severity]}`}>{p.severity[f.severity]}</span>
          <span className="font-mono text-indigo-300">
            {f.file}
            {f.line ? `:${f.line}${f.endLine ? `-${f.endLine}` : ''}` : ''}
          </span>
          <span className={`font-semibold ${VERDICT_CLS[verdict]}`}>{p.verdict[verdict]}</span>
          {f.agreement > 1 && <span className="text-slate-400">{fill(p.agreement, { n: f.agreement })}</span>}
        </div>
        <div className="mt-1 text-xs font-medium text-slate-200">{f.title}</div>
        <div className="mt-1 text-xs text-slate-400 whitespace-pre-wrap">{f.description}</div>
        {f.suggestion && (
          <div className="mt-1 text-[11px] text-slate-400">
            <b className="text-slate-300">{p.suggestion}:</b> {f.suggestion}
          </div>
        )}
        {(f.verdictEvidence || f.verdictReason) && (
          <div className="mt-1 text-[11px] text-slate-500 whitespace-pre-wrap">
            <b>{p.evidence}:</b> {f.verdictEvidence || f.verdictReason}
          </div>
        )}
      </div>
    );
  };

  const renderReview = (review: PrReviewRecord) => {
    const canPublish = Boolean(review.comment) && ['none', 'declined', 'failed'].includes(review.publish.state);
    return (
      <div key={review.id} className="rounded-xl border border-slate-800 bg-[#141722] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-200">{new Date(review.startedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span className="font-mono text-slate-400">{fill(p.head, { sha: review.headSha.slice(0, 7) })}</span>
          <span className={review.status === 'failed' ? 'text-rose-300' : review.status === 'running' ? 'text-sky-300' : 'text-emerald-300'}>
            {review.status === 'running' ? p.stage[review.stage] : p.status[review.status]}
          </span>
          {review.costUsd !== undefined && <span className="text-slate-400">{fill(p.cost, { cost: review.costUsd.toFixed(2) })}</span>}
          <span className="text-slate-400">· {p.publishState[review.publish.state]}</span>
          <span className="flex-1" />
          {review.swarmIds.map((id, i) => (
            <button key={id} type="button" onClick={() => openSession(id)} className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:underline">
              <ExternalLink className="w-3 h-3" />
              {i === 0 ? p.sessionReview : p.sessionVerify}
            </button>
          ))}
        </div>
        {review.error && <div className="text-xs text-rose-300 whitespace-pre-wrap">{review.error}</div>}
        {review.publish.error && <div className="text-xs text-amber-300">{review.publish.error}</div>}
        <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
          {review.reviewers.map((r, i) => (
            <span key={`${r.roleSlug}-${i}`} className="rounded border border-slate-700 px-2 py-0.5" title={r.error || r.summary}>
              {r.name}: {r.status === 'done' ? fill(p.reviewerFindings, { n: r.findings }) : p.status[r.status === 'pending' ? 'running' : 'failed']}
            </span>
          ))}
          {review.verifier && (
            <span className="rounded border border-slate-700 px-2 py-0.5" title={review.verifier.error}>
              {p.verifierLabel}: {review.verifier.name || review.verifier.roleSlug} — {p.verifierStatus[review.verifier.status]}
            </span>
          )}
        </div>
        {review.findings.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{p.findings}</h4>
            {review.findings.map(renderFinding)}
          </div>
        )}
        {review.status === 'done' && !review.comment && <div className="text-xs text-slate-400">{p.noConfirmed}</div>}
        {review.comment && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-400">{p.showComment}</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0b0d13] p-3 text-slate-300 select-text">{review.comment}</pre>
          </details>
        )}
        <div className="flex items-center gap-2">
          {canPublish && (
            <button type="button" onClick={() => void publish(review)} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
              <Send className="w-3.5 h-3.5" />
              {p.publish}
            </button>
          )}
          {review.publish.commentUrl && (
            <button type="button" onClick={() => window.open(review.publish.commentUrl, '_blank')} className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline">
              <ExternalLink className="w-3.5 h-3.5" />
              {p.openComment}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-[11px] text-indigo-100/90">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-300" />
        <span>{p.readOnlyNote}</span>
      </div>
      {!hasCli && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {p.ghMissing}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-[#141722] p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">{p.title}</h3>
        <div>
          <div className="mb-1 text-[11px] text-slate-400">
            {p.reviewers} <span className="text-slate-500">— {p.reviewersHint}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roles.length === 0 && <span className="text-[11px] text-slate-500">{p.noRoles}</span>}
            {roles.map((r) => (
              <button
                key={r.slug}
                type="button"
                onClick={() => toggleReviewer(r.slug)}
                className={`px-2 py-0.5 rounded border text-[11px] ${prefs.reviewers.includes(r.slug) ? 'border-indigo-400 bg-indigo-500/25 text-indigo-100' : 'border-slate-700 text-slate-400'}`}
              >
                {r.name} ({r.slug})
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="block text-[11px] text-slate-400">{p.verifier}</span>
            <select className="w-full rounded-md border border-slate-700 bg-[#0b0d13] px-2 py-1.5" value={prefs.verifier} onChange={(e) => update({ verifier: e.target.value })}>
              <option value="">{p.verifierDefault}</option>
              {roles.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name} ({r.slug})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-slate-400">{p.budget}</span>
            <input className="w-full rounded-md border border-slate-700 bg-[#0b0d13] px-2 py-1.5" value={prefs.budget} onChange={(e) => update({ budget: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] text-slate-400">{p.publishMode}</span>
            <select className="w-full rounded-md border border-slate-700 bg-[#0b0d13] px-2 py-1.5" value={prefs.publish} onChange={(e) => update({ publish: e.target.value as 'hitl' | 'manual' })}>
              <option value="hitl">{p.publishHitl}</option>
              <option value="manual">{p.publishManual}</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5" />
            {busy ? p.starting : p.start}
          </button>
          {latestHead && (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void start(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {p.restart}
            </button>
          )}
        </div>
        {notice && <div className={`text-xs whitespace-pre-wrap ${notice.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{notice.text}</div>}
      </div>

      {reviews.length === 0 ? <div className="text-xs text-slate-500">{p.noReviews}</div> : reviews.map(renderReview)}
    </div>
  );
};
