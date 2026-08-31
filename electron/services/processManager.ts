import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import treeKill from 'tree-kill';
import { BrowserWindow } from 'electron';
import type { ManagedProcess } from '../../src/types/electron';

interface ActiveProcessItem {
  info: ManagedProcess;
  child: ChildProcessWithoutNullStreams;
  logBuffer: string[];
}

class HubProcessManager {
  private activeProcesses = new Map<string, ActiveProcessItem>();

  private broadcastLog(processId: string, text: string) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('process:logChunk', { processId, text });
      }
    }
  }

  private broadcastStatus(process: ManagedProcess) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('process:statusChanged', process);
      }
    }
  }

  async startProcess(
    projectPath: string,
    command: string,
    name: string
  ): Promise<ManagedProcess> {
    const id = `${path.normalize(projectPath)}::${name}`;

    // If already running in Hub, return or fail
    if (this.activeProcesses.has(id)) {
      const existing = this.activeProcesses.get(id)!;
      if (existing.info.status === 'running') {
        return existing.info;
      }
    }

    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd: projectPath,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    const info: ManagedProcess = {
      id,
      name,
      command,
      cwd: projectPath,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      status: 'running',
      source: 'hub'
    };

    const item: ActiveProcessItem = {
      info,
      child,
      logBuffer: []
    };

    this.activeProcesses.set(id, item);

    const onData = (data: Buffer) => {
      const text = data.toString();
      item.logBuffer.push(text);
      if (item.logBuffer.length > 2000) {
        item.logBuffer.shift();
      }
      this.broadcastLog(id, text);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      info.status = code === 0 ? 'stopped' : 'failed';
      info.exitCode = code ?? undefined;
      this.broadcastStatus(info);
      this.broadcastLog(id, `\r\n[Process exited with code ${code}]\r\n`);
    });

    child.on('error', (err) => {
      info.status = 'failed';
      this.broadcastStatus(info);
      this.broadcastLog(id, `\r\n[Process error: ${err.message}]\r\n`);
    });

    this.broadcastStatus(info);
    return info;
  }

  async stopProcess(id: string): Promise<boolean> {
    const item = this.activeProcesses.get(id);
    if (!item) {
      // Check if it's an env-tools process from project
      return false;
    }

    if (item.info.pid) {
      return new Promise<boolean>((resolve) => {
        treeKill(item.info.pid!, 'SIGKILL', (err) => {
          if (err) {
            console.error(`Failed to kill process tree for ${id}:`, err);
            resolve(false);
          } else {
            item.info.status = 'stopped';
            this.broadcastStatus(item.info);
            resolve(true);
          }
        });
      });
    }

    return true;
  }

  getLogs(id: string): string[] {
    return this.activeProcesses.get(id)?.logBuffer || [];
  }

  async listProcessesForProject(projectPath: string): Promise<ManagedProcess[]> {
    const normalized = path.normalize(projectPath);
    const result: ManagedProcess[] = [];

    // 1. Hub-spawned processes
    for (const [id, item] of this.activeProcesses.entries()) {
      if (path.normalize(item.info.cwd) === normalized) {
        result.push(item.info);
      }
    }

    // 2. Scan env-tools registry: .env-state/processes.json
    const envStateFile = path.join(normalized, '.env-state', 'processes.json');
    if (existsSync(envStateFile)) {
      try {
        const raw = await fs.readFile(envStateFile, 'utf-8');
        const reg = JSON.parse(raw);
        for (const [name, entry] of Object.entries<any>(reg)) {
          const envId = `${normalized}::${name}`;
          // If already in hub processes, skip
          if (!this.activeProcesses.has(envId)) {
            let isAlive = false;
            if (entry.pid) {
              try {
                process.kill(entry.pid, 0);
                isAlive = true;
              } catch {
                isAlive = false;
              }
            }

            result.push({
              id: envId,
              name,
              command: entry.command || '',
              cwd: entry.cwd || normalized,
              pid: entry.pid,
              startedAt: entry.startedAt || new Date().toISOString(),
              status: isAlive ? 'running' : 'stopped',
              source: 'env-tools'
            });
          }
        }
      } catch (err) {
        console.error(`Failed to read env-tools state for ${projectPath}:`, err);
      }
    }

    return result;
  }

  async tailProjectLog(projectPath: string, processName: string, lines = 100): Promise<string> {
    const id = `${path.normalize(projectPath)}::${processName}`;
    const active = this.activeProcesses.get(id);
    if (active && active.logBuffer.length > 0) {
      return active.logBuffer.slice(-lines).join('');
    }

    const logFile = path.join(projectPath, '.env-state', 'logs', `${processName}.log`);
    if (existsSync(logFile)) {
      try {
        let content = await fs.readFile(logFile, 'utf-8');
        if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
        const allLines = content.split('\n');
        return allLines.slice(-lines).join('\n');
      } catch (e) {
        console.error(`Failed to tail log ${logFile}:`, e);
      }
    }

    return '';
  }

  cleanupAll() {
    for (const [id, item] of this.activeProcesses.entries()) {
      if (item.info.pid && item.info.status === 'running') {
        try {
          treeKill(item.info.pid, 'SIGKILL');
        } catch (e) {
          console.error(`Cleanup kill failed for ${id}:`, e);
        }
      }
    }
  }
}

export const processManager = new HubProcessManager();
