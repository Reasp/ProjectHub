import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import chokidar from 'chokidar';
import { appEventBus } from './eventBus.js';
import type { AppBusEvent } from './hitlTypes.js';
import { normalizePathKey } from './automationRules.js';
import { diffTaskSnapshot, taskSnapshotFromFrontmatter, type TaskSnapshot } from './taskSnapshot.js';

/**
 * Источник события `task:updated` (TASK-74, decision-52 п. 2).
 *
 * Наблюдает `backlog/tasks` проектов, которые нужны включённым автоматизациям (открытый проект —
 * для встроенного правила назначенных задач, проекты правил с триггерами задач), держит снимок
 * frontmatter каждой задачи и публикует в шину, что изменилось. Снимок строится при старте
 * наблюдения, поэтому первое изменение существующей задачи — это изменение, а не «создание».
 */

interface Watcher {
  close(): Promise<void> | void;
  on(event: 'add' | 'change' | 'unlink', listener: (filePath: string) => void): unknown;
}

type WatchFactory = (dir: string) => Watcher;

interface WatchedProject {
  root: string;
  watcher: Watcher | null;
  baseline: Promise<void>;
  snapshots: Map<string, TaskSnapshot>;
}

const defaultWatchFactory: WatchFactory = (dir) =>
  chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  });

export class TaskEventSource {
  private projects = new Map<string, WatchedProject>();

  constructor(
    private readonly publish: (event: AppBusEvent) => void = (e) => appEventBus.publish(e),
    private readonly watchFactory: WatchFactory = defaultWatchFactory
  ) {}

  /** Приводит набор наблюдаемых проектов к заданному. */
  public setProjects(roots: string[]): void {
    const wanted = new Map(roots.filter(Boolean).map((r) => [normalizePathKey(r), r]));
    for (const [key, project] of this.projects) {
      if (!wanted.has(key)) {
        void project.watcher?.close();
        this.projects.delete(key);
      }
    }
    for (const [key, root] of wanted) {
      if (!this.projects.has(key)) this.start(key, root);
    }
  }

  public watchedRoots(): string[] {
    return [...this.projects.values()].map((p) => p.root);
  }

  private start(key: string, root: string): void {
    const tasksDir = path.join(root, 'backlog', 'tasks');
    const project: WatchedProject = { root, watcher: null, snapshots: new Map(), baseline: Promise.resolve() };
    project.baseline = this.readBaseline(tasksDir, project.snapshots);
    this.projects.set(key, project);
    try {
      const watcher = this.watchFactory(tasksDir);
      watcher.on('add', (fp) => void this.ingest(root, fp));
      watcher.on('change', (fp) => void this.ingest(root, fp));
      watcher.on('unlink', (fp) => project.snapshots.delete(normalizePathKey(fp)));
      project.watcher = watcher;
    } catch (err) {
      console.warn(`[TaskEventSource] Не удалось наблюдать ${tasksDir}:`, err);
    }
  }

  private async readBaseline(tasksDir: string, snapshots: Map<string, TaskSnapshot>): Promise<void> {
    const files = await fs.readdir(tasksDir).catch(() => [] as string[]);
    for (const name of files) {
      if (!name.toLowerCase().endsWith('.md')) continue;
      const filePath = path.join(tasksDir, name);
      const snap = await this.readSnapshot(filePath);
      if (snap) snapshots.set(normalizePathKey(filePath), snap);
    }
  }

  private async readSnapshot(filePath: string): Promise<TaskSnapshot | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return taskSnapshotFromFrontmatter(matter(raw).data as Record<string, unknown>, filePath);
    } catch {
      return null;
    }
  }

  /** Файл задачи добавлен или изменён: сравнить со снимком и опубликовать `task:updated`. */
  public async ingest(root: string, filePath: string): Promise<void> {
    if (!filePath.toLowerCase().endsWith('.md')) return;
    const project = this.projects.get(normalizePathKey(root));
    if (!project) return;
    await project.baseline;
    const snap = await this.readSnapshot(filePath);
    if (!snap) return;
    const fileKey = normalizePathKey(filePath);
    const update = diffTaskSnapshot(project.snapshots.get(fileKey), snap);
    project.snapshots.set(fileKey, snap);
    this.publish({
      type: 'task:updated',
      projectPath: project.root,
      taskId: snap.taskId,
      title: snap.title,
      status: snap.status,
      assignee: snap.assignee,
      labels: snap.labels,
      created: update.created,
      changes: update.changes,
      at: Date.now()
    });
  }

  public async whenReady(): Promise<void> {
    await Promise.all([...this.projects.values()].map((p) => p.baseline));
  }

  public stopAll(): void {
    this.setProjects([]);
  }
}

export const taskEventSource = new TaskEventSource();
