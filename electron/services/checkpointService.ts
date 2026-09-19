import os from 'node:os';
import {
  checkpointRef,
  checkpointRefPrefix,
  checkpointsToPrune,
  countChangedFiles,
  createCheckpoint,
  deleteRefs,
  deleteRefsByPrefix,
  execGit,
  isGitWorkTree,
  listRefs,
  rewindWorkTree,
  sanitizeRefSegment,
  swarmIdFromCheckpointRef,
  CHECKPOINT_REF_ROOT,
  type GitRunner,
  type RewindResult
} from './checkpointGit.js';
import type { AgentCheckpoint, AgentTraceCounters, CheckpointKind } from './agentTraceTypes.js';

/**
 * Чекпоинты агента (TASK-72, decision-45 п. 1, 2, 5): очередь git-операций по агенту, номера,
 * дедупликация по дереву и лимит. Без Electron: состояние — поля агента, которые передаёт сервис флота.
 */

export const MAX_CHECKPOINTS_PER_AGENT = 50;

/** Поля агента, которыми владеет сервис чекпоинтов (подмножество `AgentSlotState`). */
export interface CheckpointHolder {
  id: string;
  checkpoints?: AgentCheckpoint[];
  trace?: AgentTraceCounters;
}

export interface CaptureRequest {
  swarmId: string;
  agent: CheckpointHolder;
  cwd: string;
  kind: CheckpointKind;
  run?: number;
  turn?: number;
  /** Снимать даже при совпадении дерева с предыдущим (снимок перед откатом). */
  force?: boolean;
}

export type CaptureResult =
  | { status: 'created'; checkpoint: AgentCheckpoint; pruned: AgentCheckpoint[] }
  | { status: 'same_tree'; checkpoint?: AgentCheckpoint }
  | { status: 'not_git' }
  | { status: 'error'; error: string };

export function emptyTraceCounters(): AgentTraceCounters {
  return { runs: 0, turns: 0, checkpoints: 0 };
}

export function ensureTraceCounters(agent: { trace?: AgentTraceCounters }): AgentTraceCounters {
  if (!agent.trace) agent.trace = emptyTraceCounters();
  return agent.trace;
}

export class CheckpointService {
  private queues = new Map<string, Promise<unknown>>();
  private gitDirs = new Map<string, boolean>();

  constructor(
    private readonly git: GitRunner = execGit,
    private readonly limit: number = MAX_CHECKPOINTS_PER_AGENT,
    private readonly tmpDir: string = os.tmpdir()
  ) {}

  private key(swarmId: string, agentId: string): string {
    return `${swarmId}/${agentId}`;
  }

  /** Операции одного агента выполняются строго по очереди (снимок, откат, удаление). */
  private enqueue<T>(swarmId: string, agentId: string, fn: () => Promise<T>): Promise<T> {
    const key = this.key(swarmId, agentId);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.queues.set(key, run);
    void run
      .catch(() => undefined)
      .then(() => {
        if (this.queues.get(key) === run) this.queues.delete(key);
      });
    return run;
  }

  /** Дождаться завершения очереди агента (перед авто-коммитом и откатом). */
  public async whenIdle(swarmId: string, agentId: string): Promise<void> {
    await (this.queues.get(this.key(swarmId, agentId)) ?? Promise.resolve()).catch(() => undefined);
  }

  public async isGitDir(cwd: string): Promise<boolean> {
    const cached = this.gitDirs.get(cwd);
    if (cached !== undefined) return cached;
    const ok = await isGitWorkTree(this.git, cwd);
    this.gitDirs.set(cwd, ok);
    return ok;
  }

  /** Снимок рабочего каталога агента; одинаковое с прошлым дерево не дублируется. */
  public capture(req: CaptureRequest): Promise<CaptureResult> {
    return this.enqueue(req.swarmId, req.agent.id, async (): Promise<CaptureResult> => {
      try {
        if (!(await this.isGitDir(req.cwd))) return { status: 'not_git' };
        const list = req.agent.checkpoints ?? [];
        const last = list.length > 0 ? list[list.length - 1] : undefined;
        const counters = ensureTraceCounters(req.agent);
        const n = counters.checkpoints + 1;
        const ref = checkpointRef(req.swarmId, req.agent.id, n);
        const snapshot = await createCheckpoint(this.git, req.cwd, {
          ref,
          message: `checkpoint(${req.agent.id}): ${req.kind} #${n}${req.turn !== undefined ? ` turn ${req.turn}` : ''}`,
          skipIfTree: req.force ? undefined : last?.tree,
          tmpDir: this.tmpDir
        });
        if (!snapshot) return { status: 'same_tree', ...(last ? { checkpoint: last } : {}) };
        counters.checkpoints = n;
        let filesChanged: number | undefined;
        try {
          filesChanged = await countChangedFiles(this.git, req.cwd, last?.tree ?? null, snapshot.tree);
        } catch {
          filesChanged = undefined;
        }
        const checkpoint: AgentCheckpoint = {
          n,
          kind: req.kind,
          ...(req.run !== undefined ? { run: req.run } : {}),
          ...(req.turn !== undefined ? { turn: req.turn } : {}),
          at: Date.now(),
          ref,
          commit: snapshot.commit,
          tree: snapshot.tree,
          parent: snapshot.parent,
          ...(filesChanged !== undefined ? { filesChanged } : {})
        };
        const next = [...list, checkpoint];
        const pruned = checkpointsToPrune(next, this.limit);
        if (pruned.length > 0) {
          await deleteRefs(this.git, req.cwd, pruned.map((c) => c.ref));
          const drop = new Set(pruned.map((c) => c.n));
          req.agent.checkpoints = next.filter((c) => !drop.has(c.n));
        } else {
          req.agent.checkpoints = next;
        }
        return { status: 'created', checkpoint, pruned };
      } catch (err) {
        return { status: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  /**
   * Откат к чекпоинту (decision-45 п. 4): сначала снимок `pre_rewind` текущего состояния, затем
   * возврат HEAD к родителю снимка и файлов — к снимку. Вызывающий проверяет, что откат разрешён.
   */
  public rewind(
    swarmId: string,
    agent: CheckpointHolder,
    cwd: string,
    target: AgentCheckpoint,
    run?: number
  ): Promise<{ preRewind?: AgentCheckpoint; result: RewindResult }> {
    return this.enqueue(swarmId, agent.id, async () => {
      // Снимок перед откатом — внутри той же очереди, чтобы между ним и откатом ничего не вклинилось.
      const list = agent.checkpoints ?? [];
      const counters = ensureTraceCounters(agent);
      const n = counters.checkpoints + 1;
      const ref = checkpointRef(swarmId, agent.id, n);
      const snapshot = await createCheckpoint(this.git, cwd, {
        ref,
        message: `checkpoint(${agent.id}): pre_rewind #${n} → #${target.n}`,
        tmpDir: this.tmpDir
      });
      let preRewind: AgentCheckpoint | undefined;
      if (snapshot) {
        counters.checkpoints = n;
        preRewind = {
          n,
          kind: 'pre_rewind',
          ...(run !== undefined ? { run } : {}),
          at: Date.now(),
          ref,
          commit: snapshot.commit,
          tree: snapshot.tree,
          parent: snapshot.parent
        };
        const next = [...list, preRewind];
        // Цель отката не должна уйти под лимит вместе со старыми снимками.
        const pruned = checkpointsToPrune(next.filter((c) => c.n !== target.n), this.limit - 1);
        if (pruned.length > 0) {
          await deleteRefs(this.git, cwd, pruned.map((c) => c.ref));
          const drop = new Set(pruned.map((c) => c.n));
          agent.checkpoints = next.filter((c) => !drop.has(c.n));
        } else {
          agent.checkpoints = next;
        }
      }
      const result = await rewindWorkTree(this.git, cwd, target.commit);
      // Для пользователя «удалено» — файлы, которых после отката нет относительно состояния до него
      // (часть убирает уже `reset --hard`, поэтому список команд отката для этого не годится).
      if (snapshot) {
        const gone = await this.git(['diff-tree', '-r', '--name-only', '-z', '--diff-filter=D', snapshot.tree, target.tree], { cwd }).catch(() => null);
        if (gone !== null) result.removedFiles = gone.split('\0').filter(Boolean);
      }
      return { ...(preRewind ? { preRewind } : {}), result };
    });
  }

  /** Коммит чекпоинта ещё существует (ref не удалён вручную или сборщиком). */
  public async exists(cwd: string, checkpoint: AgentCheckpoint): Promise<boolean> {
    try {
      const out = (await this.git(['rev-parse', '--verify', '-q', `${checkpoint.ref}^{commit}`], { cwd })).trim();
      return out === checkpoint.commit;
    } catch {
      return false;
    }
  }

  /** Удаление всех ref чекпоинтов сессии (закрытие сессии, decision-45 п. 5). */
  public async deleteSession(repoPath: string, swarmId: string): Promise<number> {
    if (!(await isGitWorkTree(this.git, repoPath))) return 0;
    return deleteRefsByPrefix(this.git, repoPath, checkpointRefPrefix(swarmId));
  }

  /** Удаление ref одного агента (проигравший кандидат после Pick Winner). */
  public async deleteAgent(repoPath: string, swarmId: string, agentId: string): Promise<number> {
    if (!(await isGitWorkTree(this.git, repoPath))) return 0;
    return deleteRefsByPrefix(this.git, repoPath, checkpointRefPrefix(swarmId, agentId));
  }

  /** Ref сессий, которых больше нет на диске (после краша или ручного удаления файлов состояния). */
  public async pruneOrphans(repoPath: string, knownSwarmIds: Set<string>): Promise<number> {
    if (!(await isGitWorkTree(this.git, repoPath))) return 0;
    const refs = await listRefs(this.git, repoPath, `${CHECKPOINT_REF_ROOT}/`);
    const known = new Set(Array.from(knownSwarmIds, (id) => sanitizeRefSegment(id)));
    const orphans = refs.filter((ref) => {
      const id = swarmIdFromCheckpointRef(ref);
      return id !== null && !known.has(id);
    });
    return deleteRefs(this.git, repoPath, orphans);
  }
}

export const checkpointService = new CheckpointService();
