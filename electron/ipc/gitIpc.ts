import { ipcMain } from 'electron';
import { gitService } from '../services/gitService';
import { worktreeService } from '../services/worktreeService';
import { prService } from '../services/prService';
import { assertRegisteredProject, assertWorkspaceRoot } from '../services/projectPathGuard';
import { assertInsideProject } from '../services/pathGuard';
import { runWorktreeInit } from '../services/worktreeInitService';
import type { AddWorktreeOptions, PRCreateOptions } from '../../src/types/electron';

export function registerGitIpc() {
  // Git Core & Status
  ipcMain.handle('git:getLog', async (_event, projectPath: string, maxCount = 30) => {
    return await gitService.getLog(await assertWorkspaceRoot(projectPath), maxCount);
  });

  ipcMain.handle('git:getStatus', async (_event, projectPath: string) => {
    return await gitService.getStatus(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:getRepoDetails', async (_event, projectPath: string) => {
    return await gitService.getRepoDetails(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:unwatch', async (_event, projectPath: string) => {
    gitService.unwatchProjectGit(await assertWorkspaceRoot(projectPath));
    return true;
  });

  ipcMain.handle('git:checkout', async (_event, projectPath: string, branchName: string, createNew = false) => {
    return await gitService.checkoutBranch(await assertWorkspaceRoot(projectPath), branchName, createNew);
  });

  ipcMain.handle('git:createBranch', async (_event, projectPath: string, branchName: string) => {
    return await gitService.createBranch(await assertWorkspaceRoot(projectPath), branchName);
  });

  ipcMain.handle('git:stageFile', async (_event, projectPath: string, filePath: string) => {
    return await gitService.stageFile(await assertWorkspaceRoot(projectPath), filePath);
  });

  ipcMain.handle('git:unstageFile', async (_event, projectPath: string, filePath: string) => {
    return await gitService.unstageFile(await assertWorkspaceRoot(projectPath), filePath);
  });

  ipcMain.handle('git:stageAll', async (_event, projectPath: string) => {
    return await gitService.stageAll(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:commit', async (_event, projectPath: string, message: string, stageAll = false) => {
    return await gitService.commitChanges(await assertWorkspaceRoot(projectPath), message, stageAll);
  });

  ipcMain.handle('git:getFileDiff', async (_event, projectPath: string, filePath: string, staged = false) => {
    return await gitService.getFileDiff(await assertWorkspaceRoot(projectPath), filePath, staged);
  });

  ipcMain.handle('git:deleteBranch', async (_event, projectPath: string, branchName: string, force = false) => {
    return await gitService.deleteBranch(await assertWorkspaceRoot(projectPath), branchName, force);
  });

  ipcMain.handle('git:mergeBranch', async (_event, projectPath: string, branchName: string) => {
    return await gitService.mergeBranch(await assertWorkspaceRoot(projectPath), branchName);
  });

  ipcMain.handle('git:fetchRemote', async (_event, projectPath: string) => {
    return await gitService.fetchRemote(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:pullRemote', async (_event, projectPath: string) => {
    return await gitService.pullRemote(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:pushRemote', async (_event, projectPath: string) => {
    return await gitService.pushRemote(await assertWorkspaceRoot(projectPath));
  });

  ipcMain.handle('git:discardFileChanges', async (_event, projectPath: string, filePath: string) => {
    return await gitService.discardFileChanges(await assertWorkspaceRoot(projectPath), filePath);
  });

  ipcMain.handle('git:getDiffBetween', async (_event, projectPath: string, targetA: string, targetB?: string, filePath?: string) => {
    return await gitService.getDiffBetween(await assertWorkspaceRoot(projectPath), targetA, targetB, filePath);
  });

  // Git Worktrees (TASK-53)
  ipcMain.handle('git:worktree:list', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.listWorktrees(safeProject);
  });

  ipcMain.handle('git:worktree:add', async (_event, projectPath: string, options: AddWorktreeOptions) => {
    const safeProject = await assertRegisteredProject(projectPath);
    if (options.customPath) {
      assertInsideProject(safeProject, options.customPath);
    }
    const created = await worktreeService.addWorktree(safeProject, options);
    // Политика worktreeInit: node_modules и команды инициализации нового дерева (TASK-62).
    const init = await runWorktreeInit(safeProject, created.path);
    return init.ran ? { ...created, init } : created;
  });

  ipcMain.handle('git:worktree:remove', async (_event, projectPath: string, worktreePath: string, force = false) => {
    const safeProject = await assertRegisteredProject(projectPath);
    assertInsideProject(safeProject, worktreePath);
    return await worktreeService.removeWorktree(safeProject, worktreePath, force);
  });

  ipcMain.handle('git:worktree:prune', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.pruneWorktrees(safeProject);
  });

  ipcMain.handle('git:worktree:getDiff', async (_event, projectPath: string, worktreeBranch: string, baseBranch: string, worktreePath?: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.getWorktreeDiff(safeProject, worktreeBranch, baseBranch, worktreePath);
  });

  ipcMain.handle('git:worktree:merge', async (_event, projectPath: string, worktreeBranch: string, targetBranch: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.mergeWorktree(safeProject, worktreeBranch, targetBranch);
  });

  ipcMain.handle('git:worktree:checkoutFiles', async (_event, projectPath: string, branch: string, filePaths: string[]) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.checkoutFilesFromBranch(safeProject, branch, filePaths);
  });

  ipcMain.handle('git:worktree:findOrphaned', async (_event, projectPath: string, activeTaskIds: string[] = [], activeSwarmIds: string[] = []) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.findOrphanedWorktreesAndBranches(safeProject, activeTaskIds, activeSwarmIds);
  });

  ipcMain.handle('git:worktree:cleanOrphaned', async (_event, projectPath: string, worktreePaths: string[], branches: string[]) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await worktreeService.cleanOrphanedWorktreesAndBranches(safeProject, worktreePaths, branches);
  });

  // Pull & Merge Requests
  ipcMain.handle('pr:getProviderInfo', async (_event, projectPath: string) => {
    return await prService.getProviderInfo(projectPath);
  });

  ipcMain.handle('pr:list', async (_event, projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') => {
    return await prService.listPullRequests(projectPath, state);
  });

  ipcMain.handle('pr:create', async (_event, projectPath: string, options: PRCreateOptions) => {
    return await prService.createPullRequest(projectPath, options);
  });

  ipcMain.handle('pr:getDiff', async (_event, projectPath: string, prNumber: number) => {
    return await prService.getPRDiff(projectPath, prNumber);
  });
}
