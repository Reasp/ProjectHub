import { ipcMain, shell } from 'electron';
import { mcpServerService } from '../services/mcpServerService';
import { remoteControlService } from '../services/remoteControlService';
import { secretStorageService } from '../services/secretStorageService';
import type { DeviceRights } from '../../src/types/remote';

function isOpenExternalAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function registerMcpIpc() {
  // Shell External Link Security Guard
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !isOpenExternalAllowed(url)) {
      console.warn(`[Security] shell:openExternal rejected URL: ${String(url).slice(0, 200)}`);
      return false;
    }
    try {
      await shell.openExternal(url);
      return true;
    } catch (err) {
      console.error('[Security] shell.openExternal failed:', err);
      return false;
    }
  });

  // SafeStorage & Secret Encryption
  ipcMain.handle('secrets:isEncryptionAvailable', async () => {
    return secretStorageService.isEncryptionAvailable();
  });

  ipcMain.handle('secrets:encrypt', async (_event, text: string) => {
    return secretStorageService.encrypt(text);
  });

  ipcMain.handle('secrets:decrypt', async (_event, cipherText: string) => {
    return secretStorageService.decrypt(cipherText);
  });

  ipcMain.handle('secrets:setSecret', async (_event, { key, value }: { key: string; value: string }) => {
    await secretStorageService.setSecret(key, value);
    return true;
  });

  ipcMain.handle('secrets:getSecret', async (_event, key: string) => {
    return await secretStorageService.getSecret(key);
  });

  ipcMain.handle('secrets:deleteSecret', async (_event, key: string) => {
    return await secretStorageService.deleteSecret(key);
  });

  // Built-in Remote MCP Server
  ipcMain.handle('mcp:getStatus', async () => {
    return mcpServerService.getStatus();
  });

  ipcMain.handle('mcp:toggleServer', async (_event, enable: boolean) => {
    if (enable) {
      await mcpServerService.start();
    } else {
      await mcpServerService.stop();
    }
    return mcpServerService.getStatus();
  });

  ipcMain.handle('mcp:regenerateToken', async () => {
    return mcpServerService.regenerateToken();
  });

  ipcMain.handle('mcp:setAppState', async (_event, state: { activeProject?: any; activeTab?: string }) => {
    mcpServerService.setAppState(state);
    return true;
  });

  // Remote Control (TASK-51)
  ipcMain.handle('remote:getStatus', async () => {
    return remoteControlService.getStatus();
  });

  ipcMain.handle('remote:toggle', async (_event, enable?: boolean) => {
    return await remoteControlService.toggle(enable);
  });

  ipcMain.handle('remote:updateConfig', async (_event, config) => {
    return await remoteControlService.updateConfig(config);
  });

  ipcMain.handle('remote:regenerateToken', async () => {
    return remoteControlService.regenerateToken();
  });

  ipcMain.handle('remote:disconnectDevice', async (_event, deviceId: string) => {
    return remoteControlService.disconnectDevice(deviceId);
  });

  ipcMain.handle('remote:approveDevice', async (_event, deviceId: string) => {
    return remoteControlService.approveDevice(deviceId);
  });

  // Права конкретного устройства (TASK-65): уже, чем глобальный readOnly хоста.
  ipcMain.handle('remote:setDeviceRights', async (_event, deviceId: string, rights: DeviceRights) => {
    return remoteControlService.setDeviceRights(deviceId, rights);
  });

  ipcMain.handle('remote:revokeDevice', async (_event, deviceId: string) => {
    remoteControlService.revokeDeviceToken(deviceId);
    return remoteControlService.getStatus();
  });

  ipcMain.handle('remote:testTelegramNotification', async (_event, text?: string) => {
    return await remoteControlService.sendTelegramNotification(text || 'Тестовое уведомление от ProjectHub! 🚀');
  });

  ipcMain.handle('remote:startTunnel', async () => {
    return await remoteControlService.startTunnel();
  });

  ipcMain.handle('remote:stopTunnel', async () => {
    remoteControlService.stopTunnel();
    return remoteControlService.getStatus();
  });
}
