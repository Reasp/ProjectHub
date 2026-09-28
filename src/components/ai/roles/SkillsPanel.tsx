import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Sparkles, Download, ArrowRightLeft, TriangleAlert, FileText } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { useDialog } from '../../../hooks/useDialog';
import { collapseUnchanged, lineDiff, lineDiffStats } from '../../../lib/lineDiff';
import { entryCopyActions, importPlan, SKILL_ROOT_ORDER } from './skillsView';
import type {
  ProjectSkillListing,
  SkillCopyRequest,
  SkillCopyResult,
  SkillEntry,
  SkillFileState,
  SkillImportItem,
  SkillRoot,
  SkillSourceInfo,
  SkillSourceListing,
  SkillSourceRef,
  SkillStatus
} from '../../../types/electron';

/**
 * Менеджер скиллов проекта (TASK-105, decision-61): скиллы в .claude/skills и .agents/skills, расхождения копий
 * (файлы и построчный дифф SKILL.md), копирование между каталогами и импорт из шаблона, личных скиллов или другого
 * проекта. Перезапись существующего скилла — только после подтверждения.
 */

const STATUS_STYLE: Record<SkillStatus, string> = {
  synced: 'bg-secondary text-muted-foreground border-border',
  diverged: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  claudeOnly: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  agentsOnly: 'bg-violet-500/15 text-violet-300 border-violet-500/30'
};

const FILE_STYLE: Record<SkillFileState, string> = {
  same: 'text-muted-foreground',
  changed: 'text-amber-300',
  onlyClaude: 'text-sky-300',
  onlyAgents: 'text-violet-300'
};

const ACTION_STYLE: Record<'create' | 'overwrite' | 'unchanged', string> = {
  create: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  overwrite: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  unchanged: 'bg-secondary text-muted-foreground border-border'
};

function sourceKey(s: SkillSourceRef): string {
  return s.kind === 'project' ? `project:${s.path}` : s.kind;
}

interface SkillsPanelProps {
  projectPath: string;
  onDriftChange: (drift: number) => void;
}

export const SkillsPanel: React.FC<SkillsPanelProps> = ({ projectPath, onDriftChange }) => {
  const { t } = useTranslation();
  const s = t.skills;
  const dialog = useDialog();
  const [tab, setTab] = useState<'project' | 'import'>('project');
  const [listing, setListing] = useState<ProjectSkillListing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sources, setSources] = useState<SkillSourceInfo[]>([]);
  const [sourceSel, setSourceSel] = useState<string>('');
  const [sourceListing, setSourceListing] = useState<SkillSourceListing | null>(null);
  const [toRoots, setToRoots] = useState<SkillRoot[]>(['claude', 'agents']);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const applyListing = useCallback(
    (next: ProjectSkillListing) => {
      setListing(next);
      onDriftChange(next.summary.diverged);
    },
    [onDriftChange]
  );

  const refresh = useCallback(async () => {
    try {
      applyListing(await window.api.listProjectSkills(projectPath));
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }, [projectPath, applyListing]);

  useEffect(() => {
    setListing(null);
    setSelectedId(null);
    setMessage(null);
    setSourceListing(null);
    void refresh();
    void window.api.listSkillSources(projectPath).then((list) => {
      setSources(list);
      const first = list.find((x) => x.available);
      setSourceSel(first ? sourceKey(first) : '');
    });
  }, [projectPath, refresh]);

  const selectedSource = useMemo(() => sources.find((x) => sourceKey(x) === sourceSel) ?? null, [sources, sourceSel]);

  const loadSource = useCallback(async () => {
    if (!selectedSource) {
      setSourceListing(null);
      return;
    }
    const ref: SkillSourceRef = selectedSource.kind === 'project' ? { kind: 'project', path: selectedSource.path } : { kind: selectedSource.kind };
    const res = await window.api.listSourceSkills(projectPath, ref);
    if (res.success) setSourceListing(res.listing);
    else {
      setSourceListing(null);
      setMessage({ kind: 'error', text: res.error });
    }
  }, [projectPath, selectedSource]);

  useEffect(() => {
    if (tab === 'import') void loadSource();
  }, [tab, loadSource]);

  const rootLabel = (r: SkillRoot) => `${s.rootPath[r]} (${s.rootShort[r]})`;

  const runCopy = async (request: SkillCopyRequest, overwriteRoots: SkillRoot[]) => {
    if (overwriteRoots.length > 0) {
      const ok = await dialog.confirm({
        title: s.overwriteTitle,
        message: s.overwriteMessage.replace('{id}', request.id).replace('{roots}', overwriteRoots.map((r) => s.rootPath[r]).join(', ')),
        confirmText: s.overwriteOk,
        danger: true
      });
      if (!ok) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await window.api.copySkill(projectPath, { ...request, overwrite: overwriteRoots.length > 0 });
      if (!res.success) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      const result: SkillCopyResult = res.result;
      applyListing(result.listing);
      setMessage({
        kind: result.results.some((r) => r.outcome === 'skipped') ? 'error' : 'ok',
        text: `${request.id}: ${result.results.map((r) => `${s.rootPath[r.root]} — ${s.outcome[r.outcome]}${r.reason ? ` (${r.reason})` : ''}`).join('; ')}`
      });
      if (tab === 'import') await loadSource();
    } finally {
      setBusy(false);
    }
  };

  const copyWithin = (entry: SkillEntry, from: SkillRoot, to: SkillRoot, overwrite: boolean) =>
    runCopy({ source: { kind: 'project', path: projectPath }, fromRoot: from, id: entry.id, toRoots: [to], overwrite }, overwrite ? [to] : []);

  const importItem = (item: SkillImportItem) => {
    if (!selectedSource) return;
    const plan = importPlan(item, toRoots);
    if (plan.roots.length === 0) {
      setMessage({ kind: 'ok', text: s.nothingToDo });
      return;
    }
    const source: SkillSourceRef = selectedSource.kind === 'project' ? { kind: 'project', path: selectedSource.path } : { kind: selectedSource.kind };
    void runCopy({ source, fromRoot: item.from, id: item.id, toRoots: plan.roots, overwrite: false }, plan.overwrite);
  };

  const selected = useMemo(() => listing?.entries.find((e) => e.id === selectedId) ?? null, [listing, selectedId]);

  const renderDetail = (entry: SkillEntry) => {
    const claude = entry.copies.claude;
    const agents = entry.copies.agents;
    const problems = SKILL_ROOT_ORDER.flatMap((r) => (entry.copies[r]?.problems ?? []).map((p) => ({ root: r, p })));
    const ops = claude && agents && claude.skillMd !== null && agents.skillMd !== null ? lineDiff(claude.skillMd, agents.skillMd) : undefined;
    const changedLines = ops ? ops.some((o) => o.op !== 'same') : false;
    const single = claude ?? agents;
    return (
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-3" data-testid="skill-detail">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-xs font-semibold">{entry.id}</div>
            {entry.description && <div className="text-[11px] text-muted-foreground line-clamp-2">{entry.description}</div>}
          </div>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[entry.status]}`}>{s.status[entry.status]}</span>
        </div>

        {problems.length > 0 && (
          <div className="space-y-0.5">
            {problems.map(({ root, p }) => (
              <div key={`${root}-${p}`} className="flex items-center gap-1.5 text-[11px] text-amber-400">
                <TriangleAlert className="w-3 h-3 shrink-0" /> {s.rootShort[root]}: {s.problems[p]}
              </div>
            ))}
          </div>
        )}

        {entry.fileDiff && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{s.filesTitle}</div>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {entry.fileDiff.map((f) => (
                <div key={f.relPath} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-mono truncate" title={f.relPath}>{f.relPath}</span>
                  <span className={`shrink-0 ${FILE_STYLE[f.state]}`}>{s.fileState[f.state]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {claude && agents && entry.status === 'diverged' && (
          <div className="rounded border border-border bg-background/40">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {s.skillMdDiff}</span>
              {ops && changedLines && (
                <span>{s.diffStats.replace('{added}', String(lineDiffStats(ops).added)).replace('{removed}', String(lineDiffStats(ops).removed))}</span>
              )}
            </div>
            {ops === null ? (
              <div className="p-2 text-[11px] text-muted-foreground">{s.diffTooLarge}</div>
            ) : ops && !changedLines ? (
              <div className="p-2 text-[11px] text-muted-foreground">{s.skillMdIdentical}</div>
            ) : ops ? (
              <pre className="text-[11px] font-mono p-2 max-h-72 overflow-auto whitespace-pre-wrap break-words" data-testid="skill-md-diff">
                {collapseUnchanged(ops).map((o, i) =>
                  o.op === 'gap' ? (
                    <div key={i} className="text-muted-foreground/60 italic select-none">
                      {s.diffGap.replace('{count}', String(o.count))}
                    </div>
                  ) : (
                    <div
                      key={i}
                      className={o.op === 'add' ? 'bg-emerald-500/10 text-emerald-300' : o.op === 'del' ? 'bg-rose-500/10 text-rose-300' : 'text-muted-foreground'}
                    >
                      {o.op === 'add' ? '+ ' : o.op === 'del' ? '− ' : '  '}
                      {o.text}
                    </div>
                  )
                )}
              </pre>
            ) : null}
          </div>
        )}

        {single && entry.status !== 'diverged' && single.skillMd !== null && (
          <div className="rounded border border-border bg-background/40">
            <div className="flex items-center gap-1 px-2 py-1 border-b border-border text-[11px] text-muted-foreground">
              <FileText className="w-3 h-3" /> {s.preview}
            </div>
            <pre className="text-[11px] font-mono p-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{single.skillMd}</pre>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {entryCopyActions(entry).map((a) => (
            <button
              key={`${a.from}-${a.to}`}
              type="button"
              disabled={busy}
              data-testid={`skill-copy-${a.from}-${a.to}`}
              onClick={() => void copyWithin(entry, a.from, a.to, a.overwrite)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-secondary border border-border disabled:opacity-50"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              {a.overwrite
                ? s.replaceWith.replace('{to}', s.rootShort[a.to]).replace('{from}', s.rootShort[a.from])
                : s.copyTo.replace('{root}', s.rootPath[a.to])}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderProjectTab = () => {
    if (!listing) return null;
    return (
      <>
        <div className="flex flex-wrap gap-1.5 text-[10px]" data-testid="skills-summary">
          {(['diverged', 'claudeOnly', 'agentsOnly', 'synced'] as SkillStatus[])
            .filter((st) => listing.summary[st] > 0)
            .map((st) => (
              <span key={st} className={`px-1.5 py-0.5 rounded border ${STATUS_STYLE[st]}`}>
                {s.status[st]}: {listing.summary[st]}
              </span>
            ))}
          {listing.summary.withProblems > 0 && (
            <span className="px-1.5 py-0.5 rounded border bg-rose-500/15 text-rose-300 border-rose-500/30">
              {s.withProblems}: {listing.summary.withProblems}
            </span>
          )}
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto rounded-lg border border-border p-1.5">
          {listing.entries.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">{s.empty}</div>
          ) : (
            listing.entries.map((e) => {
              const hasProblems = Object.values(e.copies).some((c) => c && c.problems.length > 0);
              return (
                <div
                  key={e.id}
                  data-skill-row={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs ${
                    selectedId === e.id ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary/40'
                  }`}
                >
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${STATUS_STYLE[e.status]}`}>{s.status[e.status]}</span>
                  <span className="font-mono text-[11px] truncate flex-1" title={e.description ?? e.id}>{e.id}</span>
                  {hasProblems && <TriangleAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                  <span className="shrink-0 flex gap-1 text-[10px]">
                    {SKILL_ROOT_ORDER.map((r) => (
                      <span key={r} className={`px-1 rounded ${e.copies[r] ? 'bg-secondary text-foreground' : 'text-muted-foreground/40 line-through'}`}>
                        {s.rootShort[r]}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })
          )}
        </div>
        {selected ? renderDetail(selected) : listing.entries.length > 0 && <div className="text-[11px] text-muted-foreground">{s.selectHint}</div>}
      </>
    );
  };

  const sourceOptionLabel = (x: SkillSourceInfo) => {
    const kind = x.kind === 'template' ? s.sourceTemplate : x.kind === 'personal' ? s.sourcePersonal : s.sourceProject;
    const suffix = x.available ? '' : ` — ${s.sourceUnavailable}`;
    return x.kind === 'personal' ? `${kind}: ${x.label}${suffix}` : `${kind}: ${x.label} (${x.path})${suffix}`;
  };

  const renderImportTab = () => (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{s.source}</label>
          <select
            value={sourceSel}
            onChange={(e) => setSourceSel(e.target.value)}
            data-testid="skill-source-select"
            className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
          >
            {sources.map((x) => (
              <option key={sourceKey(x)} value={sourceKey(x)} disabled={!x.available}>
                {sourceOptionLabel(x)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{s.targets}</div>
          <div className="flex items-center gap-3 text-xs py-1.5">
            {SKILL_ROOT_ORDER.map((r) => (
              <label key={r} className="flex items-center gap-1.5" title={rootLabel(r)}>
                <input
                  type="checkbox"
                  checked={toRoots.includes(r)}
                  onChange={() => setToRoots(toRoots.includes(r) ? toRoots.filter((x) => x !== r) : [...toRoots, r])}
                />
                {s.rootShort[r]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1 max-h-80 overflow-y-auto rounded-lg border border-border p-1.5" data-testid="skill-import-list">
        {!sourceListing ? null : sourceListing.items.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">{s.sourceEmpty}</div>
        ) : (
          sourceListing.items.map((item) => {
            const plan = importPlan(item, toRoots);
            return (
              <div key={`${item.id}-${item.from}`} data-import-row={item.id} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-xs hover:bg-secondary/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] truncate">{item.id}</span>
                    {item.sourceDiverged && (
                      <span className="text-[10px] text-amber-400" title={s.sourceDiverged}>
                        {s.fromRoot.replace('{root}', s.rootPath[item.from])}
                      </span>
                    )}
                  </div>
                  {item.description && <div className="text-[10px] text-muted-foreground truncate" title={item.description}>{item.description}</div>}
                  {item.blocker && <div className="text-[10px] text-amber-400">{item.blocker}</div>}
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {SKILL_ROOT_ORDER.filter((r) => toRoots.includes(r)).map((r) => (
                    <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded border ${ACTION_STYLE[item.actions[r]]}`} title={s.rootPath[r]}>
                      {s.rootShort[r]}: {s.importAction[item.actions[r]]}
                    </span>
                  ))}
                  <button
                    type="button"
                    disabled={busy || Boolean(item.blocker) || plan.roots.length === 0}
                    onClick={() => importItem(item)}
                    data-testid={`skill-import-${item.id}`}
                    className="ml-1 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-border hover:bg-secondary disabled:opacity-40"
                  >
                    <Download className="w-3 h-3" /> {s.importButton}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <div className="space-y-4" data-testid="skills-panel">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> {s.title}
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">{s.description}</p>
      </div>

      <div className="flex items-center gap-1.5">
        {(['project', 'import'] as const).map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`skills-tab-${k}`}
            onClick={() => {
              setTab(k);
              setMessage(null);
            }}
            className={`px-3 py-1 rounded-md text-xs border ${tab === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/50'}`}
          >
            {k === 'project' ? s.tabProject : s.tabImport}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void (tab === 'project' ? refresh() : Promise.all([refresh(), loadSource()]))}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-secondary border border-border"
        >
          <RefreshCw className="w-3 h-3" /> {s.refresh}
        </button>
      </div>

      {tab === 'project' ? renderProjectTab() : renderImportTab()}

      {message && (
        <div className={`text-xs flex items-start gap-1.5 ${message.kind === 'ok' ? 'text-emerald-400' : 'text-amber-400'}`} data-testid="skills-message">
          {message.kind === 'error' ? <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : null}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
};
