import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import type { GitWorktreeInfo, AddWorktreeOptions } from '../../src/types/electron';

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
   * Получение диффа между веткой worktree и базовой веткой проекта (AC #6).
   */
  async getWorktreeDiff(projectPath: string, worktreeBranch: string, baseBranch: string): Promise<string> {
    try {
      const git = simpleGit(projectPath);
      return await git.diff([`${baseBranch}...${worktreeBranch}`]);
    } catch (err) {
      console.error(`[WorktreeService] Failed to get diff between ${baseBranch} and ${worktreeBranch}:`, err);
      return '';
    }
  }

  /**
   * Слияние ветки worktree в целевую ветку проекта (AC #6).
   */
  async mergeWorktree(
    projectPath: string,
    worktreeBranch: string,
    targetBranch: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const git = simpleGit(projectPath);
      // Проверяем текущую ветку основного дерева
      const status = await git.status();
      const originalBranch = status.current;

      if (originalBranch !== targetBranch) {
        await git.checkout(targetBranch);
      }

      await git.raw(['merge', '--no-ff', worktreeBranch, '-m', `Merge branch '${worktreeBranch}' into ${targetBranch}`]);

      return { success: true };
    } catch (err: any) {
      console.error(`[WorktreeService] Failed to merge ${worktreeBranch} into ${targetBranch}:`, err);
      return { success: false, error: err?.message || String(err) };
    }
  }
}

export const worktreeService = new WorktreeService();
