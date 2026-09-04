import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import type { GitCommit, GitFileStatus, GitRepoDetails } from '../../src/types/electron';

class GitService {
  private watchers = new Map<string, FSWatcher>();

  private debounceTimers = new Map<string, NodeJS.Timeout>();

  private broadcastGitChanged(projectPath: string) {
    const existing = this.debounceTimers.get(projectPath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectPath);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('git:changed', { projectPath });
        }
      }
    }, 400);

    this.debounceTimers.set(projectPath, timer);
  }

  watchProjectGit(projectPath: string) {
    const normalized = path.normalize(projectPath);
    if (this.watchers.has(normalized)) return;

    const gitDir = path.join(normalized, '.git');
    if (!existsSync(gitDir)) return;

    // Watch key git refs and files, plus top-level project changes (native OS events, zero polling)
    const watchTargets = [
      path.join(gitDir, 'HEAD'),
      path.join(gitDir, 'index'),
      path.join(gitDir, 'refs'),
      normalized
    ];

    const watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      // Efficient path filter for Windows avoiding recursive scanning into node_modules & builds
      ignored: (filePath: string) => {
        const norm = filePath.replace(/\\/g, '/');
        // Allow .git/HEAD, .git/index, .git/refs
        if (norm.includes('/.git/')) {
          return !norm.includes('/.git/HEAD') && !norm.includes('/.git/index') && !norm.includes('/.git/refs');
        }
        return (
          norm.includes('/node_modules') ||
          norm.includes('/dist') ||
          norm.includes('/dist-electron') ||
          norm.includes('/release') ||
          norm.includes('/.rag-index') ||
          norm.includes('/.venv') ||
          norm.includes('/.tmp') ||
          norm.includes('/.cache')
        );
      },
      // Native OS events, no continuous pollInterval
      persistent: true,
      depth: 3
    });

    watcher.on('all', () => {
      this.broadcastGitChanged(normalized);
    });

    this.watchers.set(normalized, watcher);
  }

  unwatchProjectGit(projectPath: string) {
    const normalized = path.normalize(projectPath);
    const watcher = this.watchers.get(normalized);
    if (watcher) {
      watcher.close().catch(() => {});
      this.watchers.delete(normalized);
    }
    const timer = this.debounceTimers.get(normalized);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(normalized);
    }
  }

  cleanupAll() {
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close().catch(() => {});
      } catch {}
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
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
}

export const gitService = new GitService();
