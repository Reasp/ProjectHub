import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserDataDir } from './appPaths.js';
import type { AgentSlotState, HandoffStageState, SwarmSession } from './swarmTypes.js';
import { AGENT_LOG_LIMITS } from './swarmLogBuffer.js';

/**
 * Файловое хранилище swarm-сессий (TASK-56, decision-16), по образцу `aiSessionStore`.
 *
 * Раскладка: `<userData>/swarms/<sessionId>.json` — состояние сессии (усечённое по лимитам),
 * `<userData>/swarms/<sessionId>/<agentId>.log` — полный транскрипт агента с ротацией.
 * Запись состояния троттлится (`scheduleSave`): при потоке чанков файл обновляется не чаще
 * раза в `saveDelayMs`, терминальные события пишутся сразу через `save`.
 */

export const SWARM_STORE_VERSION = 1;

/** Лимиты усечения строк при записи состояния на диск (в символах). */
export const SWARM_STORAGE_LIMITS = {
  liveOutput: 100_000,
  finalOutput: 200_000,
  diffPatch: 200_000,
  stageOutput: 50_000,
  stagePrompt: 20_000,
  prompt: 50_000,
  error: 4_000,
  logLines: AGENT_LOG_LIMITS.maxLines
} as const;

/** Транскрипт агента: при превышении текущий файл переименовывается в `.1.log`, старый бэкап удаляется. */
export const TRANSCRIPT_MAX_BYTES = 5 * 1024 * 1024;
/** Сколько байт транскрипта отдаётся в UI по умолчанию (хвост). */
export const TRANSCRIPT_READ_MAX_BYTES = 2 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export function isValidSwarmId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function isValidAgentId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

function truncate(value: string, limit: number): string {
  if (typeof value !== 'string') return '';
  if (value.length <= limit) return value;
  const dropped = value.length - limit;
  return `${value.slice(0, limit)}\n…[усечено при сохранении: ещё ${dropped} символов]`;
}

function compactAgent(agent: AgentSlotState): AgentSlotState {
  const logs = Array.isArray(agent.logs) ? agent.logs : [];
  const keptLogs = logs.length > SWARM_STORAGE_LIMITS.logLines ? logs.slice(-SWARM_STORAGE_LIMITS.logLines) : logs;
  const out: AgentSlotState = {
    ...agent,
    logs: keptLogs,
    logsDropped: (agent.logsDropped ?? 0) + (logs.length - keptLogs.length) || undefined,
    liveOutput: truncate(agent.liveOutput ?? '', SWARM_STORAGE_LIMITS.liveOutput),
    liveOutputTruncated: agent.liveOutputTruncated || (agent.liveOutput?.length ?? 0) > SWARM_STORAGE_LIMITS.liveOutput || undefined
  };
  if (agent.finalOutput) out.finalOutput = truncate(agent.finalOutput, SWARM_STORAGE_LIMITS.finalOutput);
  if (agent.error) out.error = truncate(agent.error, SWARM_STORAGE_LIMITS.error);
  if (agent.diffSummary) {
    const patch = agent.diffSummary.patch ?? '';
    out.diffSummary = {
      ...agent.diffSummary,
      patch: truncate(patch, SWARM_STORAGE_LIMITS.diffPatch),
      ...(patch.length > SWARM_STORAGE_LIMITS.diffPatch ? { truncated: true } : {})
    };
  }
  // API-ключи провайдера в файл не пишем.
  if (agent.config?.providerConfig?.apiKey) {
    out.config = { ...agent.config, providerConfig: { ...agent.config.providerConfig, apiKey: undefined } };
  }
  return out;
}

function compactStage(stage: HandoffStageState): HandoffStageState {
  return {
    ...stage,
    inputPrompt: truncate(stage.inputPrompt ?? '', SWARM_STORAGE_LIMITS.stagePrompt),
    ...(stage.outputResult ? { outputResult: truncate(stage.outputResult, SWARM_STORAGE_LIMITS.stageOutput) } : {})
  };
}

export interface StoredSwarmSession extends SwarmSession {
  version: number;
}

/** Копия сессии для записи на диск: усечённые тяжёлые поля, без ключей провайдеров, с версией формата. */
export function compactSwarmSessionForStorage(session: SwarmSession): StoredSwarmSession {
  return {
    ...session,
    version: SWARM_STORE_VERSION,
    prompt: truncate(session.prompt ?? '', SWARM_STORAGE_LIMITS.prompt),
    ...(session.error ? { error: truncate(session.error, SWARM_STORAGE_LIMITS.error) } : {}),
    agents: Array.isArray(session.agents) ? session.agents.map(compactAgent) : [],
    ...(session.handoffStages ? { handoffStages: session.handoffStages.map(compactStage) } : {})
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Приведение сырого JSON к текущей версии формата. Версия 0 (файлы без поля `version`)
 * — та же структура, что и v1, но без гарантии наличия `logs`/`metrics` у агентов.
 * Неизвестная (более новая) версия читается как есть — лучше показать сессию, чем потерять.
 */
export function migrateStoredSession(raw: unknown): SwarmSession | null {
  if (!isRecord(raw)) return null;
  if (!isValidSwarmId(raw.id) || !Array.isArray(raw.agents) || typeof raw.projectPath !== 'string') return null;
  const version = typeof raw.version === 'number' ? raw.version : 0;
  const session = { ...raw } as Record<string, unknown>;
  delete session.version;

  if (version <= 1) {
    session.mode = session.mode === 'handoff' ? 'handoff' : 'fan_out';
    session.prompt = typeof session.prompt === 'string' ? session.prompt : '';
    session.baseBranch = typeof session.baseBranch === 'string' ? session.baseBranch : 'main';
    session.useWorktrees = session.useWorktrees !== false;
    session.createdAt = typeof session.createdAt === 'number' ? session.createdAt : Date.now();
    session.status = typeof session.status === 'string' ? session.status : 'interrupted';
    session.agents = (raw.agents as unknown[]).filter(isRecord).map((a) => {
      const metrics = isRecord(a.metrics) ? a.metrics : {};
      return {
        ...a,
        id: typeof a.id === 'string' ? a.id : `agent-${Math.random().toString(36).slice(2, 7)}`,
        config: isRecord(a.config) ? a.config : { id: String(a.id ?? ''), name: String(a.id ?? 'agent'), engine: 'api' },
        status: typeof a.status === 'string' ? a.status : 'interrupted',
        logs: Array.isArray(a.logs) ? a.logs.filter((l) => typeof l === 'string') : [],
        liveOutput: typeof a.liveOutput === 'string' ? a.liveOutput : '',
        metrics: { startTime: typeof metrics.startTime === 'number' ? metrics.startTime : 0, ...metrics }
      };
    });
  }
  return session as unknown as SwarmSession;
}

export class SwarmSessionStore {
  private pendingSaves = new Map<string, { timer: NodeJS.Timeout; session: SwarmSession }>();
  private inFlight = new Map<string, Promise<void>>();
  private transcriptQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly baseDir: string = path.join(getUserDataDir(), 'swarms'),
    private readonly saveDelayMs: number = 1000
  ) {}

  public get directory(): string {
    return this.baseDir;
  }

  public sessionFile(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.json`);
  }

  public transcriptDir(sessionId: string): string {
    return path.join(this.baseDir, sessionId);
  }

  public transcriptFile(sessionId: string, agentId: string): string {
    return path.join(this.transcriptDir(sessionId), `${agentId}.log`);
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /** Все сессии на диске, новые первыми. Битые файлы пропускаются с предупреждением. */
  public async list(): Promise<SwarmSession[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch {
      return [];
    }
    const sessions: SwarmSession[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!isValidSwarmId(id)) continue;
      try {
        const raw = await fs.readFile(path.join(this.baseDir, name), 'utf8');
        const session = migrateStoredSession(JSON.parse(raw));
        if (session && session.id === id) sessions.push(session);
      } catch (e) {
        console.warn(`[SwarmSessionStore] Пропущен повреждённый файл сессии ${name}:`, e);
      }
    }
    sessions.sort((a, b) => b.createdAt - a.createdAt);
    return sessions;
  }

  /** Атомарная запись (tmp + rename). Параллельные вызовы для одной сессии сериализуются. */
  public async save(session: SwarmSession): Promise<void> {
    if (!isValidSwarmId(session?.id)) {
      throw new Error(`Недопустимый идентификатор swarm-сессии: ${String(session?.id)}`);
    }
    const pending = this.pendingSaves.get(session.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSaves.delete(session.id);
    }
    const previous = this.inFlight.get(session.id) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        await this.ensureDir(this.baseDir);
        const target = this.sessionFile(session.id);
        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
        const payload = JSON.stringify(compactSwarmSessionForStorage(session));
        await fs.writeFile(tmp, payload, 'utf8');
        try {
          await fs.rename(tmp, target);
        } catch (e) {
          await fs.rm(tmp, { force: true }).catch(() => undefined);
          throw e;
        }
      });
    this.inFlight.set(session.id, run);
    try {
      await run;
    } finally {
      if (this.inFlight.get(session.id) === run) this.inFlight.delete(session.id);
    }
  }

  /**
   * Троттлинг записи: первый вызов ставит таймер, последующие в пределах окна лишь обновляют
   * ссылку на сессию. Так поток чанков не порождает запись на каждый байт, но состояние
   * гарантированно попадает на диск не позже `saveDelayMs`.
   */
  public scheduleSave(session: SwarmSession): void {
    if (!isValidSwarmId(session?.id)) return;
    const existing = this.pendingSaves.get(session.id);
    if (existing) {
      existing.session = session;
      return;
    }
    const timer = setTimeout(() => {
      const entry = this.pendingSaves.get(session.id);
      this.pendingSaves.delete(session.id);
      if (!entry) return;
      this.save(entry.session).catch((e) => {
        console.warn(`[SwarmSessionStore] Не удалось сохранить сессию ${session.id}:`, e);
      });
    }, this.saveDelayMs);
    timer.unref?.();
    this.pendingSaves.set(session.id, { timer, session });
  }

  /** Немедленно записывает все отложенные сохранения и дожидается идущих записей (перед выходом). */
  public async flush(): Promise<void> {
    const pending = Array.from(this.pendingSaves.values());
    for (const entry of pending) clearTimeout(entry.timer);
    this.pendingSaves.clear();
    await Promise.allSettled(pending.map((entry) => this.save(entry.session)));
    await Promise.allSettled(Array.from(this.inFlight.values()));
    await Promise.allSettled(Array.from(this.transcriptQueues.values()));
  }

  /** Удаляет файл состояния и каталог транскриптов сессии. */
  public async delete(sessionId: string): Promise<boolean> {
    if (!isValidSwarmId(sessionId)) return false;
    const pending = this.pendingSaves.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSaves.delete(sessionId);
    }
    await (this.inFlight.get(sessionId) ?? Promise.resolve()).catch(() => undefined);
    try {
      await fs.rm(this.sessionFile(sessionId), { force: true });
      await fs.rm(this.transcriptDir(sessionId), { recursive: true, force: true });
      return true;
    } catch (e) {
      console.warn(`[SwarmSessionStore] Не удалось удалить сессию ${sessionId}:`, e);
      return false;
    }
  }

  /**
   * Дозапись в транскрипт агента. Записи одного файла сериализуются очередью, чтобы чанки
   * не перемешивались. При превышении `TRANSCRIPT_MAX_BYTES` файл ротируется в `.1.log`.
   */
  public appendTranscript(sessionId: string, agentId: string, text: string): Promise<void> {
    if (!text || !isValidSwarmId(sessionId) || !isValidAgentId(agentId)) return Promise.resolve();
    const key = `${sessionId}/${agentId}`;
    const previous = this.transcriptQueues.get(key) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const dir = this.transcriptDir(sessionId);
        await this.ensureDir(dir);
        const file = this.transcriptFile(sessionId, agentId);
        try {
          const stat = await fs.stat(file);
          if (stat.size + Buffer.byteLength(text) > TRANSCRIPT_MAX_BYTES) {
            const backup = `${file.slice(0, -'.log'.length)}.1.log`;
            await fs.rm(backup, { force: true }).catch(() => undefined);
            await fs.rename(file, backup);
          }
        } catch {
          /* файла ещё нет */
        }
        await fs.appendFile(file, text, 'utf8');
      })
      .catch((e) => {
        console.warn(`[SwarmSessionStore] Не удалось дописать транскрипт ${key}:`, e);
      });
    this.transcriptQueues.set(key, run);
    void run.then(() => {
      if (this.transcriptQueues.get(key) === run) this.transcriptQueues.delete(key);
    });
    return run;
  }

  /** Читает транскрипт (хвост не длиннее `maxBytes`). Возвращает null, если файла нет. */
  public async readTranscript(
    sessionId: string,
    agentId: string,
    maxBytes: number = TRANSCRIPT_READ_MAX_BYTES
  ): Promise<{ path: string; content: string; truncated: boolean; sizeBytes: number } | null> {
    if (!isValidSwarmId(sessionId) || !isValidAgentId(agentId)) return null;
    await (this.transcriptQueues.get(`${sessionId}/${agentId}`) ?? Promise.resolve()).catch(() => undefined);
    const file = this.transcriptFile(sessionId, agentId);
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(file, 'r');
    } catch {
      return null;
    }
    try {
      const stat = await handle.stat();
      const size = stat.size;
      const start = Math.max(0, size - maxBytes);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      if (length > 0) await handle.read(buffer, 0, length, start);
      return {
        path: file,
        content: buffer.toString('utf8'),
        truncated: start > 0,
        sizeBytes: size
      };
    } finally {
      await handle.close();
    }
  }
}
