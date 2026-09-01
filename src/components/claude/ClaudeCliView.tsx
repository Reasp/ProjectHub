import React, { useEffect } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PtyTabTerminal } from '../terminal/PtyTabTerminal';
import { useTranslation } from '../../i18n/useTranslation';

export const ClaudeCliView: React.FC = () => {
  const { t } = useTranslation();
  const {
    selectedProject,
    ptySessions,
    activePtySessionId,
    createPtySessionAction,
    closePtySessionAction
  } = useProjectStore();

  const projectPath = selectedProject?.path || '';

  // Find or create Claude Code PTY session for current project
  const claudeSessions = ptySessions.filter(
    (s) => s.projectPath === projectPath && s.type === 'claude'
  );
  const activeSession =
    claudeSessions.find((s) => s.id === activePtySessionId) ||
    claudeSessions[claudeSessions.length - 1];

  useEffect(() => {
    if (projectPath && claudeSessions.length === 0) {
      createPtySessionAction(projectPath, 'claude');
    }
  }, [projectPath, claudeSessions.length, createPtySessionAction]);

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
        <Bot className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300 mb-1">{t.header.noProjectSelected}</h3>
        <p className="text-xs text-slate-500 max-w-sm">{t.header.selectProjectHint}</p>
      </div>
    );
  }

  const handleRestartSession = async () => {
    if (activeSession) {
      await closePtySessionAction(activeSession.id);
    }
    await createPtySessionAction(projectPath, 'claude');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0a0d14] overflow-hidden">
      {/* Claude CLI Sub-header */}
      <div className="px-6 py-2.5 bg-[#121522] border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <span className="font-bold text-xs">✳</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-white">{t.claudeCli.title}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                activeSession?.status === 'running'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}>
                {activeSession?.status === 'running' ? t.claudeCli.running : t.claudeCli.exited}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate max-w-md">
              {t.claudeCli.cwd}: {selectedProject.path}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRestartSession}
            title={t.claudeCli.restartTitle}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[11px] font-medium transition"
          >
            <RefreshCw className="w-3 h-3 text-indigo-400" />
            <span>{t.claudeCli.restart}</span>
          </button>
        </div>
      </div>

      {/* Terminal View Container */}
      <div className="flex-1 p-3 bg-[#0a0d14] overflow-hidden flex flex-col">
        {activeSession ? (
          <div className="flex-1 rounded-xl overflow-hidden border border-slate-800/80 bg-[#0a0d14] p-2">
            <PtyTabTerminal key={activeSession.id} session={activeSession} isActive={true} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500">
            <Bot className="w-10 h-10 text-slate-700 mb-2 animate-bounce" />
            <p className="text-xs text-slate-400">{t.claudeCli.initializing}</p>
          </div>
        )}
      </div>
    </div>
  );
};
