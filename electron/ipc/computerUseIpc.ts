import { ipcMain } from 'electron';
import { computerUseService, type KillSwitchReason } from '../services/computerUseService';
import type { ComputerUseSettings } from '../services/computerPolicy';

/**
 * IPC управления компьютером через MCP-прокси (TASK-82): статус рантайма и kill-switch, настройки
 * (allowlist, режимы, горячая клавиша), диагностика `doctor` и тестовый скриншот.
 */
export function registerComputerUseIpc() {
  ipcMain.handle('computerUse:getStatus', () => computerUseService.getStatus());

  ipcMain.handle('computerUse:getSettings', () => computerUseService.getSettings());

  ipcMain.handle('computerUse:saveSettings', async (_event, patch: Partial<ComputerUseSettings>) => {
    return computerUseService.saveSettings(patch && typeof patch === 'object' ? patch : {});
  });

  ipcMain.handle('computerUse:engageKillSwitch', (_event, reason?: KillSwitchReason) => {
    computerUseService.engageKillSwitch(reason === 'overlay' ? 'overlay' : 'manual');
    return computerUseService.getStatus();
  });

  ipcMain.handle('computerUse:releaseKillSwitch', () => {
    computerUseService.releaseKillSwitch();
    return computerUseService.getStatus();
  });

  ipcMain.handle('computerUse:startRuntime', async () => {
    await computerUseService.ensureRuntime();
    return computerUseService.getStatus();
  });

  ipcMain.handle('computerUse:diagnostics', () => computerUseService.diagnostics());

  ipcMain.handle('computerUse:testScreenshot', () => computerUseService.testScreenshot());
}
