import React from 'react';
import { Check, X, FileCode, CheckCircle2, XCircle } from 'lucide-react';
import type { AIToolCall } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface DiffReviewCardProps {
  toolCall: AIToolCall;
  messageId: string;
  projectPath: string;
  onAccept: (messageId: string, toolId: string, filePath: string, newContent: string) => void;
  onReject: (messageId: string, toolId: string) => void;
}

export const DiffReviewCard: React.FC<DiffReviewCardProps> = ({
  toolCall,
  messageId,
  onAccept,
  onReject
}) => {
  const { t } = useTranslation();
  const diff = toolCall.diff;
  const status = toolCall.status || 'pending';

  if (!diff) {
    return (
      <div className="my-2 p-3 rounded-xl bg-[#141724] border border-slate-800 text-xs font-mono text-slate-300">
        <div className="flex items-center gap-2 text-indigo-400 font-semibold mb-1">
          <FileCode className="w-4 h-4" />
          <span>{toolCall.name}</span>
        </div>
        <pre className="text-[11px] text-slate-400 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(toolCall.args, null, 2)}
        </pre>
      </div>
    );
  }

  const patchLines = (diff.patch || '').split('\n');

  return (
    <div className="my-3 rounded-xl bg-[#0f121d] border border-slate-700/80 overflow-hidden shadow-xl animate-in fade-in duration-150">
      {/* Diff Header */}
      <div className="px-4 py-2.5 bg-[#151928] border-b border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2 font-mono text-slate-200">
          <FileCode className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-indigo-300">{diff.filePath}</span>
          <span className="text-[10px] text-slate-500">
            ({toolCall.args.explanation || t.aiStudio.diffReview.fileModification})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {status === 'accepted' ? (
            <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded text-[11px] font-medium font-mono">
              <CheckCircle2 className="w-3 h-3" />
              {t.aiStudio.diffReview.applied}
            </span>
          ) : status === 'rejected' ? (
            <span className="flex items-center gap-1 text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded text-[11px] font-medium font-mono">
              <XCircle className="w-3 h-3" />
              {t.aiStudio.diffReview.rejected}
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onReject(messageId, toolCall.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/40 hover:text-rose-300 text-slate-400 border border-slate-700/80 transition text-[11px] font-medium"
              >
                <X className="w-3 h-3" />
                {t.aiStudio.diffReview.reject}
              </button>
              <button
                onClick={() => onAccept(messageId, toolCall.id, diff.filePath, diff.newContent)}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-md shadow-emerald-600/20 transition text-[11px]"
              >
                <Check className="w-3.5 h-3.5" />
                {t.aiStudio.diffReview.acceptChanges}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Diff Code View */}
      <div className="p-3 bg-[#0a0c13] font-mono text-[11px] leading-relaxed max-h-72 overflow-y-auto overflow-x-auto text-slate-300 select-text">
        <pre className="whitespace-pre">
          {patchLines.map((line, idx) => {
            const isAdd = line.startsWith('+') && !line.startsWith('+++');
            const isDel = line.startsWith('-') && !line.startsWith('---');
            const isHeader = line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@');

            return (
              <div
                key={idx}
                className={`${
                  isAdd
                    ? 'bg-emerald-500/15 text-emerald-300 px-1 -mx-1 font-semibold'
                    : isDel
                    ? 'bg-rose-500/15 text-rose-300 px-1 -mx-1 line-through decoration-rose-500/50'
                    : isHeader
                    ? 'text-indigo-400 font-semibold mt-1 select-none'
                    : 'text-slate-400'
                }`}
              >
                {line || ' '}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
};
