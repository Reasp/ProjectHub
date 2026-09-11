import { ipcMain } from 'electron';
import { fileService } from '../services/fileService';
import { assertWorkspaceRoot } from '../services/projectPathGuard';

export function registerFilesIpc() {
  ipcMain.handle('files:readTree', async (_event, projectPath: string, subDir = '', maxDepth = 6) => {
    return await fileService.readTree(await assertWorkspaceRoot(projectPath), subDir, maxDepth);
  });

  ipcMain.handle('files:readContent', async (_event, projectPath: string, relativePath: string) => {
    return await fileService.readFileContent(await assertWorkspaceRoot(projectPath), relativePath);
  });

  ipcMain.handle('files:saveContent', async (_event, projectPath: string, relativePath: string, content: string) => {
    return await fileService.saveFileContent(await assertWorkspaceRoot(projectPath), relativePath, content);
  });

  ipcMain.handle('files:create', async (_event, projectPath: string, relativePath: string, isDirectory = false) => {
    return await fileService.createFileOrFolder(await assertWorkspaceRoot(projectPath), relativePath, isDirectory);
  });

  ipcMain.handle('files:delete', async (_event, projectPath: string, relativePath: string) => {
    return await fileService.deleteFileOrFolder(await assertWorkspaceRoot(projectPath), relativePath);
  });
}
