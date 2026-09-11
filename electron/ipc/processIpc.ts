import { ipcMain } from 'electron';
import { processManager, type StartProcessOptions } from '../services/processManager';
import { assertWorkspaceRoot } from '../services/projectPathGuard';
import { actionConfigService, type ProjectActionConfig } from '../services/actionConfigService';
import { searchProjectDocs, getProjectRagStats } from '../services/ragSearch';
import type { RagSearchOptions } from '../../src/types/electron';

export function registerProcessIpc() {
  // Background Processes & Terminal
  ipcMain.handle(
    'process:start',
    async (_event, projectPath: string, command: string, name: string, options?: StartProcessOptions) => {
      const safeProject = await assertWorkspaceRoot(projectPath);
      // Рабочее дерево процесса тоже должно принадлежать зарегистрированному проекту (TASK-62).
      const workspaceRoot = options?.workspaceRoot ? await assertWorkspaceRoot(options.workspaceRoot) : undefined;
      return await processManager.startProcess(safeProject, command, name, { ...options, workspaceRoot });
    }
  );

  ipcMain.handle('process:stop', async (_event, processId: string) => {
    return await processManager.stopProcess(processId);
  });

  ipcMain.handle('process:restart', async (_event, processId: string) => {
    return await processManager.restartProcess(processId);
  });

  // Порты (TASK-62): кто занял и принудительное освобождение.
  ipcMain.handle('process:listPortOwners', async (_event, port: number) => {
    return await processManager.listPortOwners(Number(port));
  });

  ipcMain.handle('process:releasePort', async (_event, port: number) => {
    return await processManager.releasePort(Number(port));
  });

  ipcMain.handle('process:list', async (_event, projectPath: string) => {
    return await processManager.listProcessesForProject(projectPath);
  });

  ipcMain.handle('process:tailLog', async (_event, projectPath: string, processName: string, lines = 100) => {
    return await processManager.tailProjectLog(projectPath, processName, lines);
  });

  // Action Runner (.projecthub.json)
  ipcMain.handle('actions:getConfig', async (_event, projectPath: string) => {
    return await actionConfigService.getConfig(projectPath);
  });

  ipcMain.handle('actions:saveConfig', async (_event, projectPath: string, config: ProjectActionConfig) => {
    return await actionConfigService.saveConfig(projectPath, config);
  });

  // Vector RAG
  ipcMain.handle('rag:search', async (_event, options: RagSearchOptions) => {
    return await searchProjectDocs(options);
  });

  ipcMain.handle('rag:getStats', async (_event, projectPath: string) => {
    return await getProjectRagStats(projectPath);
  });
}
