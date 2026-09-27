import path from 'node:path';
import { existsSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';

class BacklogWatcher {
  private watcher: FSWatcher | null = null;
  private currentPath: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private projectListeners = new Set<(projectPath: string | null) => void>();

  /** Открытый проект, за задачами которого следит окно. */
  currentProject(): string | null {
    return this.currentPath;
  }

  /**
   * Смена открытого проекта — для источника событий задач Automations (TASK-74): встроенное правило
   * назначенных задач наблюдает открытый проект, как раньше наблюдал этот вотчер.
   */
  onProjectChange(listener: (projectPath: string | null) => void): () => void {
    this.projectListeners.add(listener);
    return () => this.projectListeners.delete(listener);
  }

  private emitProjectChange(): void {
    for (const listener of this.projectListeners) listener(this.currentPath);
  }

  watch(projectPath: string, win: BrowserWindow | null) {
    if (this.currentPath === projectPath && this.watcher) {
      return;
    }

    this.unwatch();

    const tasksDir = path.join(projectPath, 'backlog', 'tasks');
    if (!existsSync(tasksDir)) {
      return;
    }

    this.currentPath = projectPath;
    this.watcher = chokidar.watch(tasksDir, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      }
    });

    const notify = (event: string, filePath: string) => {
      if (!win || win.isDestroyed()) return;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.webContents.send('backlog:tasksChanged', {
          projectPath,
          event,
          filePath
        });
      }, 100);
    };

    this.watcher.on('add', (fp) => notify('add', fp));
    this.watcher.on('change', (fp) => notify('change', fp));
    this.watcher.on('unlink', (fp) => notify('unlink', fp));
    this.emitProjectChange();
  }

  unwatch() {
    const hadProject = this.currentPath !== null;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.currentPath = null;
    if (hadProject) this.emitProjectChange();
  }
}

export const backlogWatcher = new BacklogWatcher();
