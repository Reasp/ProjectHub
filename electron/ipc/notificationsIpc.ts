import { ipcMain } from 'electron';
import { notificationService } from '../services/notificationService';
import { telegramService, getServiceProcessesRoot, TELEGRAM_BOT_PROCESS_NAME } from '../services/telegramService';
import { processManager } from '../services/processManager';
import { trayService } from '../services/trayService';
import type { NotificationAction } from '../services/notificationTypes';

/**
 * IPC подсистемы уведомлений (TASK-63): матрица доставки «событие × канал», тихие часы,
 * управление демоном Telegram-бота и список служебных процессов ProjectHub.
 */
export function registerNotificationsIpc() {
  ipcMain.handle('notifications:getSettings', async () => ({
    settings: notificationService.getSettings(),
    capabilities: notificationService.getCapabilities(),
    bot: {
      running: telegramService.isBotRunning,
      processId: telegramService.processId,
      configured: telegramService.isConfigured
    }
  }));

  ipcMain.handle('notifications:updateSettings', async (_event, patch: unknown) => {
    return await notificationService.updateSettings(patch);
  });

  ipcMain.handle('notifications:test', async () => {
    return await notificationService.sendTest();
  });

  ipcMain.handle('notifications:navigate', async (_event, action: NotificationAction) => {
    notificationService.sendNavigate(action);
    return true;
  });

  ipcMain.handle('notifications:startBot', async () => {
    const result = await telegramService.startBot();
    return { ...result, running: telegramService.isBotRunning, processId: telegramService.processId };
  });

  ipcMain.handle('notifications:stopBot', async () => {
    await telegramService.stopBot();
    return { ok: true, running: telegramService.isBotRunning, processId: telegramService.processId };
  });

  /** Служебные процессы самого приложения (демон бота) — видны независимо от выбранного проекта. */
  ipcMain.handle('process:listService', async () => {
    return processManager.listServiceProcesses(getServiceProcessesRoot());
  });

  ipcMain.handle('tray:refresh', async () => {
    trayService.refresh();
    return true;
  });
}

export { TELEGRAM_BOT_PROCESS_NAME };
