/**
 * IPC Automations для UI (TASK-74, decision-52 п. 8): список правил с состоянием, сохранение и
 * удаление глобальных правил, вкл/выкл (для проектного правила — подтверждение версии на этой
 * машине), «запустить сейчас», снятие паузы, журнал и настройки. Рендерер — это человек у экрана,
 * поэтому подтверждение проектного правила идёт только отсюда, а не через MCP.
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import { automationEngine } from '../services/automationService';
import type { AutomationsSettings } from '../services/automationStore';

const MAX_LOG_ENTRIES = 500;

export function registerAutomationsIpc(ctx: IpcContext) {
  let pending: NodeJS.Timeout | null = null;
  automationEngine.onChange(() => {
    // Запуски и завершения идут пачками — рендереру хватает одного сигнала на пачку.
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('automations:changed');
    }, 200);
  });

  ipcMain.handle('automations:list', async () => ({
    rules: await automationEngine.list(),
    settings: automationEngine.getSettings()
  }));

  ipcMain.handle('automations:saveRule', async (_event, rule: unknown) => automationEngine.saveGlobalRule(rule));

  ipcMain.handle('automations:deleteRule', async (_event, id: unknown) => automationEngine.deleteGlobalRule(String(id ?? '')));

  ipcMain.handle('automations:setEnabled', async (_event, key: unknown, enabled: unknown, hash?: unknown) =>
    automationEngine.setEnabled(String(key ?? ''), enabled === true, typeof hash === 'string' ? hash : undefined)
  );

  ipcMain.handle('automations:runNow', async (_event, key: unknown) => automationEngine.runNow(String(key ?? ''), 'ui'));

  ipcMain.handle('automations:resume', async (_event, key: unknown) => automationEngine.resume(String(key ?? '')));

  ipcMain.handle('automations:getLog', async (_event, limit?: unknown) => {
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(MAX_LOG_ENTRIES, Math.round(limit))) : 200;
    return automationEngine.readLog(n);
  });

  ipcMain.handle('automations:updateSettings', async (_event, patch: unknown) =>
    automationEngine.updateSettings((patch && typeof patch === 'object' ? patch : {}) as Partial<AutomationsSettings>)
  );
}
