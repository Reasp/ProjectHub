import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import treeKill from 'tree-kill';
import { BrowserWindow, shell } from 'electron';
import type { ManagedProcess } from '../../src/types/electron';
import { appEventBus } from './eventBus.js';
import {
  findFreePort,
  findPortOwners,
  hasPortPlaceholder,
  isPortFree,
  isValidPort,
  substitutePort,
  DEFAULT_PORT_SEARCH_START,
  PORT_SEARCH_RANGE
} from './portAllocator';

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

/** Параметры запуска из `ActionDefinition` (.projecthub.json): переменные окружения и рабочий каталог. */
export interface StartProcessOptions {
  env?: Record<string, string>;
  /** Рабочий каталог: абсолютный либо относительно workspaceRoot (по умолчанию — корня проекта). */
  cwd?: string;
  /**
   * Активное рабочее дерево (основное дерево проекта или worktree), TASK-62.
   * Входит в идентификатор процесса и служит базой для `cwd`, поэтому dev-серверы
   * двух worktree одного проекта не конфликтуют по имени.
   */
  workspaceRoot?: string;
  /**
   * Стратегия порта: `fixed` (по умолчанию) — как задано в команде; `auto` — ProjectHub
   * подбирает свободный порт, кладёт его в `PORT` и подставляет вместо `${port}`
   * в команде и `autoOpenUrl`.
   */
  portStrategy?: 'fixed' | 'auto';
  /** Порт, с которого начинать поиск при `portStrategy: 'auto'`. */
  port?: number;
  /** URL, который нужно открыть в браузере после старта (dev-сервер). */
  autoOpenUrl?: string;
  /**
   * Задержка автооткрытия (мс): URL открывается, как только в логе появится строка с URL,
   * либо по истечении задержки — что случится раньше. `0` — только по строке с URL.
   * Не задано — `DEFAULT_AUTO_OPEN_DELAY_MS`.
   */
  autoOpenDelayMs?: number;
}

/** Задержка автооткрытия URL по умолчанию, если сервер так и не напечатал адрес в лог. */
export const DEFAULT_AUTO_OPEN_DELAY_MS = 10_000;
/** Сколько ждать фактического завершения процесса после tree-kill, прежде чем считать его остановленным. */
export const STOP_WAIT_MS = 5_000;

const URL_IN_LOG_RE = /https?:\/\/[^\s'"<>)\]]+/i;

/** Есть ли в тексте чанка лога http(s)-URL — сигнал, что dev-сервер поднялся. */
export function containsUrl(text: string): boolean {
  return URL_IN_LOG_RE.test(text);
}

/** Автооткрытие разрешено только для http/https — как и `shell:openExternal` в main. */
export function isAutoOpenUrlAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Идентификатор процесса `${workspaceRoot}::${name}` (TASK-62).
 * В основном дереве это прежний `${projectPath}::${name}`, в worktree — путь worktree,
 * поэтому одинаково названные dev-серверы разных рабочих деревьев не схлопываются в один id.
 */
export function buildProcessId(workspaceRoot: string, name: string): string {
  return `${path.normalize(workspaceRoot)}::${name}`;
}

/**
 * Разбор id процесса `${workspaceRoot}::${name}` (в пути на Windows есть `:`, поэтому
 * режем по последнему `::`). Поле `projectPath` — рабочее дерево процесса: для основного
 * дерева оно совпадает с корнем проекта.
 */
export function parseProcessId(id: string): { projectPath: string; name: string } | null {
  const idx = id.lastIndexOf('::');
  if (idx <= 0 || idx === id.length - 2) return null;
  return { projectPath: id.slice(0, idx), name: id.slice(idx + 2) };
}

/** Запись реестра env-tools (`.env-state/processes.json`). */
interface EnvToolsRegistryEntry {
  pid?: number;
  command?: string;
  cwd?: string;
  startedAt?: string;
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function envStateRegistryPath(projectPath: string): string {
  return path.join(path.normalize(projectPath), '.env-state', 'processes.json');
}

async function readEnvToolsRegistry(projectPath: string): Promise<Record<string, EnvToolsRegistryEntry>> {
  const file = envStateRegistryPath(projectPath);
  if (!existsSync(file)) return {};
  const raw = await fs.readFile(file, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function treeKillAsync(pid: number, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, (err) => (err ? reject(err) : resolve()));
  });
}

export interface ShellSpawnSpec {
  file: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

/**
 * Как выполнять командную строку действия в оболочке (аудит 5.5).
 * На Windows — `cmd.exe /d /s /c "command"`: в отличие от Windows PowerShell 5.1
 * cmd.exe понимает `&&`/`||`, а `npm` там резолвится в `npm.cmd` без обёрток.
 * Строка команды передаётся как есть (`windowsVerbatimArguments`), чтобы Node не
 * переэкранировал кавычки внутри неё — ровно так поступает и `spawn(..., { shell: true })`.
 * На остальных платформах — `/bin/sh -c`.
 */
export function resolveShellSpawn(
  command: string,
  platform: NodeJS.Platform = process.platform,
  comspec: string | undefined = process.env.COMSPEC
): ShellSpawnSpec {
  if (platform === 'win32') {
    return {
      file: comspec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command}"`],
      windowsVerbatimArguments: true
    };
  }
  return { file: '/bin/sh', args: ['-c', command], windowsVerbatimArguments: false };
}

/**
 * Рабочий каталог процесса: `cwd` из ActionDefinition относительно корня проекта.
 * Пустое значение — сам корень проекта.
 */
export function resolveWorkingDir(projectPath: string, cwd?: string): string {
  const trimmed = cwd?.trim();
  return trimmed ? path.resolve(projectPath, trimmed) : path.normalize(projectPath);
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
  /** Параметры запуска с уже подставленным портом — по ним работает автооткрытие URL. */
  options: StartProcessOptions;
  /**
   * Исходные команда и параметры (с плейсхолдерами `${port}`) — по ним идёт перезапуск,
   * чтобы при `portStrategy: 'auto'` заново подобрать свободный порт.
   */
  restartSpec: { command: string; options: StartProcessOptions };
  /** Резолвится, когда дочерний процесс фактически закрылся (close/error). */
  exited: Promise<void>;
  /** Время завершения (мс), нужно для вытеснения самых старых завершённых записей. */
  finishedAt?: number;
  cleanupTimer?: NodeJS.Timeout;
  /** Таймер отложенного автооткрытия URL. */
  autoOpenTimer?: NodeJS.Timeout;
  autoOpened?: boolean;
}

/** Владелец порта: pid слушателя и, если это процесс Hub, его id/имя/рабочее дерево. */
export interface PortOwner {
  pid: number;
  processId?: string;
  name?: string;
  workspaceRoot?: string;
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

  /** Открытие URL в системном браузере; подменяется в тестах. */
  private openUrl: (url: string) => Promise<void> = (url) => shell.openExternal(url);

  /** Настройка удержания завершённых процессов (используется тестами). */
  configureRetention(options: Partial<RetentionOptions>) {
    this.retention = { ...this.retention, ...options };
  }

  /** Подмена открывалки URL (тесты). */
  setUrlOpener(opener: (url: string) => Promise<void>) {
    this.openUrl = opener;
  }

  private clearAutoOpenTimer(item: ActiveProcessItem) {
    if (item.autoOpenTimer) {
      clearTimeout(item.autoOpenTimer);
      item.autoOpenTimer = undefined;
    }
  }

  /**
   * Автооткрытие `autoOpenUrl` (аудит 6.1): один раз за запуск, только пока процесс жив,
   * только http/https. Триггер — первая строка лога с URL либо таймер задержки.
   */
  private triggerAutoOpen(item: ActiveProcessItem, reason: 'log' | 'delay') {
    if (item.autoOpened) return;
    const url = item.options.autoOpenUrl?.trim();
    if (!url || item.info.status !== 'running') return;
    item.autoOpened = true;
    this.clearAutoOpenTimer(item);
    if (!isAutoOpenUrlAllowed(url)) {
      console.warn(`[ProcessManager] autoOpenUrl rejected (${reason}): ${url.slice(0, 200)}`);
      return;
    }
    this.openUrl(url).catch((err) => {
      console.error(`[ProcessManager] autoOpenUrl failed for ${item.info.id}:`, err);
    });
  }

  private scheduleAutoOpen(item: ActiveProcessItem) {
    const url = item.options.autoOpenUrl?.trim();
    if (!url) return;
    const delay = item.options.autoOpenDelayMs ?? DEFAULT_AUTO_OPEN_DELAY_MS;
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = setTimeout(() => this.triggerAutoOpen(item, 'delay'), delay);
    timer.unref?.();
    item.autoOpenTimer = timer;
  }

  private logListeners: Array<(data: { processId: string; text: string }) => void> = [];
  private statusListeners: Array<(process: ManagedProcess) => void> = [];

  public onLog(listener: (data: { processId: string; text: string }) => void): () => void {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  public onStatusChanged(listener: (process: ManagedProcess) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private broadcastLog(processId: string, text: string) {
    for (const listener of this.logListeners) {
      try {
        listener({ processId, text });
      } catch {
        // ignore
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('process:logChunk', { processId, text });
      }
    }
  }

  private broadcastStatus(proc: ManagedProcess) {
    for (const listener of this.statusListeners) {
      try {
        listener(proc);
      } catch {
        // ignore
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('process:statusChanged', proc);
      }
    }
    // Аварийное завершение уходит в шину событий (TASK-63, decision-13 п.1): трей, системное
    // уведомление и Telegram подписаны на неё, а не на этот сервис. Статус `failed` ставится
    // только при ненулевом коде выхода или ошибке запуска — остановка пользователем сюда не попадает.
    if (proc.status === 'failed') {
      appEventBus.publish({
        type: 'process:crashed',
        processId: proc.id,
        name: proc.name,
        projectPath: proc.workspaceRoot || proc.cwd,
        exitCode: proc.exitCode,
        at: Date.now()
      });
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
    this.clearAutoOpenTimer(item);
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
    name: string,
    options: StartProcessOptions = {}
  ): Promise<ManagedProcess> {
    // Рабочее дерево: активный worktree либо сам корень проекта (TASK-62).
    const workspaceRoot = path.normalize(options.workspaceRoot?.trim() || projectPath);
    const id = buildProcessId(workspaceRoot, name);
    const workingDir = resolveWorkingDir(workspaceRoot, options.cwd);
    if (!existsSync(workingDir)) {
      throw new Error(`Рабочий каталог не найден: ${workingDir}`);
    }

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

    // env из ActionDefinition накладывается поверх окружения приложения; значения приводим к строкам,
    // чтобы число/boolean из JSON не превратились в `[object Object]`/undefined.
    const actionEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value === undefined || value === null) continue;
      actionEnv[key] = String(value);
    }

    // portStrategy: 'auto' — свободный порт в PORT, в `${port}` команды и autoOpenUrl (TASK-62).
    let effectiveCommand = command;
    let autoOpenUrl = options.autoOpenUrl;
    let port: number | undefined;
    if (options.portStrategy === 'auto') {
      const start = isValidPort(options.port) ? options.port : DEFAULT_PORT_SEARCH_START;
      // Порты, уже выданные работающим процессам, исключаем: сервер мог ещё не успеть
      // занять свой порт, и параллельный старт во втором worktree получил бы тот же номер.
      const reserved = this.reservedPorts();
      port = await findFreePort(start, PORT_SEARCH_RANGE, async (p) => !reserved.has(p) && (await isPortFree(p)));
      actionEnv.PORT = String(port);
      if (hasPortPlaceholder(effectiveCommand)) effectiveCommand = substitutePort(effectiveCommand, port);
      if (hasPortPlaceholder(autoOpenUrl)) autoOpenUrl = substitutePort(autoOpenUrl!, port);
    } else if (isValidPort(options.port)) {
      port = options.port;
    }

    const shellSpec = resolveShellSpawn(effectiveCommand);
    const child = spawn(shellSpec.file, shellSpec.args, {
      cwd: workingDir,
      env: { ...process.env, FORCE_COLOR: '1', ...actionEnv },
      windowsVerbatimArguments: shellSpec.windowsVerbatimArguments
    });

    const normalizedProject = path.normalize(projectPath);
    const info: ManagedProcess = {
      id,
      name,
      command: effectiveCommand,
      // cwd — привязка к проекту (по нему процесс ищут UI и listProcessesForProject),
      // workspaceRoot — рабочее дерево, workingDir — фактический каталог запуска.
      cwd: normalizedProject,
      workspaceRoot: workspaceRoot !== normalizedProject ? workspaceRoot : undefined,
      workingDir: workingDir !== workspaceRoot ? workingDir : undefined,
      port,
      pid: child.pid,
      startedAt: new Date().toISOString(),
      status: 'running',
      source: 'hub'
    };

    let resolveExited: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });

    const item: ActiveProcessItem = {
      info,
      child,
      options: { ...options, workspaceRoot, autoOpenUrl, port },
      restartSpec: { command, options: { ...options, workspaceRoot } },
      exited,
      logBuffer: [],
      logBytes: 0
    };

    this.activeProcesses.set(id, item);

    const onData = (data: Buffer) => {
      const text = data.toString();
      appendLogChunk(item, text);
      this.broadcastLog(id, text);
      if (!item.autoOpened && item.options.autoOpenUrl && containsUrl(text)) {
        this.triggerAutoOpen(item, 'log');
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // Если запись уже заменена перезапуском с тем же id, статус старого процесса в рендерер
    // не шлём — иначе он перетёр бы «running» нового процесса (тот же id).
    const isCurrent = () => this.activeProcesses.get(id) === item;

    child.on('close', (code) => {
      // stopProcess мог уже выставить 'stopped' — не перезаписываем на 'failed' по коду сигнала.
      if (info.status === 'running') {
        info.status = code === 0 ? 'stopped' : 'failed';
      }
      info.exitCode = code ?? undefined;
      if (isCurrent()) {
        this.broadcastStatus(info);
        this.broadcastLog(id, `\r\n[Process exited with code ${code}]\r\n`);
      }
      this.markFinished(id, item);
      resolveExited();
    });

    child.on('error', (err) => {
      info.status = 'failed';
      if (isCurrent()) {
        this.broadcastStatus(info);
        this.broadcastLog(id, `\r\n[Process error: ${err.message}]\r\n`);
      }
      this.markFinished(id, item);
      resolveExited();
    });

    this.scheduleAutoOpen(item);
    this.broadcastStatus(info);
    return info;
  }

  /**
   * Остановка процесса. Hub-процесс — tree-kill по pid и ожидание фактического закрытия
   * (до `STOP_WAIT_MS`), чтобы перезапуск не упёрся в занятый порт. Процесс env-tools
   * (не из этой сессии) — по pid из `.env-state/processes.json`; запись из реестра удаляется,
   * как это делает `stop_process` самого env-tools (аудит 6.1).
   */
  async stopProcess(id: string): Promise<boolean> {
    const item = this.activeProcesses.get(id);
    if (!item) {
      return this.stopEnvToolsProcess(id);
    }

    if (item.info.status !== 'running') return true;
    this.clearAutoOpenTimer(item);

    if (item.info.pid) {
      try {
        await treeKillAsync(item.info.pid, 'SIGKILL');
      } catch (err) {
        // Процесс мог завершиться сам между проверкой статуса и kill — это не ошибка.
        if (item.info.status === 'running' && isPidAlive(item.info.pid)) {
          console.error(`Failed to kill process tree for ${id}:`, err);
          return false;
        }
      }
    }

    item.info.status = 'stopped';
    this.broadcastStatus(item.info);

    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      item.exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_WAIT_MS);
        timer.unref?.();
      })
    ]);
    if (timer) clearTimeout(timer);
    return true;
  }

  private async stopEnvToolsProcess(id: string): Promise<boolean> {
    const parsed = parseProcessId(id);
    if (!parsed) return false;
    const { projectPath, name } = parsed;
    const registryFile = envStateRegistryPath(projectPath);
    if (!existsSync(registryFile)) return false;

    let registry: Record<string, EnvToolsRegistryEntry>;
    try {
      registry = await readEnvToolsRegistry(projectPath);
    } catch (err) {
      console.error(`Failed to read env-tools registry ${registryFile}:`, err);
      return false;
    }
    const entry = registry[name];
    if (!entry) return false;

    if (entry.pid && isPidAlive(entry.pid)) {
      try {
        await treeKillAsync(entry.pid, 'SIGKILL');
      } catch (err) {
        if (isPidAlive(entry.pid)) {
          console.error(`Failed to kill env-tools process ${name} (pid ${entry.pid}):`, err);
          return false;
        }
      }
    }

    delete registry[name];
    try {
      await fs.writeFile(registryFile, JSON.stringify(registry, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to update env-tools registry ${registryFile}:`, err);
    }

    const normalizedProject = path.normalize(projectPath);
    const entryCwd = entry.cwd ? path.normalize(entry.cwd) : undefined;
    this.broadcastStatus({
      id,
      name,
      command: entry.command || '',
      cwd: normalizedProject,
      workingDir: entryCwd && entryCwd !== normalizedProject ? entryCwd : undefined,
      pid: entry.pid,
      startedAt: entry.startedAt || new Date().toISOString(),
      status: 'stopped',
      source: 'env-tools'
    });
    return true;
  }

  /**
   * Перезапуск: hub-процесс — стоп и старт с теми же командой/env/cwd/autoOpenUrl;
   * процесс env-tools — стоп по реестру и запуск той же команды уже под управлением Hub
   * (env-tools запускает процессы только из своего MCP-сервера).
   */
  async restartProcess(id: string): Promise<ManagedProcess> {
    const item = this.activeProcesses.get(id);
    if (item) {
      if (item.info.status === 'running') {
        const stopped = await this.stopProcess(id);
        if (!stopped) throw new Error(`Не удалось остановить процесс ${item.info.name}`);
      }
      return this.startProcess(
        item.info.cwd,
        item.restartSpec.command,
        item.info.name,
        item.restartSpec.options
      );
    }

    const parsed = parseProcessId(id);
    if (!parsed) throw new Error(`Некорректный идентификатор процесса: ${id}`);
    const registry = await readEnvToolsRegistry(parsed.projectPath).catch(
      () => ({}) as Record<string, EnvToolsRegistryEntry>
    );
    const entry = registry[parsed.name];
    if (!entry?.command) throw new Error(`Процесс ${parsed.name} не найден в реестре env-tools`);
    await this.stopEnvToolsProcess(id);
    return this.startProcess(parsed.projectPath, entry.command, parsed.name, { cwd: entry.cwd });
  }

  /** Порты, выданные ещё работающим процессам Hub (TASK-62). */
  private reservedPorts(): Set<number> {
    const reserved = new Set<number>();
    for (const item of this.activeProcesses.values()) {
      if (item.info.status === 'running' && item.info.port) reserved.add(item.info.port);
    }
    return reserved;
  }

  /**
   * Кто слушает порт (TASK-62): pid'ы из netstat/lsof, для процессов самого Hub —
   * их id и имя, чтобы UI показал «порт занят Dev Server из worktree task-62».
   */
  async listPortOwners(port: number): Promise<PortOwner[]> {
    const pids = await findPortOwners(port);
    const owners: PortOwner[] = pids.map((pid) => ({ pid }));
    for (const item of this.activeProcesses.values()) {
      if (item.info.status !== 'running' || !item.info.pid) continue;
      const own = owners.find((o) => o.pid === item.info.pid);
      if (own) {
        own.processId = item.info.id;
        own.name = item.info.name;
        own.workspaceRoot = item.info.workspaceRoot || item.info.cwd;
      } else if (item.info.port === port) {
        // Дочерний процесс держит порт из-под оболочки: pid слушателя другой, но порт наш.
        owners.push({
          pid: item.info.pid,
          processId: item.info.id,
          name: item.info.name,
          workspaceRoot: item.info.workspaceRoot || item.info.cwd
        });
      }
    }
    return owners;
  }

  /**
   * Освобождение порта: hub-процессы останавливаются штатно (с ожиданием выхода),
   * посторонние pid'ы снимаются tree-kill. Возвращает, что удалось освободить.
   */
  async releasePort(port: number): Promise<{ killed: number[]; failed: number[] }> {
    const owners = await this.listPortOwners(port);
    const killed: number[] = [];
    const failed: number[] = [];
    for (const owner of owners) {
      try {
        if (owner.processId) {
          const ok = await this.stopProcess(owner.processId);
          (ok ? killed : failed).push(owner.pid);
          continue;
        }
        await treeKillAsync(owner.pid, 'SIGKILL');
        killed.push(owner.pid);
      } catch (err) {
        if (isPidAlive(owner.pid)) {
          console.error(`[ProcessManager] Failed to release port ${port} (pid ${owner.pid}):`, err);
          failed.push(owner.pid);
        } else {
          killed.push(owner.pid);
        }
      }
    }
    return { killed, failed };
  }

  getLogs(id: string): string[] {
    return this.activeProcesses.get(id)?.logBuffer || [];
  }

  /** Число записей в activeProcesses (запущенные + ещё не вытесненные завершённые). */
  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  /** Все активные процессы со статусом running (для удаленного мониторинга и Telegram Mini App). */
  getAllRunningProcesses(): ManagedProcess[] {
    const result: ManagedProcess[] = [];
    for (const item of this.activeProcesses.values()) {
      if (item.info.status === 'running') {
        result.push({ ...item.info, autoOpenUrl: item.options.autoOpenUrl || undefined });
      }
    }
    return result;
  }

  /** Запущен ли процесс с таким id прямо сейчас (TASK-63: демон Telegram-бота). */
  isRunning(id: string): boolean {
    return this.activeProcesses.get(id)?.info.status === 'running';
  }

  /**
   * Служебные процессы самого ProjectHub (TASK-63): всё, что запущено из каталога
   * `<userData>/services` — например, демон Telegram-бота. В отличие от процессов проекта,
   * они не привязаны ни к какому репозиторию, поэтому вкладка «Процессы» показывает их
   * отдельной секцией независимо от выбранного проекта.
   */
  listServiceProcesses(serviceRoot: string): ManagedProcess[] {
    const normalized = path.normalize(serviceRoot);
    const result: ManagedProcess[] = [];
    for (const item of this.activeProcesses.values()) {
      if (path.normalize(item.info.cwd) === normalized) {
        result.push({ ...item.info, autoOpenUrl: item.options.autoOpenUrl || undefined });
      }
    }
    return result;
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
        result.push({ ...item.info, autoOpenUrl: item.options.autoOpenUrl || undefined });
      }
    }

    // 2. Scan env-tools registry: .env-state/processes.json
    const envStateFile = path.join(normalized, '.env-state', 'processes.json');
    if (existsSync(envStateFile)) {
      try {
        const raw = await fs.readFile(envStateFile, 'utf-8');
        const reg = JSON.parse(raw);
        for (const [name, entry] of Object.entries<EnvToolsRegistryEntry>(reg)) {
          const envId = `${normalized}::${name}`;
          // If already in hub processes, skip
          if (!this.activeProcesses.has(envId)) {
            const isAlive = isPidAlive(entry.pid);

            const entryCwd = entry.cwd ? path.normalize(entry.cwd) : undefined;
            result.push({
              id: envId,
              name,
              command: entry.command || '',
              // cwd — корень проекта (как у hub-процессов), фактический каталог — workingDir.
              cwd: normalized,
              workingDir: entryCwd && entryCwd !== normalized ? entryCwd : undefined,
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
      this.clearAutoOpenTimer(item);
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
