import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Activity,
  GitFork,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Trash2,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronLeft,
  Clock,
  Sparkles
} from 'lucide-react';
import type { SubagentInfo, ProjectAgentStatus } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { useTimeoutState } from '../../hooks/useTimeoutState';

interface LiveActivitySidebarProps {
  isStreaming: boolean;
  activeStatus?: ProjectAgentStatus | null;
  subagents: SubagentInfo[];
  liveOutput?: string;
  onClearOutput?: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export const LiveActivitySidebar: React.FC<LiveActivitySidebarProps> = ({
  isStreaming,
  activeStatus,
  subagents,
  liveOutput = '',
  onClearOutput,
  isOpen,
  onToggleOpen
}) => {
  const { t } = useTranslation();
  // Индикатор «скопировано» гаснет сам; таймер снимается при размонтировании (TASK-50)
  const [copied, showCopied] = useTimeoutState(false, 2000);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const activeSubagents = subagents.filter((s) => s.status === 'running');
  const isAgentActive = isStreaming || activeSubagents.length > 0 || activeStatus?.status === 'running';

  // Timer for elapsed execution time
  useEffect(() => {
    let interval: any = null;
    if (isAgentActive) {
      interval = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAgentActive]);

  // Auto-scroll live console output
  useEffect(() => {
    if (liveOutput) {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveOutput]);

  const handleCopy = () => {
    if (!liveOutput) return;
    navigator.clipboard.writeText(liveOutput);
    showCopied(true);
  };

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) {
    return (
      <div className="shrink-0 border-l border-slate-800 bg-[#0d0f17] flex flex-col items-center py-3 px-1">
        <button
          type="button"
          onClick={onToggleOpen}
          title={t.aiStudio.activity.showSidebar}
          className="p-2 rounded-xl bg-[#141724] border border-slate-700/60 hover:border-amber-500/50 hover:bg-[#181c2e] text-slate-300 transition flex flex-col items-center gap-2 relative group"
        >
          {isAgentActive ? (
            <div className="relative">
              <span className="w-3 h-3 rounded-full bg-amber-400 absolute -top-1 -right-1 animate-ping" />
              <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
          ) : (
            <Terminal className="w-4 h-4 text-slate-400 group-hover:text-indigo-400" />
          )}
          <ChevronLeft className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-200" />
        </button>

        {isAgentActive && (
          <div className="mt-4 [writing-mode:vertical-lr] rotate-180 flex items-center gap-2 font-mono text-[10px] text-amber-400 font-semibold tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>RUNNING ({formatElapsed(elapsedSeconds)})</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="w-80 lg:w-96 shrink-0 border-l border-slate-800/90 bg-[#0b0d14] flex flex-col h-full overflow-hidden select-none animate-in slide-in-from-right-2 duration-200">
      {/* Sidebar Header */}
      <div className="px-4 py-3 bg-[#11131f] border-b border-slate-800/90 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg border ${
            isAgentActive
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
          }`}>
            <Activity className={`w-4 h-4 ${isAgentActive ? 'animate-pulse' : ''}`} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-white font-sans">
              {t.aiStudio.activity.title}
            </h4>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
              {isAgentActive ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  <span className="text-amber-300 font-semibold">{t.common.running}</span>
                  <span>• {formatElapsed(elapsedSeconds)}</span>
                </>
              ) : (
                <span className="text-slate-500">Idle / Ready</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleOpen}
          title={t.aiStudio.activity.hideSidebar}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Main Status Indicator Widget */}
      <div className="p-3 bg-[#131626]/80 border-b border-slate-800/80 shrink-0">
        {isAgentActive ? (
          <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs text-amber-300 font-medium">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                {activeStatus?.lastMessage || t.aiStudio.activity.agentWorking}
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">
                {formatElapsed(elapsedSeconds)}
              </span>
            </div>

            {activeSubagents.length > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-300 font-mono">
                <GitFork className="w-3 h-3 text-indigo-400 animate-pulse" />
                <span>
                  {activeSubagents.length} {t.aiStudio.activity.subagentsActive}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.aiStudio.activity.noActivity}</span>
          </div>
        )}
      </div>

      {/* Subagents Tree Section (if any subagents exist) */}
      {subagents.length > 0 && (
        <div className="p-3 border-b border-slate-800/80 bg-[#0d0f17] shrink-0 max-h-44 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <GitFork className="w-3.5 h-3.5 text-indigo-400" />
              {t.aiStudio.subagents} ({subagents.length})
            </span>
          </div>

          <div className="space-y-1.5">
            {subagents.map((sub) => {
              const isRunning = sub.status === 'running';
              const isDone = sub.status === 'completed';

              return (
                <div
                  key={sub.id}
                  className="p-2 rounded-lg bg-[#141724] border border-slate-800/80 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-semibold text-slate-200 truncate max-w-[180px]">
                      {sub.name}
                    </span>
                    {isRunning ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        {t.aiStudio.steps.running}
                      </span>
                    ) : isDone ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        {t.common.completed}
                      </span>
                    ) : (
                      <span className="text-[10px] text-rose-400">{t.common.failed}</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">{sub.task}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Console Output Terminal Section */}
      <div className="flex-1 flex flex-col min-h-0 bg-[#07080d] overflow-hidden">
        {/* Terminal Subheader */}
        <div className="px-3 py-2 bg-[#0e111a] border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold">{t.aiStudio.activity.liveTerminalOutput}</span>
          </div>

          <div className="flex items-center gap-1">
            {liveOutput && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  title={t.aiStudio.activity.copyOutput}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition text-xs"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
                {onClearOutput && (
                  <button
                    type="button"
                    onClick={onClearOutput}
                    title={t.aiStudio.activity.clearOutput}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-300 transition text-xs"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Live Terminal Content */}
        <div className="flex-1 p-3 font-mono text-[11px] text-emerald-300/90 leading-relaxed overflow-y-auto overflow-x-auto whitespace-pre-wrap select-text bg-[#07080d]">
          {liveOutput ? (
            <>
              {liveOutput}
              <div ref={consoleEndRef} />
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-600 space-y-1.5 select-none">
              <Terminal className="w-6 h-6 text-slate-700" />
              <p className="text-[10px]">{t.aiStudio.steps.noOutput}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
