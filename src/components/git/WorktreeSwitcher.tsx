import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderGit2, GitBranch, Home } from 'lucide-react';
import { useProjectStore, samePath } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Переключатель активного рабочего дерева проекта (TASK-62, decision-15).
 *
 * Контекст приложения — пара «проект + рабочее дерево»: выбранное здесь дерево становится
 * рабочим каталогом Git Inspector, File Explorer, терминалов, Action Runner и агентов.
 * Backlog при этом остаётся общим для всего проекта.
 *
 * Выпадающий список рендерится через `createPortal` в `document.body` (правило 19):
 * у шапки `backdrop-blur`, который создаёт stacking context и запер бы `fixed`-панель
 * под остальным интерфейсом.
 */
export const WorktreeSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const { selectedProject, worktrees, workspaceRoot, activeWorktreePath, setActiveWorktree } = useProjectStore();
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const close = () => setIsOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  // Дерево могли удалить снаружи, пока список открыт.
  useEffect(() => {
    if (isOpen && worktrees.length === 0) setIsOpen(false);
  }, [isOpen, worktrees.length]);

  if (!selectedProject || !selectedProject.hasGit) return null;

  const extraWorktrees = worktrees.filter((w) => !w.isMain);
  const activeWorktree = activeWorktreePath
    ? worktrees.find((w) => samePath(w.path, activeWorktreePath))
    : undefined;
  const activeLabel = activeWorktree?.branch || activeWorktree?.path.split(/[\\/]/).pop() || t.worktrees.mainTreeOption;

  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
    setIsOpen((v) => !v);
  };

  const select = async (path: string | null) => {
    setIsOpen(false);
    await setActiveWorktree(path);
  };

  const rowClass = (isActive: boolean) =>
    `w-full text-left px-3 py-2 rounded-lg border transition flex items-center gap-2 ${
      isActive
        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
        : 'bg-[#12151f] border-slate-800 text-slate-300 hover:bg-slate-800/70 hover:text-white'
    }`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title={t.worktrees.switcherTitle}
        className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border font-mono whitespace-nowrap transition shrink-0 ${
          activeWorktreePath
            ? 'text-cyan-300 bg-cyan-950/40 border-cyan-600/50 hover:bg-cyan-900/50 shadow-sm'
            : 'text-slate-300 bg-[#181c2b] border-slate-800 hover:text-white hover:bg-slate-800'
        }`}
      >
        {activeWorktreePath ? <FolderGit2 className="w-3 h-3 text-cyan-400 shrink-0" /> : <Home className="w-3 h-3 text-slate-400 shrink-0" />}
        <span className="max-w-[160px] truncate">{activeLabel}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-70" />
      </button>

      {isOpen && anchor &&
        createPortal(
          <div className="fixed inset-0 z-[10000]" onClick={() => setIsOpen(false)}>
            <div
              className="absolute w-[360px] max-w-[92vw] rounded-xl border border-slate-700 bg-[#161a26] shadow-2xl p-3 space-y-2"
              style={{ top: anchor.top, left: Math.min(anchor.left, Math.max(8, window.innerWidth - 372)) }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-1">
                <p className="text-xs font-semibold text-white">{t.worktrees.switcherTitle}</p>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{t.worktrees.switcherHint}</p>
              </div>

              <div className="max-h-[50vh] overflow-y-auto space-y-1.5">
                <button type="button" className={rowClass(!activeWorktreePath)} onClick={() => void select(null)}>
                  <Home className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold truncate">{t.worktrees.mainTreeOption}</span>
                    <span className="block text-[10px] font-mono text-slate-500 truncate">{selectedProject.path}</span>
                  </span>
                  {!activeWorktreePath && <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
                </button>

                {extraWorktrees.map((wt) => {
                  const isActive = samePath(wt.path, workspaceRoot);
                  return (
                    <button
                      key={wt.path}
                      type="button"
                      className={rowClass(isActive)}
                      title={t.worktrees.switchTo.replace('{branch}', wt.branch || wt.path)}
                      onClick={() => void select(wt.path)}
                    >
                      <GitBranch className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-semibold truncate">{wt.branch || wt.head.slice(0, 7)}</span>
                        <span className="block text-[10px] font-mono text-slate-500 truncate">{wt.path}</span>
                      </span>
                      {wt.taskId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0">
                          {wt.taskId}
                        </span>
                      )}
                      {isActive && <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0" />}
                    </button>
                  );
                })}

                {extraWorktrees.length === 0 && (
                  <p className="text-[11px] text-slate-500 px-1 py-2">{t.worktrees.noWorktrees}</p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
