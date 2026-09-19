import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { ProviderErrorInfo } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { providerErrorView } from '../../lib/providerErrorView';

/** Текст совета, где команды в `…` показаны как код (`ollama pull <модель>`). */
export const AdviceText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(`[^`]+`)/g).map((part, i) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
        <code key={i} className="px-1 py-0.5 rounded bg-black/30 font-mono text-[0.95em]">
          {part.slice(1, -1)}
        </code>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    )}
  </>
);

interface ProviderErrorCardProps {
  /** Текст ошибки из main-процесса — показывается, если снимка нет (Claude CLI, старые сессии). */
  error: string;
  info?: ProviderErrorInfo;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

/**
 * Ошибка ответа модели в AI Studio (TASK-70.6, decision-43): что случилось и что сделать — из словаря
 * по виду ошибки, детали (провайдер, модель, адрес, код) и ответ сервера — под «Подробнее».
 * Чат остаётся рабочим: «Повторить» отправляет то же сообщение с текущими настройками.
 */
export const ProviderErrorCard: React.FC<ProviderErrorCardProps> = ({ error, info, onRetry, retryDisabled }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const view = info ? providerErrorView(info, t.providerErrors) : undefined;
  const hasDetails = Boolean(view && (view.details.length > 0 || view.serverMessage));

  return (
    <div className="mt-2 w-full rounded-xl border border-rose-500/30 bg-rose-950/30 text-rose-100 text-xs overflow-hidden" role="alert">
      <div className="px-3.5 py-2.5 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-semibold text-rose-200">
            {view ? view.title : t.providerErrors.heading}
            {info?.provider && <span className="font-normal text-rose-300/80"> · {info.provider}</span>}
          </div>
          {view?.advice ? (
            <p className="text-rose-100/90 leading-relaxed whitespace-pre-wrap break-words">
              <AdviceText text={view.advice} />
            </p>
          ) : (
            !view && <p className="text-rose-100/90 leading-relaxed whitespace-pre-wrap break-words">{error}</p>
          )}
          {view && <p className="text-[10px] text-rose-300/70">{view.retryHint}</p>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white text-[11px] font-semibold disabled:opacity-40 shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            {t.providerErrors.retry}
          </button>
        )}
      </div>
      {hasDetails && view && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full px-3.5 py-1.5 flex items-center gap-1 border-t border-rose-500/20 text-[11px] text-rose-300/80 hover:text-rose-200 hover:bg-rose-500/5"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t.providerErrors.details}
          </button>
          {open && (
            <div className="px-3.5 pb-3 pt-1 space-y-1 font-mono text-[11px] text-rose-100/80">
              {view.details.map((d) => (
                <div key={d.label} className="flex gap-2 min-w-0">
                  <span className="text-rose-300/60 shrink-0">{d.label}:</span>
                  <span className="break-all">{d.value}</span>
                </div>
              ))}
              {view.serverMessage && (
                <div className="pt-1">
                  <div className="text-rose-300/60">{t.providerErrors.serverResponse}:</div>
                  <div className="whitespace-pre-wrap break-words">{view.serverMessage}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
