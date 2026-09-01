import React, { useState } from 'react';
import { AlertTriangle, Clock, ChevronDown, ChevronUp, X, Zap, Trash2, Info } from 'lucide-react';
import type { RateLimitWarning, AIProviderConfig } from '../../types/electron';

interface RateLimitWarningBannerProps {
  warning: RateLimitWarning;
  config: AIProviderConfig;
  onSelectModel: (modelId: string) => void;
  onClearSession: () => void;
  onDismiss: () => void;
}

export const RateLimitWarningBanner: React.FC<RateLimitWarningBannerProps> = ({
  warning,
  config,
  onSelectModel,
  onClearSession,
  onDismiss
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const utilization = warning.utilization ?? 85;
  const isCritical = utilization >= 95 || warning.type === 'throttled';

  const getProgressColor = (val: number) => {
    if (val >= 95) return 'bg-rose-500 shadow-rose-500/50';
    if (val >= 85) return 'bg-amber-500 shadow-amber-500/50';
    return 'bg-yellow-400 shadow-yellow-400/50';
  };

  return (
    <div
      className={`mx-3 my-2 rounded-xl border transition-all duration-200 shadow-lg overflow-hidden ${
        isCritical
          ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
      }`}
    >
      {/* Top Banner Bar */}
      <div className="flex items-center justify-between p-2.5 px-3">
        <div
          className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div
            className={`p-1.5 rounded-lg shrink-0 ${
              isCritical ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            <AlertTriangle className="w-4 h-4 animate-bounce" />
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-semibold text-xs text-white tracking-wide">
              {warning.title || 'Предупреждение о лимитах запросов'}
            </span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                isCritical
                  ? 'bg-rose-500/30 text-rose-300 border-rose-500/40'
                  : 'bg-amber-500/30 text-amber-300 border-amber-500/40'
              }`}
            >
              Использовано {utilization}%
            </span>

            {warning.resetsAt && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] text-slate-300 bg-black/30 px-2 py-0.5 rounded-md border border-slate-700/50">
                <Clock className="w-3 h-3 text-slate-400" />
                Сброс: {warning.resetsAt}
              </span>
            )}
          </div>
        </div>

        {/* Expand / Close Controls */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/20 hover:bg-black/40 text-slate-300 hover:text-white text-[11px] font-medium transition"
          >
            <span>{isExpanded ? 'Свернуть' : 'Подробнее'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
            title="Закрыть уведомление"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded Details Body */}
      {isExpanded && (
        <div className="p-3 pt-1 border-t border-white/10 bg-black/20 space-y-3 animate-in fade-in duration-150">
          {/* Progress Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-mono text-slate-300">
              <span>Загрузка квоты Claude Code</span>
              <span className="font-bold">{utilization}% / 100%</span>
            </div>
            <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 shadow-sm ${getProgressColor(
                  utilization
                )}`}
                style={{ width: `${Math.min(100, Math.max(5, utilization))}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed font-sans">
            {warning.message ||
              'Вы приближаетесь к максимальному часовому лимиту вызовов модели по текущей подписке. Чтобы избежать прерывания работы, вы можете временно переключиться на быструю модель Haiku или очистить историю текущей сессии.'}
          </p>

          {/* Quick Recommendations & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onSelectModel('haiku')}
              disabled={config.model === 'haiku'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 text-xs font-medium transition disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Переключить на Haiku 4.5 (быстрая квота)</span>
            </button>

            <button
              type="button"
              onClick={onClearSession}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Очистить контекст диалога (/clear)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
