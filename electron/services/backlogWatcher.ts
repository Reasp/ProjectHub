import path from 'node:path';
import { existsSync } from 'node:fs';
import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';

class BacklogWatcher {
  private watcher: FSWatcher | null = null;
  private currentPath: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

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
  }

  unwatch() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.currentPath = null;
  }
}

export const backlogWatcher = new BacklogWatcher();
