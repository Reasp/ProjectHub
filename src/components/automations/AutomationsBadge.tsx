import React from 'react';
import { Workflow } from 'lucide-react';
import { useAutomationsStore } from '../../store/useAutomationsStore';
import { useTranslation } from '../../i18n/useTranslation';

/**
 * Бейдж Automations в шапке (TASK-74): число активных правил и вход в модалку. Янтарный цвет —
 * есть правило на паузе по дневному лимиту или проектное правило ждёт подтверждения.
 */
export const AutomationsBadge: React.FC = () => {
  const { t } = useTranslation();
  const rules = useAutomationsStore((s) => s.rules);
  const open = useAutomationsStore((s) => s.open);

  const now = Date.now();
  const active = rules.filter((r) => r.active).length;
  const attention = rules.some((r) => (r.state.pausedUntil ?? 0) > now || r.trust === 'changed');

  return (
    <button
      type="button"
      onClick={() => open()}
      title={attention ? t.automations.badgePaused : t.automations.badgeTooltip}
      className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition shrink-0 bg-slate-800/80 hover:bg-slate-700 ${
        attention ? 'border-amber-500/60 text-amber-300' : 'border-slate-700/60 text-slate-400 hover:text-slate-200'
      }`}
    >
      <Workflow className="w-3.5 h-3.5" />
      {active > 0 && <span className="font-bold">{active}</span>}
    </button>
  );
};
