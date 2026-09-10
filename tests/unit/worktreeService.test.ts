import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {
  parseWorktreeListPorcelain,
  extractTaskId,
  WorktreeService
} from '../../electron/services/worktreeService';

describe('worktreeService unit tests', () => {
  describe('extractTaskId', () => {
    it('извлекает id задачи из имени ветки или пути', () => {
      expect(extractTaskId('task/task-53')).toBe('task-53');
      expect(extractTaskId('task-54-swarm-agent')).toBe('task-54');
      expect(extractTaskId('.worktrees/task-12')).toBe('task-12');
      expect(extractTaskId('TASK-42')).toBe('task-42');
      expect(extractTaskId('feature_task-9_ui')).toBe('task-9');
      expect(extractTaskId('main')).toBeUndefined();
      expect(extractTaskId('feature/login-page')).toBeUndefined();
    });
  });

  describe('parseWorktreeListPorcelain', () => {
    it('корректно парсит стандартный вывод git worktree list --porcelain', () => {
      const rawOutput = `worktree F:/ProjectHub
HEAD 40ad62cb8d1378b3197e8377ea0a389e556ae61b
branch refs/heads/master

worktree F:/ProjectHub/.worktrees/task-53
HEAD a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e
branch refs/heads/task/task-53

worktree F:/ProjectHub/.worktrees/experiment
HEAD 1234567890abcdef1234567890abcdef12345678
detached
locked reason for lock

worktree F:/ProjectHub/.worktrees/old-tree
HEAD deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
branch refs/heads/fix/bug
prunable gitdir file points to non-existent location
`;

      const list = parseWorktreeListPorcelain(rawOutput, 'F:/ProjectHub');

      expect(list).toHaveLength(4);

      // Main worktree
      expect(list[0].isMain).toBe(true);
      expect(list[0].branch).toBe('master');
      expect(list[0].isDetached).toBe(false);

      // task-53 worktree
      expect(list[1].isMain).toBe(false);
      expect(list[1].branch).toBe('task/task-53');
      expect(list[1].taskId).toBe('task-53');
      expect(list[1].isDetached).toBe(false);

      // Detached & locked worktree
      expect(list[2].isDetached).toBe(true);
      expect(list[2].isLocked).toBe(true);
      expect(list[2].lockReason).toBe('reason for lock');

      // Prunable worktree
      expect(list[3].isPrunable).toBe(true);
      expect(list[3].pruneReason).toContain('gitdir file points');
    });

    it('корректно обрабатывает пустой ввод', () => {
      const list = parseWorktreeListPorcelain('', 'F:/ProjectHub');
      expect(list).toEqual([]);
    });
  });

  describe('ensureWorktreeIgnored (AC #7)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-wt-test-'));
    });

    afterEach(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('создает .gitignore с .worktrees/, если файла не было', async () => {
      const svc = new WorktreeService();
      const updated = await svc.ensureWorktreeIgnored(tmpDir);
      expect(updated).toBe(true);

      const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).toContain('.worktrees/');
    });

    it('добавляет .worktrees/ в существующий .gitignore, если его там нет', async () => {
      const gitignore = path.join(tmpDir, '.gitignore');
      await fs.writeFile(gitignore, 'node_modules/\ndist/\n', 'utf-8');

      const svc = new WorktreeService();
      const updated = await svc.ensureWorktreeIgnored(tmpDir);
      expect(updated).toBe(true);

      const content = await fs.readFile(gitignore, 'utf-8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('.worktrees/');
    });

    it('не дублирует запись, если .worktrees/ уже есть в .gitignore', async () => {
      const gitignore = path.join(tmpDir, '.gitignore');
      await fs.writeFile(gitignore, 'node_modules/\n.worktrees/\ndist/\n', 'utf-8');

      const svc = new WorktreeService();
      const updated = await svc.ensureWorktreeIgnored(tmpDir);
      expect(updated).toBe(false);

      const content = await fs.readFile(gitignore, 'utf-8');
      const matches = content.match(/\.worktrees/g);
      expect(matches).toHaveLength(1);
    });
  });
});
