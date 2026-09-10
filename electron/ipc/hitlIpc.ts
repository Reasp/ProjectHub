import { ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import { hitlService } from '../services/hitlService';
import { appEventBus } from '../services/eventBus';
import type { ApprovalResponse, HitlAuditQuery, HitlDecisionSource } from '../services/hitlTypes';
import type { IpcContext } from './types';

/**
 * IPC единого HITL-контура (TASK-57): очередь ожидающих решений всех сессий, решение по
 * requestId, аудит-лог с фильтрами и экспортом, трансляция шины событий в рендерер (`bus:event`).
 */
export function registerHitlIpc(ctx: IpcContext) {
  appEventBus.subscribe((event) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('bus:event', event);
    }
  });

  ipcMain.handle('hitl:listPending', async (_event, filter?: { projectPath?: string; sessionId?: string }) => {
    const safe = filter && typeof filter === 'object' ? filter : {};
    return hitlService.listPending({
      projectPath: typeof safe.projectPath === 'string' ? safe.projectPath : undefined,
      sessionId: typeof safe.sessionId === 'string' ? safe.sessionId : undefined
    });
  });

  ipcMain.handle('hitl:decide', async (_event, requestId: string, response: ApprovalResponse, source?: Partial<HitlDecisionSource>) => {
    if (typeof requestId !== 'string' || !requestId) return { ok: false, reason: 'not_found' };
    const safeResponse: ApprovalResponse = {
      approved: Boolean(response?.approved),
      text: typeof response?.text === 'string' ? response.text : undefined
    };
    const kind = source?.kind === 'remote' || source?.kind === 'mcp' ? source.kind : 'local';
    const result = hitlService.decide(requestId, safeResponse, { kind, deviceId: source?.deviceId, deviceName: source?.deviceName });
    return result.ok ? { ok: true, sessionId: result.request.sessionId, projectPath: result.request.projectPath } : result;
  });

  ipcMain.handle('hitl:listAudit', async (_event, query?: HitlAuditQuery) => {
    return hitlService.listAudit(query && typeof query === 'object' ? query : {});
  });

  ipcMain.handle('hitl:auditMonths', async () => {
    return hitlService.listAuditMonths();
  });

  ipcMain.handle('hitl:auditInfo', async () => {
    return { auditDir: hitlService.auditDirectory, queueDir: hitlService.queueDirectory, hostId: hitlService.currentHostId };
  });

  ipcMain.handle('hitl:exportAudit', async (_event, query?: HitlAuditQuery, format?: 'jsonl' | 'json' | 'csv') => {
    const fmt: 'jsonl' | 'json' | 'csv' = format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'jsonl';
    const content = await hitlService.exportAudit(query && typeof query === 'object' ? query : {}, fmt);
    const win = ctx.getMainWindow();
    const month = query?.month ? `-${query.month}` : '';
    const dialogOptions = {
      title: 'Экспорт истории решений HITL',
      defaultPath: `hitl-audit${month}.${fmt}`,
      filters: fmt === 'csv'
        ? [{ name: 'CSV', extensions: ['csv'] }]
        : fmt === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'JSON Lines', extensions: ['jsonl'] }]
    };
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
