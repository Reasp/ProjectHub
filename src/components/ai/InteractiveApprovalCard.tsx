import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Check,
  X,
  Terminal,
  FileCode,
  HelpCircle,
  CheckSquare,
  Square,
  CircleDot,
  Circle,
  CornerDownLeft,
  Sparkles
} from 'lucide-react';
import type { ApprovalRequest, QuestionOption } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { VoiceBadge } from '../voice/VoiceBadge';

interface InteractiveApprovalCardProps {
  request: ApprovalRequest;
  queueInfo?: { current: number; total: number };
  onApprove: (customText?: string) => void;
  onReject: (customText?: string) => void;
}

export const InteractiveApprovalCard: React.FC<InteractiveApprovalCardProps> = ({
  request,
  queueInfo,
  onApprove,
  onReject
}) => {
  const { t, language } = useTranslation();
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Question mode state
  const isQuestion = request.type === 'question' && request.questionData;
  const qData = request.questionData;
  const isMulti = Boolean(qData?.isMultiSelect);

  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');

  // Handle option toggle
  const toggleOption = (optId: string) => {
    if (isMulti) {
      setSelectedOptionIds((prev) =>
        prev.includes(optId) ? prev.filter((id) => id !== optId) : [...prev, optId]
      );
    } else {
      setSelectedOptionIds([optId]);
      setIsOtherSelected(false);
    }
  };

  const toggleOther = () => {
    if (isMulti) {
      setIsOtherSelected((prev) => !prev);
    } else {
      setIsOtherSelected(true);
      setSelectedOptionIds([]);
    }
  };

  // Keyboard shortcut support (Escape to reject/cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        handleReject();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting]);

  const handleApprove = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    if (isQuestion && qData) {
      // Collect selected option texts
      const chosenLabels: string[] = [];
      for (const opt of qData.options) {
        if (selectedOptionIds.includes(opt.id)) {
          chosenLabels.push(opt.label);
        }
      }
      if (isOtherSelected && otherText.trim()) {
        chosenLabels.push(`Other: ${otherText.trim()}`);
      }

      const answerText = chosenLabels.length > 0
        ? chosenLabels.join(', ')
        : (comment.trim() || 'Approved');

      onApprove(answerText);
    } else {
      onApprove(comment.trim() || undefined);
    }
  };

  const handleReject = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onReject(comment.trim() || undefined);
  };

  // Count of selected items for question
  const totalSelectedCount = selectedOptionIds.length + (isOtherSelected && otherText.trim() ? 1 : 0);
  const canSubmitQuestion = isQuestion
    ? totalSelectedCount > 0 || (isOtherSelected && otherText.trim().length > 0)
    : true;

  // ----------------------------------------------------
  // 1. QUESTION MODE (Pixel-perfect VS Code Style Dialog)
  // ----------------------------------------------------
  if (isQuestion && qData) {
    return (
      <div className="my-3.5 max-w-2xl rounded-2xl bg-[#151722] border border-slate-700/80 shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 select-none font-sans text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#1a1d2c] border-b border-slate-700/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0">
              <HelpCircle className="w-4 h-4" />
            </div>
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wide">
              {qData.title || t.aiStudio.approval.questionTitle}
            </h3>
            {queueInfo && queueInfo.total > 1 && (
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
                {queueInfo.current} / {queueInfo.total}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleReject}
            title={t.common.cancel}
            className="p-1 rounded-lg hover:bg-slate-700/70 text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Subtitle / Question Prompt */}
          {qData.subtitle && (
            <p className="text-xs font-semibold text-slate-100 leading-relaxed">
              {qData.subtitle}
            </p>
          )}

          {/* Options List */}
          <div className="space-y-2">
            {qData.options.map((opt: QuestionOption, optIdx: number) => {
              const isSelected = selectedOptionIds.includes(opt.id);

              return (
                <div
                  key={opt.id}
                  onClick={() => toggleOption(opt.id)}
                  className={`group px-3.5 py-2.5 rounded-xl border transition cursor-pointer flex items-start gap-3 ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500/70 text-white shadow-sm ring-1 ring-indigo-500/40'
                      : 'bg-[#10121c]/80 border-slate-800 hover:border-slate-600 hover:bg-[#131624] text-slate-300'
                  }`}
                >
                  {/* Radio or Checkbox icon */}
                  <div className="mt-0.5 shrink-0 text-slate-400 group-hover:text-slate-200">
                    {isMulti ? (
                      isSelected ? (
                        <CheckSquare className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )
                    ) : (
                      isSelected ? (
                        <CircleDot className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-500" />
                      )
                    )}
                  </div>

                  {/* Option Label and Description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                        {opt.label}
                      </div>
                      <VoiceBadge
                        command={language === 'ru' ? `вариант ${optIdx + 1}` : `option ${optIdx + 1}`}
                        variant={isSelected ? 'emerald' : 'indigo'}
                      />
                    </div>
                    {opt.description && (
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        {opt.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* "Other" Option (if enabled) */}
            {qData.allowOther !== false && (
              <div
                className={`rounded-xl border transition ${
                  isOtherSelected
                    ? 'bg-indigo-600/15 border-indigo-500/70 shadow-sm ring-1 ring-indigo-500/40'
                    : 'bg-[#10121c]/80 border-slate-800 hover:border-slate-600'
                }`}
              >
                <div
                  onClick={toggleOther}
                  className="px-3.5 py-2.5 flex items-center gap-3 cursor-pointer select-none"
                >
                  <div className="shrink-0">
                    {isMulti ? (
                      isOtherSelected ? (
                        <CheckSquare className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )
                    ) : (
                      isOtherSelected ? (
                        <CircleDot className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-500" />
                      )
                    )}
                  </div>
                  <span className={`text-xs font-semibold ${isOtherSelected ? 'text-white' : 'text-slate-300'}`}>
                    {t.aiStudio.approval.otherOption}
                  </span>
                </div>

                {/* Expanded Text input for Other */}
                {isOtherSelected && (
                  <div className="px-3.5 pb-3 pt-1 animate-in fade-in duration-150">
                    <input
                      type="text"
                      autoFocus
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      placeholder={t.aiStudio.approval.otherPlaceholder}
                      className="w-full bg-[#0a0c13] border border-indigo-500/60 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400 transition"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSubmitQuestion) {
                          handleApprove();
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-2 flex items-center justify-between gap-3 flex-wrap border-t border-slate-800/80">
            <span className="text-[11px] text-slate-500 font-mono">
              {t.aiStudio.approval.escToCancel}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleReject}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 border border-slate-700 text-slate-300 text-xs font-medium transition"
              >
                {t.common.cancel}
              </button>

              <button
                type="button"
                disabled={isSubmitting || !canSubmitQuestion}
                onClick={handleApprove}
                className="px-5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition active:scale-[0.98]"
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {totalSelectedCount > 0
                    ? `${totalSelectedCount} ${t.aiStudio.approval.submitAnswers}`
                    : t.aiStudio.approval.submitAnswers}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 2. COMMAND & FILE WRITE APPROVAL MODE
  // ----------------------------------------------------
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
            <div className="flex items-center gap-1.5">
              {queueInfo && queueInfo.total > 1 && (
                <span className="text-[10px] bg-amber-500/30 text-amber-200 border border-amber-500/40 px-2 py-0.5 rounded-full font-mono font-bold">
                  {queueInfo.current} / {queueInfo.total}
                </span>
              )}
              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                Human-in-the-Loop
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-200 font-medium">
            {request.title}
          </p>

          {request.details && (
            <p className="text-[11px] text-slate-400">
              {request.details}
            </p>
          )}

          {/* File path preview */}
          {request.filePath && (
            <div className="p-2.5 rounded-lg bg-[#0c0e15] border border-slate-800 flex items-center gap-2 font-mono text-xs text-indigo-300">
              <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="select-all">{request.filePath}</span>
            </div>
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
              title="Голосовая команда: «Одобрить» / «Принять»"
            >
              <Check className="w-4 h-4" />
              <span>{t.aiStudio.approval.allowOnce}</span>
              <VoiceBadge command={t.voice.voiceBadges.approve} variant="emerald" />
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleReject}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-700/60 border border-slate-700 disabled:opacity-50 text-slate-300 font-medium text-xs flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
              title="Голосовая команда: «Отклонить» / «Отмена»"
            >
              <X className="w-4 h-4" />
              <span>{t.aiStudio.approval.deny}</span>
              <VoiceBadge command={t.voice.voiceBadges.reject} variant="amber" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
