import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  Bot,
  Play,
  Square,
  Trash2,
  Maximize2,
  Minimize2,
  X,
  Cpu,
  RefreshCw,
  Plus,
  Radio,
  FileCode,
  Sparkles
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { PtyTabTerminal } from './PtyTabTerminal';

export const TerminalPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    isTerminalOpen,
    setTerminalOpen,
    terminalLogs,
    processes,
    activeProcessId,
    setActiveProcessId,
    startProcessAction,
    stopProcessAction,
    selectedProject,
    terminalHeight,
    setTerminalHeight,
    clearTerminalLogs,
    ptySessions,
    activePtySessionId,
    terminalMode,
    setActivePtySessionId,
    setTerminalMode,
    createPtySessionAction,
    closePtySessionAction
  } = useProjectStore();

  const processLogContainerRef = useRef<HTMLDivElement>(null);
  const processXtermRef = useRef<XTerm | null>(null);
  const processFitAddonRef = useRef<FitAddon | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Initialize process logs xterm instance
  useEffect(() => {
    if (!processLogContainerRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0a0d14',
        foreground: '#d4d4d8',
        cursor: '#818cf8',
        selectionBackground: '#4f46e540',
        black: '#18181b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f4f4f5'
      },
      fontFamily: 'Consolas, "Fira Code", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: false,
      convertEol: true,
      allowTransparency: true,
      scrollback: 3000
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(processLogContainerRef.current);
    try {
      fitAddon.fit();
    } catch (e) {}

    processXtermRef.current = term;
    processFitAddonRef.current = fitAddon;

    term.writeln('\x1b[38;2;99;102;241m[ProjectHub Logs]\x1b[0m Системный лог и мониторинг фоновых процессов.');
    term.writeln('\x1b[90m------------------------------------------------------------\x1b[0m');

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (e) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      processXtermRef.current = null;
    };
  }, []);

  // Listen to incoming live process log chunks from IPC
  useEffect(() => {
    if (!window.api) return;

    const cleanup = window.api.onProcessLogChunk((data) => {
      if (activeProcessId === data.processId) {
        processXtermRef.current?.write(data.text);
      }
    });

    return () => {
      cleanup();
    };
  }, [activeProcessId]);

  // When active process tab changes or terminal mode changes, reload logs
  useEffect(() => {
    if (!processXtermRef.current || terminalMode !== 'process_logs') return;

    if (activeProcessId === null) {
      processXtermRef.current.clear();
      processXtermRef.current.writeln('\x1b[38;2;99;102;241m[ProjectHub System Logs]\x1b[0m');
      for (const line of terminalLogs) {
        processXtermRef.current.writeln(`\x1b[90m>\x1b[0m ${line}`);
      }
    } else {
      const proc = processes.find((p) => p.id === activeProcessId);
      if (proc && selectedProject && window.api) {
        window.api.tailProcessLog(selectedProject.path, proc.name, 200).then((historical) => {
          if (processXtermRef.current) {
            processXtermRef.current.clear();
            processXtermRef.current.writeln(
              `\x1b[38;2;99;102;241m[Process: ${proc.name}]\x1b[0m PID: ${proc.pid || 'N/A'} • Команда: \x1b[33m${proc.command}\x1b[0m`
            );
            processXtermRef.current.writeln('\x1b[90m------------------------------------------------------------\x1b[0m');
            if (historical) {
              processXtermRef.current.write(historical);
            }
          }
        });
      }
    }

    try {
      processFitAddonRef.current?.fit();
    } catch (e) {}
  }, [activeProcessId, terminalLogs, terminalMode, isTerminalOpen]);

  // Handle panel resize drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startHeight = terminalHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(Math.max(startHeight + delta, 140), window.innerHeight * 0.75);
      setTerminalHeight(newHeight);
      processFitAddonRef.current?.fit();
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setTimeout(() => processFitAddonRef.current?.fit(), 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleLaunchClaude = () => {
    if (!selectedProject) return;
    createPtySessionAction(selectedProject.path, 'claude');
  };

  const handleLaunchShell = () => {
    if (!selectedProject) return;
    createPtySessionAction(selectedProject.path, 'shell');
  };

  if (!isTerminalOpen) return null;

  const heightStyle = isMaximized ? '65vh' : `${terminalHeight}px`;

  return (
    <div
      style={{ height: heightStyle }}
      className="w-full bg-[#0a0d14] border-t border-slate-800 flex flex-col shrink-0 z-30 transition-all duration-75 relative select-none shadow-2xl"
    >
      {/* Resize Handle Bar */}
      <div
        onMouseDown={handleMouseDown}
        className="h-1.5 w-full bg-slate-800/50 hover:bg-indigo-500/70 cursor-row-resize transition-colors flex items-center justify-center"
      >
        <div className="w-8 h-0.5 bg-slate-600 rounded-full" />
      </div>

      {/* Terminal Header Toolbar */}
      <div className="h-9 px-3 bg-[#0e121c] border-b border-slate-800 flex items-center justify-between gap-2 overflow-hidden">
        {/* Terminal Sessions & Mode Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 py-1 scrollbar-none">
          {/* Quick Launch Buttons */}
          {selectedProject && (
            <div className="flex items-center gap-1 mr-1 pr-1.5 border-r border-slate-800/80 shrink-0">
              <button
                onClick={handleLaunchClaude}
                title={t.terminal.newClaude}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-xs font-semibold text-indigo-300 border border-indigo-700/50 shadow-sm transition shrink-0"
              >
                <Bot className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t.terminal.newClaude}</span>
              </button>

              <button
                onClick={handleLaunchShell}
                title={t.terminal.newShell}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700/70 text-xs font-medium text-slate-300 border border-slate-700/60 transition shrink-0"
              >
                <TerminalIcon className="w-3 h-3 text-cyan-400" />
                <span>{t.terminal.newShell}</span>
              </button>
            </div>
          )}

          {/* Interactive PTY Tabs */}
          {ptySessions.map((session) => {
            const isCurrent = terminalMode === 'pty' && activePtySessionId === session.id;
            const isRunning = session.status === 'running';

            return (
              <div
                key={session.id}
                onClick={() => {
                  setTerminalMode('pty');
                  setActivePtySessionId(session.id);
                }}
                title={`${session.title} (${isRunning ? t.terminal.running : t.terminal.exited})`}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition shrink-0 cursor-pointer border whitespace-nowrap ${
                  isCurrent
                    ? 'bg-[#181d2e] border-indigo-500/40 text-white shadow-sm'
                    : 'bg-[#101422] border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {session.type === 'claude' ? (
                  <Bot className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-indigo-400' : 'text-slate-500'}`} />
                ) : (
                  <TerminalIcon className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-cyan-400' : 'text-slate-500'}`} />
                )}

                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500/70'
                  }`}
                />

                <span className="truncate max-w-[130px]">{session.title}</span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closePtySessionAction(session.id);
                  }}
                  title={t.terminal.close}
                  className="p-0.5 rounded hover:bg-rose-950/70 text-slate-500 hover:text-rose-300 transition shrink-0 ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* System & Background Process Logs Tab */}
          <button
            onClick={() => {
              setTerminalMode('process_logs');
              setActiveProcessId(null);
            }}
            title={t.terminal.processLogs}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition shrink-0 whitespace-nowrap border ${
              terminalMode === 'process_logs'
                ? 'bg-[#181d2e] border-indigo-500/40 text-white shadow-sm'
                : 'bg-[#101422] border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Radio className="w-3 h-3 text-amber-400 shrink-0" />
            <span>{t.terminal.processLogs}</span>
          </button>

          {/* Individual Managed Process Sub-Tabs (when in process_logs mode) */}
          {terminalMode === 'process_logs' &&
            processes.map((proc) => {
              const isActive = activeProcessId === proc.id;
              const isRunning = proc.status === 'running';

              return (
                <div
                  key={proc.id}
                  onClick={() => setActiveProcessId(proc.id)}
                  title={`${proc.name} (${proc.status})`}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium transition shrink-0 cursor-pointer border whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-800 border-slate-600 text-white'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                    }`}
                  />
                  <span className="truncate max-w-[100px]">{proc.name}</span>
                  {isRunning && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        stopProcessAction(proc.id);
                      }}
                      title={t.header.stopDev}
                      className="p-0.5 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition"
                    >
                      <Square className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1 shrink-0 text-slate-400">
          {/* Quick Script Launchers for Process Mode */}
          {selectedProject && (
            <div className="flex items-center gap-1 pr-2 border-r border-slate-800">
              <button
                onClick={() => startProcessAction('npm run dev', 'dev')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/50 hover:bg-emerald-900/60 text-[11px] font-medium text-emerald-400 border border-emerald-800/40 transition"
                title={t.header.startDev}
              >
                <Play className="w-2.5 h-2.5" />
                dev
              </button>

              <button
                onClick={() => startProcessAction('npm run build', 'build')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/50 hover:bg-indigo-900/60 text-[11px] font-medium text-indigo-300 border border-indigo-800/40 transition"
                title={t.terminal.buildProject}
              >
                <Cpu className="w-2.5 h-2.5" />
                build
              </button>

              <button
                onClick={() => startProcessAction('npm run index-docs', 'index-docs')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/40 hover:bg-amber-900/50 text-[11px] font-medium text-amber-300 border border-amber-800/40 transition"
                title={t.terminal.indexDocs}
              >
                <RefreshCw className="w-2.5 h-2.5" />
                docs
              </button>
            </div>
          )}

          {/* Clear Button */}
          <button
            onClick={() => {
              if (terminalMode === 'process_logs') {
                processXtermRef.current?.clear();
                if (activeProcessId === null) {
                  clearTerminalLogs();
                }
              }
            }}
            title={t.terminal.clearLog}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Maximize Toggle */}
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setTimeout(() => {
                processFitAddonRef.current?.fit();
              }, 100);
            }}
            title={isMaximized ? t.terminal.restore : t.terminal.maximize}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close Panel */}
          <button
            onClick={() => setTerminalOpen(false)}
            title={t.terminal.close}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="flex-1 bg-[#0a0d14] overflow-hidden relative">
        {/* Render Interactive PTY Tabs */}
        {ptySessions.map((session) => (
          <PtyTabTerminal
            key={session.id}
            session={session}
            isActive={terminalMode === 'pty' && activePtySessionId === session.id}
          />
        ))}

        {/* If in PTY mode but no session exists yet, show welcome placeholder */}
        {terminalMode === 'pty' && ptySessions.length === 0 && (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 p-6 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-center text-indigo-400">
              <Bot className="w-6 h-6" />
            </div>
            <div className="text-sm font-medium text-slate-300">
              {t.terminal.noActiveSessions}
            </div>
            <p className="text-xs text-slate-500 text-center max-w-md">
              {t.terminal.welcomeDesc}
            </p>
            {selectedProject && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleLaunchClaude}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition"
                >
                  <Bot className="w-4 h-4" />
                  {t.terminal.launchClaudeInProject} {selectedProject.name}
                </button>
                <button
                  onClick={handleLaunchShell}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                >
                  <TerminalIcon className="w-4 h-4 text-cyan-400" />
                  {t.terminal.openShell}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Render Process / System Logs View */}
        <div
          style={{ display: terminalMode === 'process_logs' ? 'block' : 'none' }}
          className="w-full h-full p-2 bg-[#0a0d14]"
        >
          <div ref={processLogContainerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
};
