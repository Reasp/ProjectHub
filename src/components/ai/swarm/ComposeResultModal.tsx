import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import { useSwarmStore } from '../../../store/useSwarmStore';
import type { SwarmSession } from '../../../types/electron';

/**
 * Сборка результата из файлов нескольких кандидатов (TASK-61 AC #5, decision-12 п.5).
 *
 * Выбранные файлы выкачиваются в основное дерево из веток кандидатов механизмом TASK-55
 * (`git checkout <branch> -- <files>`). Один и тот же файл нельзя взять у двух кандидатов:
 * выбор файла у одного снимает его у остальных.
 *
 * Портал и `z-[9999]` — по правилу 19 infra-dev (decision-17).
 */
interface ComposeResultModalProps {
  session: SwarmSession;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Файлы, изменённые кандидатом (по заголовкам `diff --git` его патча). */
function filesFromPatch(patch: string | undefined): string[] {
  const files: string[] = [];
  for (const line of (patch ?? '').split('\n')) {
    if (!line.startsWith('diff --git')) continue;
    const file = line.split(' ')[2]?.replace(/^a\//, '');
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

export const ComposeResultModal: React.FC<ComposeResultModalProps> = ({ session, onClose, onDone }) => {
  const { t } = useTranslation();
  const j = t.judge;
  const { composeResultAction } = useSwarmStore();

  /** Файл → id кандидата, у которого он берётся. */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      session.agents
        .filter((a) => a.worktreeBranch)
        .map((agent) => ({ agent, files: filesFromPatch(agent.diffSummary?.patch) }))
        .filter((c) => c.files.length > 0),
    [session]
  );

  const selectedCount = Object.keys(picks).length;

  const toggle = (file: string, agentId: string) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (next[file] === agentId) delete next[file];
      else next[file] = agentId;
      return next;
    });
  };

  const handleApply = async () => {
    const byAgent = new Map<string, string[]>();
    for (const [file, agentId] of Object.entries(picks)) {
      byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), file]);
    }
    if (byAgent.size === 0) return;

    setIsApplying(true);
    setError(null);
    try {
      const res = await composeResultAction(
        session.id,
        [...byAgent.entries()].map(([agentId, files]) => ({ agentId, files }))
      );
      if (!res.success) {
        setError(j.composeError.replace('{error}', res.error || ''));
        return;
      }
      const applied = (res.applied ?? []).reduce((acc, a) => acc + a.files.length, 0);
      onDone(j.composeDone.replace('{count}', String(applied)));
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" /> {j.composeTitle}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{j.composeHint}</p>

          {error && (
            <div className="px-3 py-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {candidates.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-xs">{j.composeEmpty}</div>
          ) : (
            candidates.map(({ agent, files }) => (
              <div key={agent.id} className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground truncate">{agent.config.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground truncate" title={agent.worktreeBranch}>
                    {agent.worktreeBranch}
                  </span>
                </div>
                <div className="space-y-1">
                  {files.map((file) => {
                    const owner = picks[file];
                    const takenByOther = Boolean(owner) && owner !== agent.id;
                    return (
                      <label
                        key={file}
                        className={`flex items-center gap-2 text-[11px] font-mono px-2 py-1 rounded cursor-pointer transition-colors ${
                          owner === agent.id
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : takenByOther
                            ? 'text-muted-foreground/50'
                            : 'text-muted-foreground hover:bg-secondary/60'
                        }`}
                        title={takenByOther ? `${file} — ${session.agents.find((a) => a.id === owner)?.config.name}` : file}
                      >
                        <input
                          type="checkbox"
                          checked={owner === agent.id}
                          onChange={() => toggle(file, agent.id)}
                          className="shrink-0"
                        />
                        <span className="truncate">{file}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border shrink-0">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {j.composeSelected.replace('{count}', String(selectedCount))}
          </span>
          <button
            onClick={handleApply}
            disabled={selectedCount === 0 || isApplying}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-all"
          >
            <Layers className="w-3.5 h-3.5" /> {j.composeApply}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
