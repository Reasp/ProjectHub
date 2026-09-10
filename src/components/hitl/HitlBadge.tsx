import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useHitlStore } from '../../store/useHitlStore';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Бейдж единого HITL-контура в шапке (TASK-57): число запросов всех сессий, ожидающих решения;
 * клик открывает Центр решений.
 */
export const HitlBadge: React.FC = () => {
  const { t } = useTranslation();
  const pendingCount = useHitlStore((s) => s.pending.length);
  const openCenter = useHitlStore((s) => s.openCenter);

  const hasPending = pendingCount > 0;
  return (
    <button
      type="button"
      onClick={() => openCenter(hasPending ? 'queue' : undefined)}
      title={hasPending ? t.hitl.badgePending.replace('{count}', String(pendingCount)) : t.hitl.badgeTooltip}
      className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition shrink-0 ${
        hasPending
          ? 'bg-amber-500/20 border-amber-500/60 text-amber-200 hover:bg-amber-500/30 animate-pulse shadow-sm'
          : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
      }`}
    >
      {hasPending ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
      {hasPending && <span className="font-bold">{pendingCount}</span>}
    </button>
  );
};
