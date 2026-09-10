import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import type { GitCommit, GitFileStatus, GitRepoDetails } from '../../src/types/electron';
import { processManager } from './processManager';

/** Базовый дебаунс `git:changed` (аудит 3.3: было 400 мс). */
export const GIT_CHANGED_DEBOUNCE_MS = 1500;
/** Дебаунс, когда в проекте идёт процесс из processManager (сборка, dev-сервер): события агрегируются. */
export const GIT_CHANGED_BUSY_DEBOUNCE_MS = 5000;
/** Максимальное ожидание при непрерывном потоке событий — чтобы статус всё же обновлялся. */
export const GIT_CHANGED_MAX_WAIT_MS = 15000;

/**
 * Каталоги, изменения в которых не имеют смысла для git-статуса (сборка, зависимости,
 * окружения, кэши, логи env-tools). Сравнение идёт по сегментам пути — `build` внутри
 * `src/build-tools/` не отфильтруется, а `src/build/` — да.
 */
export const IGNORED_WORKING_TREE_DIRS = new Set([
  'node_modules',
  'bower_components',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'out',
  'release',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.angular',
  'venv',
  '.venv',
  'env',
  '.env-state',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle',
  '.rag-index',
  '.tmp',
  'tmp',
  '.cache',
  '.idea',
  '.vs',
  '.worktrees',
  'Binaries',
  'Intermediate',
  'DerivedDataCache',
  'Saved'
]);

const IGNORED_FILE_SUFFIXES = ['.log', '.tmp', '.swp', '.swo', '~'];

/**
 * Предикат `ignored` для вотчера рабочего дерева. `filePath` — абсолютный путь от chokidar,
 * `projectRoot` — нормализованный корень проекта. Сам корень никогда не игнорируется.
 */
export function isIgnoredWorkingTreePath(projectRoot: string, filePath: string): boolean {
  const rel = path.relative(projectRoot, filePath);
  if (!rel || rel === '.') return false;
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  for (const seg of segments) {
    if (IGNORED_WORKING_TREE_DIRS.has(seg)) return true;
  }
  const last = segments[segments.length - 1] || '';
  return IGNORED_FILE_SUFFIXES.some((suffix) => last.endsWith(suffix));
}

interface ProjectWatch {
  /** Путь проекта в исходном регистре — уходит в рендерер в событии `git:changed`. */
  projectPath: string;
  gitWatcher: FSWatcher;
  treeWatcher: FSWatcher | null;
  debounceTimer: NodeJS.Timeout | null;
  /** Момент первого события в текущей серии — для ограничения максимального ожидания. */
  firstEventAt: number;
  /** Была ли в серии «жёсткая» причина (изменение .git/HEAD|index|refs или git-операция из UI). */
  hardChange: boolean;
  /** Снимок `git status --porcelain --branch`, чтобы не дёргать рендерер без изменений. */
  lastStatusSnapshot: string | null;
  /** Уже выполняется проверка статуса — новые события ставят флаг повторного прогона. */
  checking: boolean;
  rerunAfterCheck: boolean;
}

class GitService {
  private watches = new Map<string, ProjectWatch>();

  /** Таймеры дебаунса для проектов без вотчера (git-операции из UI на невотченном проекте). */
  private looseTimers = new Map<string, NodeJS.Timeout>();

  private keyOf(projectPath: string): string {
    const normalized = path.normalize(projectPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  private gitChangedListeners = new Set<(projectPath: string) => void>();

  /**
   * Подписка main-процесса на `git:changed` (тот же момент, когда уведомляется рендерер).
   * Используется для сброса кэша осмотра проекта (TASK-44): изменения рабочего дерева не
   * видны по mtime служебных файлов git. Возвращает функцию отписки.
   */
  onGitChanged(listener: (projectPath: string) => void): () => void {
    this.gitChangedListeners.add(listener);
    return () => {
      this.gitChangedListeners.delete(listener);
    };
  }

  private emitGitChanged(projectPath: string) {
    for (const listener of this.gitChangedListeners) {
      try {
        listener(projectPath);
      } catch (err) {
        console.error('[GitService] git:changed listener failed:', err);
      }
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('git:changed', { projectPath });
      }
    }
  }

  /**
   * Планирует отправку `git:changed`. `hard = true` — изменение внутри `.git` или git-операция
   * из UI: рендерер уведомляется после дебаунса без проверки. `hard = false` — событие
   * рабочего дерева: после дебаунса выполняется `git status --porcelain --branch`, и событие
   * уходит только если снимок статуса изменился (правки в игнорируемых git файлах и повторные
   * сохранения уже изменённого файла не создают шторм из шести git-команд в рендерере).
   */
  private broadcastGitChanged(projectPath: string, hard = true) {
    const key = this.keyOf(projectPath);
    const watch = this.watches.get(key);
    if (!watch) {
      const existing = this.looseTimers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.looseTimers.delete(key);
        this.emitGitChanged(path.normalize(projectPath));
      }, GIT_CHANGED_DEBOUNCE_MS);
      timer.unref?.();
      this.looseTimers.set(key, timer);
      return;
    }

    watch.hardChange = watch.hardChange || hard;
    const now = Date.now();
    if (!watch.debounceTimer) {
      watch.firstEventAt = now;
    }
    const busy = processManager.hasRunningProcess(watch.projectPath);
    let delay = busy ? GIT_CHANGED_BUSY_DEBOUNCE_MS : GIT_CHANGED_DEBOUNCE_MS;
    // Непрерывный поток событий (dev-сервер пишет постоянно) не должен откладывать обновление бесконечно.
    const remainingMaxWait = watch.firstEventAt + GIT_CHANGED_MAX_WAIT_MS - now;
    delay = Math.max(0, Math.min(delay, remainingMaxWait));

    if (watch.debounceTimer) clearTimeout(watch.debounceTimer);
    const timer = setTimeout(() => {
      watch.debounceTimer = null;
      void this.flushGitChanged(key, watch);
    }, delay);
    timer.unref?.();
    watch.debounceTimer = timer;
  }

  private async flushGitChanged(key: string, watch: ProjectWatch) {
    if (watch.checking) {
      watch.rerunAfterCheck = true;
      return;
    }
    const hard = watch.hardChange;
    watch.hardChange = false;
    watch.checking = true;
    try {
      const snapshot = await this.readStatusSnapshot(watch.projectPath);
      const changed = snapshot === null || snapshot !== watch.lastStatusSnapshot;
      if (snapshot !== null) watch.lastStatusSnapshot = snapshot;
      // Вотчер могли закрыть, пока шёл git status — тогда рендерер уже не ждёт событий.
      if (this.watches.get(key) !== watch) return;
      if (hard || changed) {
        this.emitGitChanged(watch.projectPath);
      }
    } finally {
      watch.checking = false;
      if (watch.rerunAfterCheck && this.watches.get(key) === watch) {
        watch.rerunAfterCheck = false;
        this.broadcastGitChanged(watch.projectPath, false);
      }
    }
  }

  private async readStatusSnapshot(projectPath: string): Promise<string | null> {
    try {
      return await simpleGit(projectPath).raw(['status', '--porcelain', '--branch']);
    } catch {
      return null;
    }
  }

  watchProjectGit(projectPath: string) {
    const normalized = path.normalize(projectPath);
    const key = this.keyOf(normalized);
    if (this.watches.has(key)) return;

    const gitDir = path.join(normalized, '.git');
    if (!existsSync(gitDir)) return;

    // Вотчер служебных файлов git: HEAD/index/refs/packed-refs — точные признаки коммита,
    // checkout, stage, fetch, тегов. Событий мало, глубина ограничена самим набором путей.
    const gitTargets = [
      path.join(gitDir, 'HEAD'),
      path.join(gitDir, 'index'),
      path.join(gitDir, 'packed-refs'),
      path.join(gitDir, 'refs')
    ].filter((p) => existsSync(p));

    const gitWatcher = chokidar.watch(gitTargets, {
      ignoreInitial: true,
      persistent: true,
      depth: 3
    });

    const watch: ProjectWatch = {
      projectPath: normalized,
      gitWatcher,
      treeWatcher: null,
      debounceTimer: null,
      firstEventAt: 0,
      hardChange: false,
      lastStatusSnapshot: null,
      checking: false,
      rerunAfterCheck: false
    };

    // .git/index переписывает и сам git status (обновление stat-кэша), поэтому его события
    // идут через гейт по статусу как «мягкие»; HEAD/refs/packed-refs — всегда жёсткие.
    const indexPath = path.join(gitDir, 'index');
    gitWatcher.on('all', (_event, changedPath) => {
      const isIndex = path.normalize(changedPath) === indexPath;
      this.broadcastGitChanged(normalized, !isIndex);
    });
    gitWatcher.on('error', (err) => console.warn(`[Git] watcher error for ${normalized}/.git:`, err));

    // Вотчер рабочего дерева: нужен, чтобы статус обновлялся при правке файлов во внешнем
    // редакторе. Каталоги сборки/зависимостей/окружений отсечены предикатом (не обходятся вовсе),
    // а события идут через гейт по `git status`, поэтому шторма git-команд в рендерере нет.
    const treeWatcher = chokidar.watch(normalized, {
      ignoreInitial: true,
      persistent: true,
      depth: 3,
      ignored: (filePath: string) => isIgnoredWorkingTreePath(normalized, filePath)
    });
    treeWatcher.on('all', () => this.broadcastGitChanged(normalized, false));
    treeWatcher.on('error', (err) => console.warn(`[Git] watcher error for ${normalized}:`, err));
    watch.treeWatcher = treeWatcher;

    this.watches.set(key, watch);

    // Начальный снимок статуса, чтобы первое же событие рабочего дерева сравнивалось с реальностью.
    void this.readStatusSnapshot(normalized).then((snapshot) => {
      if (this.watches.get(key) === watch && watch.lastStatusSnapshot === null) {
        watch.lastStatusSnapshot = snapshot;
      }
    });
  }

  unwatchProjectGit(projectPath: string) {
    const key = this.keyOf(projectPath);
    const watch = this.watches.get(key);
    if (watch) {
      this.watches.delete(key);
      if (watch.debounceTimer) {
        clearTimeout(watch.debounceTimer);
        watch.debounceTimer = null;
      }
      watch.gitWatcher.close().catch(() => {});
      watch.treeWatcher?.close().catch(() => {});
    }
    const loose = this.looseTimers.get(key);
    if (loose) {
      clearTimeout(loose);
      this.looseTimers.delete(key);
    }
  }

  /** Нормализованные пути проектов с активными вотчерами (для проверок и тестов). */
  getWatchedProjects(): string[] {
    return Array.from(this.watches.values()).map((w) => w.projectPath);
  }

  /** Число проектов с активными вотчерами. */
  getWatcherCount(): number {
    return this.watches.size;
  }

  cleanupAll() {
    for (const key of Array.from(this.watches.keys())) {
      const watch = this.watches.get(key)!;
      try {
        this.unwatchProjectGit(watch.projectPath);
      } catch {}
    }
    this.watches.clear();
    for (const timer of this.looseTimers.values()) {
      clearTimeout(timer);
    }
    this.looseTimers.clear();
  }

  async getRepoDetails(projectPath: string): Promise<GitRepoDetails | null> {
    const gitDir = path.join(projectPath, '.git');
    if (!existsSync(gitDir)) return null;

    try {
      const git = simpleGit(projectPath);
      this.watchProjectGit(projectPath);

      const [status, branches, log, tags, stashes] = await Promise.all([
        git.status(),
        git.branchLocal(),
        git.log({ maxCount: 50 }),
        git.tags(),
        git.stashList()
      ]);

      const branchSummary = await git.branch(['-a']);

      const localBranches = branches.all;
      const remoteBranches = branchSummary.all.filter((b) => b.startsWith('remotes/'));

      const files: GitFileStatus[] = [
        ...status.created.map((p) => ({ path: p, index: 'A', working_dir: ' ', staged: true })),
        ...status.modified.map((p) => ({ path: p, index: 'M', working_dir: 'M', staged: status.staged.includes(p) })),
        ...status.deleted.map((p) => ({ path: p, index: 'D', working_dir: 'D', staged: status.staged.includes(p) })),
        ...status.not_added.map((p) => ({ path: p, index: '?', working_dir: '?', staged: false })),
        ...status.renamed.map((r) => ({ path: r.to, index: 'R', working_dir: ' ', staged: true }))
      ];

      // Deduplicate files by path
      const fileMap = new Map<string, GitFileStatus>();
      for (const f of files) {
        fileMap.set(f.path, f);
      }

      const commits: GitCommit[] = log.all.map((c) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author_name: c.author_name,
        author_email: c.author_email
      }));

      return {
        currentBranch: status.current || 'HEAD',
        branches: localBranches,
        remoteBranches,
        commits,
        files: Array.from(fileMap.values()),
        stashes: stashes.all.map((s) => s.message),
        tags: tags.all,
        isClean: status.isClean()
      };
    } catch (err) {
      console.error(`Failed to get git details for ${projectPath}:`, err);
      return null;
    }
  }

  async checkoutBranch(projectPath: string, branchName: string, createNew = false): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      if (createNew) {
        await git.checkoutLocalBranch(branchName);
      } else {
        await git.checkout(branchName);
      }
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to checkout ${branchName}:`, e);
      return false;
    }
  }

  async createBranch(projectPath: string, branchName: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.checkoutLocalBranch(branchName);
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to create branch ${branchName}:`, e);
      return false;
    }
  }

  async stageFile(projectPath: string, filePath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.add(filePath);
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to stage ${filePath}:`, e);
      return false;
    }
  }

  async unstageFile(projectPath: string, filePath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.reset(['HEAD', filePath]);
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to unstage ${filePath}:`, e);
      return false;
    }
  }

  async stageAll(projectPath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.add('.');
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error('Failed to stage all:', e);
      return false;
    }
  }

  async commitChanges(projectPath: string, message: string, stageAll = false): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      if (stageAll) {
        await git.add('.');
      }
      await git.commit(message);
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error('Failed to commit:', e);
      return false;
    }
  }

  async deleteBranch(projectPath: string, branchName: string, force = false): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.deleteLocalBranch(branchName, force);
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to delete branch ${branchName}:`, e);
      return false;
    }
  }

  async mergeBranch(projectPath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(projectPath);
      await git.merge([branchName]);
      this.broadcastGitChanged(projectPath);
      return { success: true };
    } catch (e: any) {
      console.error(`Failed to merge ${branchName}:`, e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async fetchRemote(projectPath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.fetch();
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to fetch remotes for ${projectPath}:`, e);
      return false;
    }
  }

  async pullRemote(projectPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(projectPath);
      await git.pull();
      this.broadcastGitChanged(projectPath);
      return { success: true };
    } catch (e: any) {
      console.error(`Failed to pull for ${projectPath}:`, e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async pushRemote(projectPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(projectPath);
      await git.push();
      this.broadcastGitChanged(projectPath);
      return { success: true };
    } catch (e: any) {
      console.error(`Failed to push for ${projectPath}:`, e);
      return { success: false, error: e?.message || String(e) };
    }
  }

  async discardFileChanges(projectPath: string, filePath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      // Unstage if staged
      try {
        await git.reset(['HEAD', filePath]);
      } catch {}
      // Discard checkout changes
      try {
        await git.checkout(['--', filePath]);
      } catch {
        // If untracked file, remove it
        const full = path.join(projectPath, filePath);
        if (existsSync(full)) {
          await fs.rm(full, { force: true, recursive: true });
        }
      }
      this.broadcastGitChanged(projectPath);
      return true;
    } catch (e) {
      console.error(`Failed to discard changes for ${filePath}:`, e);
      return false;
    }
  }

  async getDiffBetween(projectPath: string, targetA: string, targetB?: string, filePath?: string): Promise<string> {
    try {
      const git = simpleGit(projectPath);
      const args: string[] = [];
      if (targetB) {
        args.push(`${targetA}..${targetB}`);
      } else {
        args.push(targetA);
      }
      if (filePath) {
        args.push('--', filePath);
      }
      return await git.diff(args);
    } catch (e) {
      console.error(`Failed to get diff between ${targetA} and ${targetB}:`, e);
      return '';
    }
  }

  async getFileDiff(projectPath: string, filePath: string, staged = false): Promise<string> {
    try {
      const git = simpleGit(projectPath);
      if (staged) {
        return await git.diff(['--cached', filePath]);
      }
      return await git.diff([filePath]);
    } catch (e) {
      console.error(`Failed to get diff for ${filePath}:`, e);
      return '';
    }
  }

  async getLog(projectPath: string, maxCount = 30): Promise<GitCommit[]> {
    try {
      if (!existsSync(path.join(projectPath, '.git'))) return [];
      const git = simpleGit(projectPath);
      const log = await git.log({ maxCount });
      return log.all.map((c) => ({
        hash: c.hash,
        date: c.date,
        message: c.message,
        author_name: c.author_name,
        author_email: c.author_email
      }));
    } catch (e) {
      console.error(`Git log error for ${projectPath}:`, e);
      return [];
    }
  }

  async getStatus(projectPath: string): Promise<any> {
    try {
      if (!existsSync(path.join(projectPath, '.git'))) return null;
      const git = simpleGit(projectPath);
      return await git.status();
    } catch (e) {
      console.error(`Git status error for ${projectPath}:`, e);
      return null;
    }
  }
}

export const gitService = new GitService();
