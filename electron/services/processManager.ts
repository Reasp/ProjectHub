import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import treeKill from 'tree-kill';
import { BrowserWindow } from 'electron';
import type { ManagedProcess } from '../../src/types/electron';

/** Суммарный лимит буфера логов одного процесса (аудит 2.1: было 2000 чанков по 64 КБ ≈ 128 МБ). */
export const LOG_BUFFER_MAX_BYTES = 2 * 1024 * 1024;
/** Сколько держать завершённый процесс в памяти, чтобы вкладка Processes успела показать статус и хвост лога. */
export const FINISHED_PROCESS_TTL_MS = 10 * 60 * 1000;
/** Верхняя граница числа завершённых записей в activeProcesses — при превышении удаляются самые старые. */
export const MAX_FINISHED_PROCESSES = 50;

export interface LogBufferState {
  logBuffer: string[];
  logBytes: number;
}

/**
 * Добавляет чанк в буфер логов, удерживая суммарный объём в пределах `maxBytes`.
 * Старые чанки вытесняются целиком; одиночный чанк больше лимита усекается до хвоста.
 * Чистая функция над состоянием — покрыта unit-тестами.
 */
export function appendLogChunk(state: LogBufferState, text: string, maxBytes = LOG_BUFFER_MAX_BYTES): void {
  let chunk = text;
  let size = Buffer.byteLength(chunk);
  if (size > maxBytes) {
    // Хвост по байтам, затем на всякий случай приводим к валидной строке.
    chunk = Buffer.from(chunk).subarray(size - maxBytes).toString();
    size = Buffer.byteLength(chunk);
    state.logBuffer.length = 0;
    state.logBytes = 0;
  }
  state.logBuffer.push(chunk);
  state.logBytes += size;
  while (state.logBytes > maxBytes && state.logBuffer.length > 1) {
    const removed = state.logBuffer.shift()!;
    state.logBytes -= Buffer.byteLength(removed);
  }
}

interface ActiveProcessItem extends LogBufferState {
  info: ManagedProcess;
  child: ChildProcessWithoutNullStreams;
  /** Время завершения (мс), нужно для вытеснения самых старых завершённых записей. */
  finishedAt?: number;
  cleanupTimer?: NodeJS.Timeout;
}

interface RetentionOptions {
  finishedTtlMs: number;
  maxFinished: number;
}

class HubProcessManager {
  private activeProcesses = new Map<string, ActiveProcessItem>();

  private retention: RetentionOptions = {
    finishedTtlMs: FINISHED_PROCESS_TTL_MS,
    maxFinished: MAX_FINISHED_PROCESSES
  };

  /** Настройка удержания завершённых процессов (используется тестами). */
  configureRetention(options: Partial<RetentionOptions>) {
    this.retention = { ...this.retention, ...options };
  }

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

  private clearCleanupTimer(item: ActiveProcessItem) {
    if (item.cleanupTimer) {
      clearTimeout(item.cleanupTimer);
      item.cleanupTimer = undefined;
    }
  }

  /**
   * Процесс завершился: планируем удаление записи через TTL и следим за лимитом
   * завершённых записей. Запись удаляется только если в карте всё ещё этот же объект —
   * перезапуск процесса с тем же id создаёт новую запись, и старый таймер её не тронет.
   */
  private markFinished(id: string, item: ActiveProcessItem) {
    if (item.finishedAt !== undefined) return;
    item.finishedAt = Date.now();
    this.clearCleanupTimer(item);
    const timer = setTimeout(() => {
      if (this.activeProcesses.get(id) === item) {
        this.activeProcesses.delete(id);
      }
    }, this.retention.finishedTtlMs);
    timer.unref?.();
    item.cleanupTimer = timer;
    this.enforceFinishedLimit();
  }

  private enforceFinishedLimit() {
    const finished: Array<[string, ActiveProcessItem]> = [];
    for (const entry of this.activeProcesses.entries()) {
      if (entry[1].finishedAt !== undefined) finished.push(entry);
    }
    const excess = finished.length - this.retention.maxFinished;
    if (excess <= 0) return;
    finished.sort((a, b) => a[1].finishedAt! - b[1].finishedAt!);
    for (const [id, item] of finished.slice(0, excess)) {
      this.clearCleanupTimer(item);
      this.activeProcesses.delete(id);
    }
  }

  async startProcess(
    projectPath: string,
    command: string,
    name: string
  ): Promise<ManagedProcess> {
    const id = `${path.normalize(projectPath)}::${name}`;

    // If already running in Hub, return or fail
    const existing = this.activeProcesses.get(id);
    if (existing) {
      if (existing.info.status === 'running') {
        return existing.info;
      }
      // Перезапуск: старую завершённую запись заменяем, её таймер очистки больше не нужен.
      this.clearCleanupTimer(existing);
      this.activeProcesses.delete(id);
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
      logBuffer: [],
      logBytes: 0
    };

    this.activeProcesses.set(id, item);

    const onData = (data: Buffer) => {
      const text = data.toString();
      appendLogChunk(item, text);
      this.broadcastLog(id, text);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      // stopProcess мог уже выставить 'stopped' — не перезаписываем на 'failed' по коду сигнала.
      if (info.status === 'running') {
        info.status = code === 0 ? 'stopped' : 'failed';
      }
      info.exitCode = code ?? undefined;
      this.broadcastStatus(info);
      this.broadcastLog(id, `\r\n[Process exited with code ${code}]\r\n`);
      this.markFinished(id, item);
    });

    child.on('error', (err) => {
      info.status = 'failed';
      this.broadcastStatus(info);
      this.broadcastLog(id, `\r\n[Process error: ${err.message}]\r\n`);
      this.markFinished(id, item);
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

  /** Число записей в activeProcesses (запущенные + ещё не вытесненные завершённые). */
  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  /** Есть ли в проекте запущенный hub-процесс (для агрегации событий git-вотчера). */
  hasRunningProcess(projectPath: string): boolean {
    const normalized = path.normalize(projectPath);
    const same = (p: string) =>
      process.platform === 'win32'
        ? path.normalize(p).toLowerCase() === normalized.toLowerCase()
        : path.normalize(p) === normalized;
    for (const item of this.activeProcesses.values()) {
      if (item.info.status === 'running' && same(item.info.cwd)) return true;
    }
    return false;
  }

  async listProcessesForProject(projectPath: string): Promise<ManagedProcess[]> {
    const normalized = path.normalize(projectPath);
    const result: ManagedProcess[] = [];

    // 1. Hub-spawned processes
    for (const item of this.activeProcesses.values()) {
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
      this.clearCleanupTimer(item);
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
