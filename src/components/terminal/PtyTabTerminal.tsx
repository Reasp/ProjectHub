import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PtySession } from '../../types/electron';

interface PtyTabTerminalProps {
  session: PtySession;
  isActive: boolean;
}

export const PtyTabTerminal: React.FC<PtyTabTerminalProps> = ({ session, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0a0d14',
        foreground: '#e2e8f0',
        cursor: '#818cf8',
        cursorAccent: '#0a0d14',
        selectionBackground: '#4f46e550',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f8fafc',
        brightBlack: '#475569',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#eab308',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff'
      },
      fontFamily: 'Consolas, "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      convertEol: true,
      allowTransparency: true,
      scrollback: 5000
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    try {
      fitAddon.fit();
    } catch (e) {}

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Hook up interactive input
    const onDataDisposable = term.onData((data) => {
      if (window.api?.writePty) {
        window.api.writePty(session.id, data);
      }
    });

    // Hook up incoming PTY data stream
    let cleanupPtyData: (() => void) | null = null;
    if (window.api?.onPtyData) {
      cleanupPtyData = window.api.onPtyData(({ sessionId, data }) => {
        if (sessionId === session.id) {
          term.write(data);
        }
      });
    }

    // Window / Panel resize listener
    const handleResize = () => {
      if (!fitAddonRef.current || !xtermRef.current) return;
      try {
        fitAddonRef.current.fit();
        if (window.api?.resizePty) {
          window.api.resizePty(session.id, xtermRef.current.cols, xtermRef.current.rows);
        }
      } catch (e) {}
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      onDataDisposable.dispose();
      if (cleanupPtyData) cleanupPtyData();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [session.id]);

  // When tab becomes active, refit and focus
  useEffect(() => {
    if (isActive && fitAddonRef.current && xtermRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (window.api?.resizePty && xtermRef.current) {
            window.api.resizePty(session.id, xtermRef.current.cols, xtermRef.current.rows);
          }
          xtermRef.current?.focus();
        } catch (e) {}
      }, 50);
    }
  }, [isActive, session.id]);

  return (
    <div
      style={{ display: isActive ? 'block' : 'none' }}
      className="w-full h-full p-2 bg-[#0a0d14] select-text relative"
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
