import { ipcMain, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { getDiagnosticsInfo, collectDiagnosticsArchive } from '../services/diagnosticsService';
import { updaterService } from '../services/updaterService';

/** Экран «Диагностика» и проверка обновлений (TASK-58, decision-14 пп.2 и 4). */
export function registerDiagnosticsIpc() {
  ipcMain.handle('diagnostics:getInfo', async () => {
    return getDiagnosticsInfo();
  });

  ipcMain.handle('diagnostics:collectArchive', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = path.join(
      os.homedir(),
      `projecthub-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    );
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] })
      : await dialog.showSaveDialog({ defaultPath, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      await collectDiagnosticsArchive(result.filePath);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('updater:getStatus', async () => {
    return updaterService.getStatus();
  });

  ipcMain.handle('updater:check', async () => {
    await updaterService.checkForUpdates();
    return updaterService.getStatus();
  });

  ipcMain.handle('updater:installNow', async () => {
    updaterService.installNow();
    return true;
  });
}
