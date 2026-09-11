import React, { useEffect, useState } from 'react';
import { Layers, ChevronDown, ChevronRight, X, CheckSquare, Square, Loader2 } from 'lucide-react';
import type { AgentContextPreview, ContextPartKey } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface ContextAppliedCardProps {
  projectPath: string;
  taskId: string;
  contextParts?: Partial<Record<ContextPartKey, boolean>>;
  onTogglePart: (key: ContextPartKey, enabled: boolean) => void;
  onClearTask: () => void;
}

const PART_KEYS: ContextPartKey[] = ['task', 'rag', 'gitnexus', 'git'];

export const ContextAppliedCard: React.FC<ContextAppliedCardProps> = ({
  projectPath,
  taskId,
  contextParts,
  onTogglePart,
  onClearTask
}) => {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<AgentContextPreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const partsKey = JSON.stringify(contextParts || {});

  useEffect(() => {
    if (!window.api?.previewAgentContext) return;
    let cancelled = false;
    setIsLoading(true);
    window.api
      .previewAgentContext(projectPath, taskId, contextParts)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        console.error('Failed to preview agent context:', err);
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, taskId, partsKey]);

  const partLabel = (key: ContextPartKey) => t.aiStudio.context[key];
  const isPartEnabled = (key: ContextPartKey) => contextParts?.[key] !== false;
  const includedSet = new Set(preview?.includedKeys || []);
  const truncatedSet = new Set(preview?.truncatedKeys || []);

  return (
    <div className="w-full rounded-xl bg-[#141724] border border-indigo-500/20 overflow-hidden text-xs mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3.5 py-2 flex items-center justify-between text-indigo-300/90 hover:text-indigo-200 hover:bg-indigo-500/5 transition font-mono text-[11px]"
      >
        <span className="flex items-center gap-1.5">
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
          ) : (
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
          )}
          {t.aiStudio.context.title.replace('{id}', taskId)}
          {preview && (
            <span className="text-slate-500">
              ({preview.includedKeys.length}/{PART_KEYS.length})
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClearTask();
            }}
            className="text-slate-500 hover:text-rose-400 transition"
            title={t.aiStudio.context.clear}
          >
            <X className="w-3.5 h-3.5" />
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="px-4 py-3 bg-[#0d0f17] border-t border-slate-800/80 space-y-1.5">
          {PART_KEYS.map((key) => {
            const enabled = isPartEnabled(key);
            const included = includedSet.has(key);
            const truncated = truncatedSet.has(key);
            return (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => onTogglePart(key, !enabled)}
                  className="flex items-center gap-1.5 flex-1 text-left"
                >
                  {enabled ? (
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <span className={enabled ? 'text-slate-300' : 'text-slate-500 line-through'}>
                    {partLabel(key)}
                  </span>
                </button>
                {enabled && !included && !isLoading && (
                  <span className="text-slate-600">—</span>
                )}
                {truncated && (
                  <span className="text-amber-500">{t.aiStudio.context.truncatedSuffix}</span>
                )}
              </div>
            );
          })}
          {!isLoading && preview && preview.includedKeys.length === 0 && (
            <p className="text-slate-500 italic pt-1">{t.aiStudio.context.empty}</p>
          )}
        </div>
      )}
    </div>
  );
};
