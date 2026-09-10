import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import type {
  GitWorktreeInfo,
  AddWorktreeOptions,
  MergeWorktreeResult,
  OrphanedWorktreeScan,
  CleanOrphanedResult
} from '../../src/types/electron';

/**
 * Нормализация пути для сравнения (учитывая особенности Windows).
 */
function normalizePath(p: string): string {
  const norm = path.resolve(p);
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

/**
 * Извлечение ID задачи (task-N) из имени ветки или пути.
 */
export function extractTaskId(branchOrPath: string): string | undefined {
  const match = branchOrPath.match(/(?:^|[\\/_-])(task-\d+)(?:[\\/_-]|$)/i);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Парсинг вывода `git worktree list --porcelain`.
 * Чистая функция для удобного unit-тестирования.
 */
export function parseWorktreeListPorcelain(raw: string, mainProjectPath: string): GitWorktreeInfo[] {
  const entries: GitWorktreeInfo[] = [];
  const blocks = raw.trim().split(/\r?\n\r?\n/);
  const normMain = normalizePath(mainProjectPath);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);

    let worktreePath = '';
    let head = '';
    let branch: string | null = null;
    let isDetached = false;
    let isLocked = false;
    let lockReason: string | undefined;
    let isPrunable = false;
    let pruneReason: string | undefined;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.substring('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        const fullRef = line.substring('branch '.length).trim();
        branch = fullRef.replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        isDetached = true;
      } else if (line.startsWith('locked')) {
        isLocked = true;
        const rest = line.substring('locked'.length).trim();
        if (rest) lockReason = rest;
      } else if (line.startsWith('prunable')) {
        isPrunable = true;
        const rest = line.substring('prunable'.length).trim();
        if (rest) pruneReason = rest;
      }
    }

    if (!worktreePath) continue;

    const normPath = normalizePath(worktreePath);
    const isMain = normPath === normMain;
    const taskId = branch ? extractTaskId(branch) || extractTaskId(worktreePath) : extractTaskId(worktreePath);

    entries.push({
      path: path.normalize(worktreePath),
      head,
      branch,
      isDetached,
      isLocked,
      lockReason,
      isPrunable,
      pruneReason,
      isMain,
      taskId
    });
  }

  return entries;
}

export class WorktreeService {
  protected getGit(projectPath: string) {
    return simpleGit(projectPath);
  }

  /**
   * Проверка и гарантированное добавление `.worktrees/` в `.gitignore` проекта (AC #7).
   */
  async ensureWorktreeIgnored(projectPath: string): Promise<boolean> {
    const gitignorePath = path.join(projectPath, '.gitignore');
    try {
      if (existsSync(gitignorePath)) {
        const content = await fs.readFile(gitignorePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const hasWorktrees = lines.some((l) => {
          const t = l.trim();
          return t === '.worktrees' || t === '.worktrees/' || t === '/.worktrees' || t === '/.worktrees/';
        });

        if (!hasWorktrees) {
          const suffix = content.endsWith('\n') ? '' : '\n';
          const addition = `${suffix}# Git Worktrees (isolated task directories)\n.worktrees/\n`;
          await fs.appendFile(gitignorePath, addition, 'utf-8');
          return true;
        }
      } else {
        const initial = `# Git Worktrees (isolated task directories)\n.worktrees/\n`;
        await fs.writeFile(gitignorePath, initial, 'utf-8');
        return true;
      }
    } catch (err) {
      console.warn(`[WorktreeService] Failed to update .gitignore in ${projectPath}:`, err);
    }
    return false;
  }

  /**
   * Список всех активных worktrees проекта.
   */
  async listWorktrees(projectPath: string): Promise<GitWorktreeInfo[]> {
    try {
      const git = simpleGit(projectPath);
      const raw = await git.raw(['worktree', 'list', '--porcelain']);
      return parseWorktreeListPorcelain(raw, projectPath);
    } catch (err) {
      console.error(`[WorktreeService] Failed to list worktrees for ${projectPath}:`, err);
      return [];
    }
  }

  /**
   * Создание нового worktree для задачи или ветки (AC #1, AC #4, AC #7).
   */
  async addWorktree(projectPath: string, options: AddWorktreeOptions): Promise<GitWorktreeInfo> {
    const git = simpleGit(projectPath);

    // Гарантируем добавление в .gitignore
    await this.ensureWorktreeIgnored(projectPath);

    // Определяем имя папки
    const folderSlug = options.branch.replace(/[^a-zA-Z0-9._-]/g, '-');
    const targetDir = options.customPath
      ? path.resolve(projectPath, options.customPath)
      : path.join(projectPath, '.worktrees', folderSlug);

    // Создаем родительский каталог .worktrees при необходимости
    const parentDir = path.dirname(targetDir);
    if (!existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    const args: string[] = ['worktree', 'add'];

    if (options.newBranch) {
      args.push('-b', options.branch, targetDir);
      if (options.baseCommitOrBranch) {
        args.push(options.baseCommitOrBranch);
      }
    } else {
      args.push(targetDir, options.branch);
    }

    await git.raw(args);

    // Получаем обновленный список и возвращаем созданное дерево
    const worktrees = await this.listWorktrees(projectPath);
    const created = worktrees.find((w) => normalizePath(w.path) === normalizePath(targetDir));

    if (!created) {
      return {
        path: targetDir,
        head: '',
        branch: options.branch,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
        isMain: false,
        taskId: extractTaskId(options.branch) || extractTaskId(targetDir)
      };
    }

    return created;
  }

  /**
   * Удаление worktree (AC #1).
   */
  async removeWorktree(projectPath: string, worktreePath: string, force = false): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      const args = ['worktree', 'remove', worktreePath];
      if (force) {
        args.push('--force');
      }
      await git.raw(args);
      return true;
    } catch (err) {
      console.error(`[WorktreeService] Failed to remove worktree ${worktreePath}:`, err);
      // Если git worktree remove не смог удалить из-за заблокированных/неотслеживаемых файлов,
      // пробуем удалить физически и выполнить prune
      if (force && existsSync(worktreePath)) {
        try {
          await fs.rm(worktreePath, { recursive: true, force: true });
          await this.pruneWorktrees(projectPath);
          return true;
        } catch (rmErr) {
          console.error(`[WorktreeService] Fallback rm failed for ${worktreePath}:`, rmErr);
        }
      }
      return false;
    }
  }

  /**
   * Очистка записей об удаленных/невалидных worktrees (AC #1).
   */
  async pruneWorktrees(projectPath: string): Promise<boolean> {
    try {
      const git = simpleGit(projectPath);
      await git.raw(['worktree', 'prune']);
      return true;
    } catch (err) {
      console.error(`[WorktreeService] Failed to prune worktrees for ${projectPath}:`, err);
      return false;
    }
  }

  /**
   * Получение диффа между веткой worktree и базовой веткой проекта (AC #2, AC #7).
   * Считается внутри рабочей директории worktree с учетом untracked-файлов (git add -N).
   */
  async getWorktreeDiff(
    projectPath: string,
    worktreeBranch: string,
    baseBranch: string,
    worktreePath?: string
  ): Promise<string> {
    try {
      let targetWtPath = worktreePath;
      if (!targetWtPath) {
        const wts = await this.listWorktrees(projectPath);
        const match = wts.find((w) => w.branch === worktreeBranch);
        if (match && !match.isMain) {
          targetWtPath = match.path;
        }
      }

      if (targetWtPath && existsSync(targetWtPath)) {
        try {
          const wtGit = simpleGit(targetWtPath);
          try {
            await wtGit.raw(['add', '-N', '.']);
          } catch {
            // Игнорируем если нечего добавлять или временные коллизии
          }
          const diffOutput = await wtGit.diff([baseBranch]);
          if (diffOutput && diffOutput.trim()) {
            return diffOutput;
          }
        } catch (wtErr) {
          console.warn(`[WorktreeService] Internal worktree diff failed for ${targetWtPath}:`, wtErr);
        }
      }

      // Fallback на расчет через основной репозиторий (для коммитов)
      const git = simpleGit(projectPath);
      return await git.diff([`${baseBranch}...${worktreeBranch}`]);
    } catch (err) {
      console.error(`[WorktreeService] Failed to get diff between ${baseBranch} and ${worktreeBranch}:`, err);
      return '';
    }
  }

  /**
   * Безопасное слияние ветки worktree в целевую ветку проекта (AC #3, AC #7).
   * Проверяет чистоту дерева, использует merge --no-commit, при конфликте выполняет abort
   * и восстанавливает исходную ветку.
   */
  async mergeWorktree(
    projectPath: string,
    worktreeBranch: string,
    targetBranch: string
  ): Promise<MergeWorktreeResult> {
    const git = this.getGit(projectPath);
    let originalBranch: string | null = null;
    let switchedBranch = false;

    try {
      const status = await git.status();
      originalBranch = status.current;

      // Проверяем чистоту основного дерева перед слиянием
      if (!status.isClean()) {
        return {
          success: false,
          uncleanWorkingTree: true,
          error: 'Working tree has uncommitted changes. Please commit or stash changes before merging.'
        };
      }

      if (originalBranch !== targetBranch) {
        await git.checkout(targetBranch);
        switchedBranch = true;
      }

      try {
        await git.raw(['merge', '--no-ff', '--no-commit', worktreeBranch]);
        await git.raw(['commit', '-m', `Merge branch '${worktreeBranch}' into ${targetBranch}`]);
        return { success: true };
      } catch (mergeErr: any) {
        const conflictStatus = await git.status();
        const conflictedFiles = conflictStatus.conflicted || [];

        try {
          await git.raw(['merge', '--abort']);
        } catch (abortErr) {
          console.warn('[WorktreeService] merge --abort failed:', abortErr);
        }

        if (switchedBranch && originalBranch) {
          try {
            await git.checkout(originalBranch);
          } catch (checkoutErr) {
            console.warn(`[WorktreeService] Failed to restore branch ${originalBranch}:`, checkoutErr);
          }
        }

        const conflictMsg = conflictedFiles.length > 0
          ? `Merge conflict in: ${conflictedFiles.join(', ')}`
          : (mergeErr?.message || String(mergeErr));

        return {
          success: false,
          wasAborted: true,
          conflictedFiles,
          error: conflictMsg
        };
      }
    } catch (err: any) {
      console.error(`[WorktreeService] Failed to merge ${worktreeBranch} into ${targetBranch}:`, err);
      if (switchedBranch && originalBranch) {
        try {
          await git.checkout(originalBranch);
        } catch {}
      }
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Частичное принятие файлов из ветки worktree в текущее рабочее дерево (AC #5).
   */
  async checkoutFilesFromBranch(
    projectPath: string,
    branch: string,
    filePaths: string[]
  ): Promise<{ success: boolean; error?: string; files?: string[] }> {
    try {
      if (!filePaths || filePaths.length === 0) {
        return { success: true, files: [] };
      }
      const git = this.getGit(projectPath);
      await git.raw(['checkout', branch, '--', ...filePaths]);
      return { success: true, files: filePaths };
    } catch (err: any) {
      console.error(`[WorktreeService] Failed to checkout files from ${branch}:`, err);
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * Поиск осиротевших worktrees и веток swarm/handoff/task (AC #6).
   */
  async findOrphanedWorktreesAndBranches(
    projectPath: string,
    activeTaskIds: string[] = [],
    activeSwarmIds: string[] = []
  ): Promise<OrphanedWorktreeScan> {
    const orphanedPaths: string[] = [];
    const orphanedBranches: string[] = [];
    let allWorktrees: GitWorktreeInfo[] = [];

    try {
      const git = this.getGit(projectPath);
      allWorktrees = await this.listWorktrees(projectPath);
      const lowerActiveTasks = new Set(activeTaskIds.map((id) => id.toLowerCase()));
      const activeSwarms = new Set(activeSwarmIds);

      // 1. Проверяем физические каталоги в .worktrees/, которых нет в зарегистрированных worktrees
      const wtDir = path.join(projectPath, '.worktrees');
      if (existsSync(wtDir)) {
        try {
          const diskFolders = await fs.readdir(wtDir);
          const registeredPaths = new Set(allWorktrees.map((w) => normalizePath(w.path)));
          for (const folder of diskFolders) {
            const fullPath = path.join(wtDir, folder);
            if (!registeredPaths.has(normalizePath(fullPath))) {
              orphanedPaths.push(fullPath);
            }
          }
        } catch { /* ignore readdir error */ }
      }

      // 2. Проверяем зарегистрированные worktrees, чьи задачи или рои уже не активны
      for (const wt of allWorktrees) {
        if (wt.isMain) continue;

        const branch = wt.branch || '';
        const folderName = path.basename(wt.path);

        // Swarm worktrees
        if (branch.startsWith('swarm/') || folderName.startsWith('swarm-')) {
          const isAssociatedWithActiveSwarm = Array.from(activeSwarms).some(
            (sId) => branch.includes(sId) || folderName.includes(sId)
          );
          if (!isAssociatedWithActiveSwarm) {
            orphanedPaths.push(wt.path);
            continue;
          }
        }

        // Handoff worktrees
        if (branch.startsWith('handoff/') || folderName.startsWith('handoff-')) {
          const isAssociatedWithActiveSwarm = Array.from(activeSwarms).some(
            (sId) => branch.includes(sId) || folderName.includes(sId)
          );
          if (!isAssociatedWithActiveSwarm) {
            orphanedPaths.push(wt.path);
            continue;
          }
        }

        // Task worktrees
        if (wt.taskId) {
          if (!lowerActiveTasks.has(wt.taskId.toLowerCase())) {
            orphanedPaths.push(wt.path);
          }
        }
      }

      // 3. Сканируем локальные ветки
      const branchSummary = await git.branchLocal();
      const wtBranches = new Set(allWorktrees.map((w) => w.branch).filter(Boolean) as string[]);

      for (const b of branchSummary.all) {
        if (b === 'master' || b === 'main' || b === branchSummary.current) continue;

        if (b.startsWith('swarm/')) {
          const isAssociated = Array.from(activeSwarms).some((sId) => b.includes(sId));
          if (!isAssociated) {
            orphanedBranches.push(b);
            continue;
          }
        }

        if (b.startsWith('handoff/')) {
          const isAssociated = Array.from(activeSwarms).some((sId) => b.includes(sId));
          if (!isAssociated) {
            orphanedBranches.push(b);
            continue;
          }
        }

        if (b.startsWith('task/')) {
          const extractedId = extractTaskId(b);
          if (extractedId && !lowerActiveTasks.has(extractedId.toLowerCase())) {
            orphanedBranches.push(b);
          }
        }

        const taskMatch = extractTaskId(b);
        if (taskMatch) {
          // Если задача не активна и ветка не привязана к живому активному worktree
          if (!lowerActiveTasks.has(taskMatch.toLowerCase()) && !wtBranches.has(b)) {
            orphanedBranches.push(b);
          }
        }
      }
    } catch (err) {
      console.error(`[WorktreeService] Failed to find orphaned worktrees/branches for ${projectPath}:`, err);
    }

    return {
      orphanedWorktrees: allWorktrees.filter((w) => orphanedPaths.includes(w.path)),
      orphanedPaths: Array.from(new Set(orphanedPaths)),
      orphanedBranches: Array.from(new Set(orphanedBranches))
    };
  }

  /**
   * Удаление осиротевших worktrees и веток (AC #6).
   */
  async cleanOrphanedWorktreesAndBranches(
    projectPath: string,
    worktreePaths: string[],
    branches: string[]
  ): Promise<CleanOrphanedResult> {
    const removedWorktrees: string[] = [];
    const removedBranches: string[] = [];
    const errors: string[] = [];
    const git = this.getGit(projectPath);

    for (const wtPath of worktreePaths) {
      try {
        const ok = await this.removeWorktree(projectPath, wtPath, true);
        if (ok) {
          removedWorktrees.push(wtPath);
        } else {
          errors.push(`Failed to remove worktree ${wtPath}`);
        }
      } catch (err: any) {
        errors.push(`Error removing worktree ${wtPath}: ${err?.message || err}`);
      }
    }

    for (const b of branches) {
      try {
        await git.deleteLocalBranch(b, true);
        removedBranches.push(b);
      } catch (err: any) {
        errors.push(`Failed to delete branch ${b}: ${err?.message || err}`);
      }
    }

    try {
      await this.pruneWorktrees(projectPath);
    } catch { /* ignore */ }

    return { removedWorktrees, removedBranches, errors };
  }
}

export const worktreeService = new WorktreeService();
