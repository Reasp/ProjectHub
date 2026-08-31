import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  Play,
  Square,
  Trash2,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  X,
  Activity,
  Cpu,
  RefreshCw,
  SlidersHorizontal,
  FolderGit2
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

export const TerminalPanel: React.FC = () => {
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
    clearTerminalLogs
  } = useProjectStore();

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Initialize xterm instance
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0c0e17',
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
      cursorBlink: true,
      convertEol: true,
      allowTransparency: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalContainerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln('\x1b[38;2;99;102;241m[ProjectHub Terminal]\x1b[0m Интерактивная консоль готова к работе.');
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
      xtermRef.current = null;
    };
  }, []);

  // Listen to incoming live log chunks from IPC
  useEffect(() => {
    if (!window.api) return;

    const cleanup = window.api.onProcessLogChunk((data) => {
      // If the log is for the active process
      if (activeProcessId === data.processId) {
        xtermRef.current?.write(data.text);
      }
    });

    return () => {
      cleanup();
    };
  }, [activeProcessId]);

  // When active process tab changes, reload or fit
  useEffect(() => {
    if (!xtermRef.current) return;

    if (activeProcessId === null) {
      // Show system hub logs
      xtermRef.current.clear();
      xtermRef.current.writeln('\x1b[38;2;99;102;241m[ProjectHub System Logs]\x1b[0m');
      for (const line of terminalLogs) {
        xtermRef.current.writeln(`\x1b[90m>\x1b[0m ${line}`);
      }
    } else {
      // Fetch historical logs from backend
      const proc = processes.find((p) => p.id === activeProcessId);
      if (proc && selectedProject && window.api) {
        window.api.tailProcessLog(selectedProject.path, proc.name, 200).then((historical) => {
          if (xtermRef.current) {
            xtermRef.current.clear();
            xtermRef.current.writeln(
              `\x1b[38;2;99;102;241m[Process: ${proc.name}]\x1b[0m PID: ${proc.pid || 'N/A'} • Команда: \x1b[33m${proc.command}\x1b[0m`
            );
            xtermRef.current.writeln('\x1b[90m------------------------------------------------------------\x1b[0m');
            if (historical) {
              xtermRef.current.write(historical);
            }
          }
        });
      }
    }

    try {
      fitAddonRef.current?.fit();
    } catch (e) {}
  }, [activeProcessId, isTerminalOpen]);

  // Handle panel resize drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startHeight = terminalHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.min(Math.max(startHeight + delta, 120), window.innerHeight * 0.7);
      setTerminalHeight(newHeight);
      fitAddonRef.current?.fit();
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setTimeout(() => fitAddonRef.current?.fit(), 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  if (!isTerminalOpen) return null;

  const heightStyle = isMaximized ? '60vh' : `${terminalHeight}px`;

  const activeProcess = processes.find((p) => p.id === activeProcessId);

  return (
    <div
      style={{ height: heightStyle }}
      className="w-full bg-[#0c0e17] border-t border-slate-800 flex flex-col shrink-0 z-30 transition-all duration-75 relative select-none shadow-2xl"
    >
      {/* Resize Handle Bar */}
      <div
        onMouseDown={handleMouseDown}
        className="h-1.5 w-full bg-slate-800/40 hover:bg-indigo-500/60 cursor-row-resize transition-colors"
      />

      {/* Terminal Header Toolbar */}
      <div className="h-9 px-3 bg-[#111422] border-b border-slate-800/80 flex items-center justify-between gap-2">
        {/* Process Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 py-1 scrollbar-none">
          {/* System Log Tab */}
          <button
            onClick={() => setActiveProcessId(null)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition shrink-0 ${
              activeProcessId === null
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <TerminalIcon className="w-3 h-3 text-indigo-400" />
            <span>Системный лог</span>
          </button>

          {/* Managed Process Tabs */}
          {processes.map((proc) => {
            const isActive = activeProcessId === proc.id;
            const isRunning = proc.status === 'running';

            return (
              <div
                key={proc.id}
                onClick={() => setActiveProcessId(proc.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition shrink-0 cursor-pointer border ${
                  isActive
                    ? 'bg-[#181c2d] border-slate-700 text-white shadow-sm'
                    : 'bg-[#111422] border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                  }`}
                />
                <span className="truncate max-w-[120px]">{proc.name}</span>
                {isRunning && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      stopProcessAction(proc.id);
                    }}
                    title="Остановить процесс"
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
          {/* Quick Script Launchers */}
          {selectedProject && (
            <div className="flex items-center gap-1 pr-2 border-r border-slate-800">
              <button
                onClick={() => startProcessAction('npm run dev', 'dev')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/50 hover:bg-emerald-900/60 text-[11px] font-medium text-emerald-400 border border-emerald-800/40 transition"
                title="Запустить dev-сервер проекта"
              >
                <Play className="w-2.5 h-2.5" />
                dev
              </button>

              <button
                onClick={() => startProcessAction('npm run build', 'build')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/50 hover:bg-indigo-900/60 text-[11px] font-medium text-indigo-300 border border-indigo-800/40 transition"
                title="Собрать проект"
              >
                <Cpu className="w-2.5 h-2.5" />
                build
              </button>

              <button
                onClick={() => startProcessAction('npm run index-docs', 'index-docs')}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/40 hover:bg-amber-900/50 text-[11px] font-medium text-amber-300 border border-amber-800/40 transition"
                title="Индексировать документацию"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                docs
              </button>
            </div>
          )}

          {/* Clear Log */}
          <button
            onClick={() => {
              xtermRef.current?.clear();
              if (activeProcessId === null) {
                clearTerminalLogs();
              }
            }}
            title="Очистить вывод консоли"
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Maximize Toggle */}
          <button
            onClick={() => {
              setIsMaximized(!isMaximized);
              setTimeout(() => fitAddonRef.current?.fit(), 100);
            }}
            title={isMaximized ? 'Восстановить размер' : 'Развернуть'}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close Panel */}
          <button
            onClick={() => setTerminalOpen(false)}
            title="Закрыть панель терминала"
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Xterm Container */}
      <div className="flex-1 p-2 bg-[#0c0e17] overflow-hidden">
        <div ref={terminalContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
