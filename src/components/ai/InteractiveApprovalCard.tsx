import React, { useState } from 'react';
import { ShieldAlert, Check, X, Terminal, CornerDownLeft } from 'lucide-react';
import type { ApprovalRequest } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface InteractiveApprovalCardProps {
  request: ApprovalRequest;
  onApprove: (customText?: string) => void;
  onReject: (customText?: string) => void;
}

export const InteractiveApprovalCard: React.FC<InteractiveApprovalCardProps> = ({
  request,
  onApprove,
  onReject
}) => {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleApprove = () => {
    setIsSubmitting(true);
    onApprove(comment.trim() || undefined);
  };

  const handleReject = () => {
    setIsSubmitting(true);
    onReject(comment.trim() || undefined);
  };

  return (
    <div className="my-3 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-[#181a28] to-slate-900 border-2 border-amber-500/50 shadow-lg shadow-amber-950/30 text-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
          <ShieldAlert className="w-5 h-5 animate-pulse" />
        </div>

        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <span>⚠️ {t.aiStudio.approval.title}</span>
            </h4>
            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
              Human-in-the-Loop
            </span>
          </div>

          <p className="text-xs text-slate-200 font-medium">
            {request.title}
          </p>

          {request.details && (
            <p className="text-[11px] text-slate-400">
              {request.details}
            </p>
          )}

          {/* Command preview */}
          {request.command && (
            <div className="p-2.5 rounded-lg bg-[#0c0e15] border border-slate-800 flex items-center gap-2 font-mono text-xs text-emerald-400 overflow-x-auto">
              <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="select-all">{request.command}</span>
            </div>
          )}

          {/* Optional comment input */}
          <div className="pt-1">
            <div className="relative">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t.aiStudio.approval.optionalComment}
                className="w-full bg-[#0d0f17] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition pr-8"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isSubmitting) {
                    handleApprove();
                  }
                }}
              />
              <CornerDownLeft className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleApprove}
              className="flex-1 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-emerald-700/20 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
            >
              <Check className="w-4 h-4" />
              <span>{t.aiStudio.approval.allowOnce}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleReject}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-700/60 border border-slate-700 disabled:opacity-50 text-slate-300 font-medium text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
            >
              <X className="w-4 h-4" />
              <span>{t.aiStudio.approval.deny}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
