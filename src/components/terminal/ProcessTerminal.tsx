import React from 'react';
import { Terminal, Trash2, X } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';

export const ProcessTerminal: React.FC = () => {
  const { t } = useTranslation();
  const { isTerminalOpen, toggleTerminal, terminalLogs, selectedProject } = useProjectStore();

  if (!isTerminalOpen) return null;

  const clearLogs = () => {
    useProjectStore.setState({ terminalLogs: ['[ProjectHub] Logs cleared.'] });
  };

  return (
    <div className="h-56 border-t border-slate-800 bg-[#0d1017] flex flex-col shrink-0 z-20">
      {/* Terminal Toolbar */}
      <div className="h-9 px-4 bg-[#141724] border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-semibold text-slate-300">
            {t.terminal.processLogs}: {selectedProject?.name || 'System'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={clearLogs}
            title={t.terminal.clearLog}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleTerminal}
            title={t.terminal.close}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Logs Output */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-slate-300 space-y-1 select-text">
        {terminalLogs.map((log, idx) => (
          <div key={idx} className="leading-relaxed whitespace-pre-wrap">
            <span className="text-slate-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
            <span className={log.startsWith('[Error]') ? 'text-red-400' : 'text-slate-300'}>
              {log}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
