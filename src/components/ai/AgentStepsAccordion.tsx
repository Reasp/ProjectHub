import React, { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileCode,
  Terminal,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react';
import type { AIToolCall } from '../../types/electron';
import { DiffReviewCard } from './DiffReviewCard';
import { useTranslation } from '../../i18n/useTranslation';

interface AgentStepsAccordionProps {
  toolCalls: AIToolCall[];
  messageId: string;
  projectPath: string;
  onAcceptDiff: (messageId: string, toolId: string, filePath: string, newContent: string) => void;
  onRejectDiff: (messageId: string, toolId: string) => void;
}

export const AgentStepsAccordion: React.FC<AgentStepsAccordionProps> = ({
  toolCalls,
  messageId,
  projectPath,
  onAcceptDiff,
  onRejectDiff
}) => {
  const { t } = useTranslation();
  // By default, the accordion is COLLAPSED per user requirement
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});

  if (!toolCalls || toolCalls.length === 0) return null;

  const totalCount = toolCalls.length;
  const completedCount = toolCalls.filter((tc) => tc.status === 'accepted' || tc.status === 'done').length;
  const runningCount = toolCalls.filter((tc) => tc.status === 'running' || !tc.status || tc.status === 'pending').length;
  const hasPendingDiff = toolCalls.some((tc) => tc.diff && (!tc.status || tc.status === 'pending'));

  const toggleTool = (toolId: string) => {
    setExpandedToolIds((prev) => ({
      ...prev,
      [toolId]: !prev[toolId]
    }));
  };

  const getToolIcon = (name: string) => {
    if (name === 'run_command' || name === 'bash') {
      return <Terminal className="w-3.5 h-3.5 text-amber-400" />;
    }
    if (name === 'write_file' || name === 'edit_file') {
      return <FileCode className="w-3.5 h-3.5 text-indigo-400" />;
    }
    return <Wrench className="w-3.5 h-3.5 text-cyan-400" />;
  };

  return (
    <div className="my-2 rounded-xl bg-[#111420] border border-slate-800/90 overflow-hidden shadow-sm transition-all duration-200">
      {/* Master Accordion Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/40 transition select-none group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shrink-0">
            <Wrench className="w-3.5 h-3.5" />
          </div>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-xs font-semibold text-slate-200 font-sans">
              {t.aiStudio.steps.title}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700/60">
              {totalCount} {t.aiStudio.steps.actionsCount}
            </span>

            {/* Quick status chips */}
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                {runningCount} {t.aiStudio.steps.running}
              </span>
            )}

            {completedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="w-2.5 h-2.5" />
                {completedCount} {t.aiStudio.steps.completed}
              </span>
            )}

            {hasPendingDiff && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                <AlertCircle className="w-2.5 h-2.5" />
                {t.aiStudio.steps.pendingDiff}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-slate-400 group-hover:text-slate-200 text-xs shrink-0">
          <span className="text-[11px] font-medium hidden sm:inline">
            {isOpen ? t.aiStudio.steps.hideDetails : t.aiStudio.steps.showDetails}
          </span>
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-indigo-400 transition-transform" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-transform" />
          )}
        </div>
      </button>

      {/* Collapsible Steps Content */}
      {isOpen && (
        <div className="p-3 border-t border-slate-800/80 bg-[#0d0f17] space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {toolCalls.map((tool, idx) => {
            const isToolExpanded = expandedToolIds[tool.id] ?? (tool.diff ? true : false);
            const isRunning = tool.status === 'running';
            const isError = tool.status === 'error';
            const isDone = tool.status === 'done' || tool.status === 'accepted';

            return (
              <div
                key={tool.id || idx}
                className="rounded-xl border border-slate-800 bg-[#131624] overflow-hidden transition"
              >
                {/* Single Tool Item Header */}
                <div
                  onClick={() => toggleTool(tool.id)}
                  className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-800/30 transition text-xs font-mono select-none"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-slate-500 text-[10px]">#{idx + 1}</span>
                    {getToolIcon(tool.name)}
                    <span className="font-semibold text-slate-200 truncate">
                      {tool.name}
                    </span>
                    {tool.args?.filePath && (
                      <span className="text-indigo-300 text-[11px] truncate max-w-xs">
                        ({tool.args.filePath})
                      </span>
                    )}
                    {tool.args?.command && (
                      <span className="text-amber-300/80 text-[11px] truncate max-w-xs">
                        `{tool.args.command}`
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isRunning ? (
                      <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t.aiStudio.steps.running}
                      </span>
                    ) : isError ? (
                      <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium">
                        <AlertCircle className="w-3 h-3" />
                        {t.common.failed}
                      </span>
                    ) : isDone ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        {t.common.completed}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">
                        {tool.status || 'pending'}
                      </span>
                    )}

                    <div className="p-0.5 text-slate-500 hover:text-slate-300">
                      {isToolExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-item Details (Args, Diffs, Console output) */}
                {isToolExpanded && (
                  <div className="p-3 bg-[#0a0c14] border-t border-slate-800/80 space-y-2 text-xs">
                    {/* Render DiffReviewCard if diff exists */}
                    {tool.diff ? (
                      <DiffReviewCard
                        toolCall={tool}
                        messageId={messageId}
                        projectPath={projectPath}
                        onAccept={onAcceptDiff}
                        onReject={onRejectDiff}
                      />
                    ) : (
                      <>
                        {/* Tool Arguments View */}
                        {tool.args && Object.keys(tool.args).length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                              {t.aiStudio.steps.viewArgs}:
                            </span>
                            <pre className="p-2 rounded-lg bg-[#121522] border border-slate-800/80 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-40">
                              {JSON.stringify(tool.args, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Tool Execution Result / Live Output */}
                        {tool.result && (
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase font-mono tracking-wider text-emerald-400/90 flex items-center gap-1">
                              <Terminal className="w-3 h-3" />
                              {t.aiStudio.steps.viewResult}:
                            </span>
                            <pre className="p-2.5 rounded-lg bg-[#07090e] border border-slate-800 font-mono text-[11px] text-emerald-300/90 overflow-x-auto whitespace-pre-wrap max-h-56">
                              {typeof tool.result === 'string'
                                ? tool.result
                                : JSON.stringify(tool.result, null, 2)}
                            </pre>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
