import * as pty from 'node-pty';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import { PROJECT_HUB_CLAUDE_DIR } from './aiAgentService.js';
import type { PtySession, CreatePtyOptions } from '../../src/types/electron';

interface ActivePty {
  info: PtySession;
  ptyProcess: pty.IPty;
}

class PtyService {
  private sessions = new Map<string, ActivePty>();

  private broadcastData(sessionId: string, data: string) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('pty:data', { sessionId, data });
      }
    }
  }

  private broadcastExit(sessionId: string, exitCode: number) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('pty:exit', { sessionId, exitCode });
      }
    }
  }

  async createSession(options: CreatePtyOptions): Promise<PtySession> {
    const sessionId = options.sessionId || `pty-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const isWin = process.platform === 'win32';
    const cols = options.cols || 100;
    const rows = options.rows || 30;

    let shell = '';
    let args: string[] = [];

    if (options.type === 'claude') {
      if (isWin) {
        // Use cmd.exe /c claude or powershell for maximum Windows compatibility
        shell = process.env.COMSPEC || 'cmd.exe';
        args = ['/c', 'claude'];
      } else {
        shell = process.env.SHELL || '/bin/bash';
        args = ['-l', '-c', 'claude'];
      }
    } else {
      if (isWin) {
        shell = 'powershell.exe';
        args = ['-NoLogo'];
      } else {
        shell = process.env.SHELL || '/bin/bash';
        args = ['-l'];
      }
    }

    const projectName = options.projectName || path.basename(options.projectPath);
    const title = options.title || (options.type === 'claude' ? `Claude: ${projectName}` : `Terminal: ${projectName}`);

    // Create env copy with UTF-8 encoding support and isolated Claude config
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
    };

    // Fallback — домашний каталог, а не process.cwd(): в упакованном приложении cwd произволен (TASK-43)
    const cwd = existsSync(options.projectPath) ? options.projectPath : os.homedir();

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: env as { [key: string]: string }
    });

    const info: PtySession = {
      id: sessionId,
      projectPath: options.projectPath,
      projectName,
      type: options.type,
      title,
      createdAt: Date.now(),
      status: 'running'
    };

    ptyProcess.onData((data: string) => {
      this.broadcastData(sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const active = this.sessions.get(sessionId);
      if (active) {
        active.info.status = 'exited';
        active.info.exitCode = exitCode;
      }
      this.broadcastExit(sessionId, exitCode);
    });

    this.sessions.set(sessionId, { info, ptyProcess });

    return info;
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status !== 'running') {
      return false;
    }
    try {
      session.ptyProcess.write(data);
      return true;
    } catch (err) {
      console.error(`[PtyService] Error writing to session ${sessionId}:`, err);
      return false;
    }
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status !== 'running') {
      return false;
    }
    try {
      session.ptyProcess.resize(Math.max(10, cols), Math.max(5, rows));
      return true;
    } catch (err) {
      console.error(`[PtyService] Error resizing session ${sessionId}:`, err);
      return false;
    }
  }

  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    try {
      session.ptyProcess.kill();
      this.sessions.delete(sessionId);
      return true;
    } catch (err) {
      console.error(`[PtyService] Error killing session ${sessionId}:`, err);
      this.sessions.delete(sessionId);
      return false;
    }
  }

  listSessions(): PtySession[] {
    return Array.from(this.sessions.values()).map((s) => s.info);
  }

  cleanupAll() {
    for (const [id, session] of this.sessions.entries()) {
      try {
        session.ptyProcess.kill();
      } catch (e) {
        // ignore
      }
    }
    this.sessions.clear();
  }
}

export const ptyService = new PtyService();
