import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppBusEvent } from './hitlTypes.js';
import { normalizePathKey } from './automationRules.js';
import { diffPrSnapshot, type PrInfo, type PrProjectSnapshot } from './prSnapshot.js';

/**
 * Опрос открытых PR для событий `pr:opened` / `pr:updated` (TASK-81, decision-53 п. 1).
 *
 * Опрашиваются только проекты, которым это нужно (их задаёт движок Automations). Снимок хранится в
 * `<userData>/pr-watch.json`, поэтому PR, открытый при закрытом приложении, даёт событие при
 * следующем запуске. Нет `gh`, авторизации или сети — проект встаёт на паузу с растущим интервалом
 * и одной записью в лог на смену состояния, а не падает на каждом опросе.
 */

export const PR_POLL_INTERVAL_MS = 3 * 60 * 1000;
export const PR_POLL_MAX_BACKOFF_MS = 30 * 60 * 1000;
export const PR_WATCH_FILE = 'pr-watch.json';

export interface PrWatcherDeps {
  listOpenPrs(projectRoot: string): Promise<PrInfo[]>;
  publish(event: AppBusEvent): void;
  stateDir: string;
  now(): number;
  log(level: 'info' | 'warn', message: string): void;
}

interface Backoff {
  failures: number;
  nextAt: number;
  lastError: string;
}

/** Пауза после N-й неудачи подряд: 3, 6, 12, 24, 30, 30 … минут. */
export function prPollBackoffMs(failures: number): number {
  return Math.min(PR_POLL_MAX_BACKOFF_MS, PR_POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1));
}

export class PrWatcher {
  private roots = new Map<string, string>();
  private snapshots: Record<string, PrProjectSnapshot> = {};
  private backoff = new Map<string, Backoff>();
  private loaded: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling: Promise<void> | null = null;

  constructor(private readonly deps: PrWatcherDeps) {}

  private get statePath(): string {
    return path.join(this.deps.stateDir, PR_WATCH_FILE);
  }

  private load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = fs
        .readFile(this.statePath, 'utf8')
        .then((text) => {
          const parsed = JSON.parse(text) as { projects?: Record<string, PrProjectSnapshot> };
          if (parsed?.projects && typeof parsed.projects === 'object') this.snapshots = parsed.projects;
        })
        .catch(() => undefined);
    }
    return this.loaded;
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.deps.stateDir, { recursive: true });
    const tmp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, projects: this.snapshots }, null, 2), 'utf8');
    await fs.rename(tmp, this.statePath).catch(async (err) => {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    });
  }

  /** Набор наблюдаемых проектов. Пустой — таймер останавливается. */
  public setProjects(roots: string[]): void {
    const next = new Map(roots.filter(Boolean).map((r) => [normalizePathKey(r), r]));
    const added = [...next.keys()].some((k) => !this.roots.has(k));
    this.roots = next;
    if (!this.roots.size) {
      this.stop();
      return;
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.pollAll(), PR_POLL_INTERVAL_MS);
      this.timer.unref?.();
    }
    if (added) void this.pollAll();
  }

  public watchedRoots(): string[] {
    return [...this.roots.values()];
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public pollAll(): Promise<void> {
    if (this.polling) return this.polling;
    this.polling = (async () => {
      await this.load();
      let changed = false;
      for (const [key, root] of this.roots) {
        if (await this.pollProject(key, root)) changed = true;
      }
      if (changed) await this.save().catch((err) => this.deps.log('warn', `[PrWatcher] Не удалось сохранить снимок: ${String(err)}`));
    })().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** Один проект: `true`, если снимок изменился. */
  private async pollProject(key: string, root: string): Promise<boolean> {
    const now = this.deps.now();
    const pause = this.backoff.get(key);
    if (pause && pause.nextAt > now) return false;
    let prs: PrInfo[];
    try {
      prs = await this.deps.listOpenPrs(root);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 300);
      const failures = (pause?.failures ?? 0) + 1;
      this.backoff.set(key, { failures, nextAt: now + prPollBackoffMs(failures), lastError: message });
      if (pause?.lastError !== message) this.deps.log('warn', `[PrWatcher] ${root}: опрос PR не удался (${message}); повтор с паузой`);
      return false;
    }
    if (pause) {
      this.backoff.delete(key);
      this.deps.log('info', `[PrWatcher] ${root}: опрос PR восстановлен`);
    }
    const { changes, next } = diffPrSnapshot(this.snapshots[key], prs, now);
    this.snapshots[key] = next;
    for (const change of changes) {
      const base = {
        projectPath: root,
        number: change.pr.number,
        title: change.pr.title,
        url: change.pr.url,
        headSha: change.pr.headSha,
        headRef: change.pr.headRef,
        baseRef: change.pr.baseRef,
        draft: change.pr.draft,
        ...(change.pr.author ? { author: change.pr.author } : {}),
        at: now
      };
      this.deps.publish(
        change.kind === 'opened'
          ? { type: 'pr:opened', ...base }
          : { type: 'pr:updated', ...base, reason: change.reason === 'ready' ? 'ready' : 'commits', ...(change.previousSha ? { previousSha: change.previousSha } : {}) }
      );
    }
    return true;
  }

  /** Состояние для UI и тестов. */
  public status(root: string): { paused: boolean; lastError?: string; knownPrs: number } {
    const key = normalizePathKey(root);
    const pause = this.backoff.get(key);
    return {
      paused: Boolean(pause && pause.nextAt > this.deps.now()),
      ...(pause ? { lastError: pause.lastError } : {}),
      knownPrs: Object.keys(this.snapshots[key]?.prs ?? {}).length
    };
  }
}
