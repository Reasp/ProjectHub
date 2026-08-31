import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import type { GitCommit, GitFileStatus, GitRepoDetails } from '../../src/types/electron';

class GitService {
  private watchers = new Map<string, FSWatcher>();

  private broadcastGitChanged(projectPath: string) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('git:changed', { projectPath });
      }
    }
  }

  watchProjectGit(projectPath: string) {
    const normalized = path.normalize(projectPath);
    if (this.watchers.has(normalized)) return;

    const gitDir = path.join(normalized, '.git');
    if (!existsSync(gitDir)) return;

    const watchTargets = [
      path.join(gitDir, 'HEAD'),
      path.join(gitDir, 'index'),
      path.join(gitDir, 'refs')
    ];

    const watcher = chokidar.watch(watchTargets, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    });

    watcher.on('all', () => {
      this.broadcastGitChanged(normalized);
    });

    this.watchers.set(normalized, watcher);
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
