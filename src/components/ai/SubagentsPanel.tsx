import React from 'react';
import { GitFork, CheckCircle2, XCircle, Loader2, Bot } from 'lucide-react';
import type { SubagentInfo } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface SubagentsPanelProps {
  subagents: SubagentInfo[];
  onClose?: () => void;
}

export const SubagentsPanel: React.FC<SubagentsPanelProps> = ({ subagents, onClose }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-[#10131d] border border-slate-800 rounded-xl p-4 space-y-3 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2">
          <GitFork className="w-4 h-4 text-indigo-400" />
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            {t.aiStudio.subagents}
          </h4>
          <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-mono font-medium">
            {subagents.length}
          </span>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-slate-800 transition"
          >
            {t.common.close}
          </button>
        )}
      </div>

      {subagents.length === 0 ? (
        <div className="text-center py-6 text-slate-500 text-xs">
          <Bot className="w-8 h-8 text-slate-700 mx-auto mb-2 opacity-50" />
          <p>{t.aiStudio.activity.noActivity}</p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
          {subagents.map((sub) => (
            <div
              key={sub.id}
              className="p-3 rounded-lg bg-[#141724] border border-slate-800/90 space-y-1.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="text-indigo-400 font-mono text-[10px]">[{sub.id.slice(-4)}]</span>
                  <span>{sub.name}</span>
                </span>

                {sub.status === 'running' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t.common.running}</span>
                  </span>
                ) : sub.status === 'completed' ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{t.common.completed}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">
                    <XCircle className="w-3 h-3" />
                    <span>{t.common.failed}</span>
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-300 bg-[#0d0f17] p-2 rounded border border-slate-800/80 font-mono">
                {sub.task}
              </p>

              {sub.progress && (
                <p className="text-[10px] text-slate-400 italic">
                  {t.common.status}: {sub.progress}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
