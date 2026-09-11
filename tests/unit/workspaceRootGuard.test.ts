import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { isWorktreeGitDirOf, parseGitDirPointer } from '../../electron/services/pathGuard';

/**
 * Гарды рабочего дерева (TASK-62): IPC должен принимать не только корень проекта,
 * но и его git-worktree — и только его, а не любую подпапку.
 */

const tmpRoots: string[] = [];

/** Проект с worktree в `.worktrees/<name>`: `.git`-файл ссылается на `<project>/.git/worktrees/<name>`. */
function makeProjectWithWorktree(name = 'task-62') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-wt-guard-'));
  tmpRoots.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, '.git', 'worktrees', name), { recursive: true });

  const worktreePath = path.join(projectRoot, '.worktrees', name);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(
    path.join(worktreePath, '.git'),
    `gitdir: ${path.join(projectRoot, '.git', 'worktrees', name)}\n`,
    'utf-8'
  );

  // Обычная подпапка проекта — не рабочее дерево.
  const plainDir = path.join(projectRoot, 'src');
  fs.mkdirSync(plainDir, { recursive: true });

  // Подделка: `.git` указывает в чужой репозиторий.
  const fakeWorktree = path.join(projectRoot, '.worktrees', 'fake');
  fs.mkdirSync(fakeWorktree, { recursive: true });
  fs.writeFileSync(path.join(fakeWorktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n', 'utf-8');

  return { projectRoot, worktreePath, plainDir, fakeWorktree };
}

afterAll(() => {
  for (const dir of tmpRoots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* временные каталоги */
    }
  }
});

describe('parseGitDirPointer / isWorktreeGitDirOf', () => {
  it('читает указатель gitdir и игнорирует посторонний текст', () => {
    expect(parseGitDirPointer('gitdir: /home/u/proj/.git/worktrees/a\n')).toBe('/home/u/proj/.git/worktrees/a');
    expect(parseGitDirPointer('ref: refs/heads/master')).toBeNull();
    expect(parseGitDirPointer('')).toBeNull();
  });

  it('принимает только gitdir внутри .git/worktrees проекта', () => {
    const project = path.join('F:', 'proj');
    const wt = path.join(project, '.worktrees', 'task-62');
    expect(isWorktreeGitDirOf(project, wt, path.join(project, '.git', 'worktrees', 'task-62'))).toBe(true);
    // Относительный указатель разрешается от каталога дерева.
    expect(isWorktreeGitDirOf(project, wt, path.join('..', '..', '.git', 'worktrees', 'task-62'))).toBe(true);
    expect(isWorktreeGitDirOf(project, wt, path.join(project, '.git'))).toBe(false);
    expect(isWorktreeGitDirOf(project, wt, path.join('F:', 'other', '.git', 'worktrees', 'x'))).toBe(false);
    expect(isWorktreeGitDirOf(project, wt, '')).toBe(false);
  });
});

describe('assertWorkspaceRoot (реестр проектов)', () => {
  it('принимает корень проекта и его worktree, отклоняет подпапки и подделки', async () => {
    const { projectRoot, worktreePath, plainDir, fakeWorktree } = makeProjectWithWorktree();

    vi.resetModules();
    vi.doMock('../../electron/services/projectRegistry', () => ({
      projectRegistry: { getProjects: async () => [{ path: projectRoot }] }
    }));
    const { assertWorkspaceRoot, isProjectWorktreeRoot } = await import(
      '../../electron/services/projectPathGuard'
    );

    expect(await assertWorkspaceRoot(projectRoot)).toBe(path.resolve(projectRoot));
    expect(await assertWorkspaceRoot(worktreePath)).toBe(path.resolve(worktreePath));

    expect(isProjectWorktreeRoot(projectRoot, worktreePath)).toBe(true);
    expect(isProjectWorktreeRoot(projectRoot, plainDir)).toBe(false);

    // resetModules даёт свой экземпляр класса ошибки — сверяем по имени, а не по identity.
    const rejects = async (value: string) => {
      await expect(assertWorkspaceRoot(value)).rejects.toMatchObject({ name: 'PathOutsideProjectError' });
    };
    await rejects(plainDir);
    await rejects(fakeWorktree);
    await rejects(os.tmpdir());
    await rejects('');

    vi.doUnmock('../../electron/services/projectRegistry');
    vi.resetModules();
  });
});
