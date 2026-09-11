import { ipcMain } from 'electron';
import { federationClientService } from '../services/federationClientService.js';
import { remoteControlService } from '../services/remoteControlService.js';
import type { PeerTransport } from '../services/federationProtocol.js';

/**
 * IPC hub-режима федерации (TASK-66, decision-11 п.4): список удалённых хостов, сопряжение с
 * ними и единый проброс RPC. Рендерер не открывает сокеты сам — всё через main, как и остальной
 * Remote Control.
 */
export function registerFederationIpc() {
  ipcMain.handle('federation:listPeers', async () => {
    return await federationClientService.listPeers();
  });

  ipcMain.handle(
    'federation:addPeer',
    async (
      _event,
      options: {
        hostId: string;
        machineName?: string;
        transport: PeerTransport;
        address: string;
        secretKey?: string;
        pin?: string;
        autoConnect?: boolean;
      }
    ) => {
      return await federationClientService.addPeer(options);
    }
  );

  ipcMain.handle('federation:removePeer', async (_event, hostId: string) => {
    await federationClientService.removePeer(hostId);
    return await federationClientService.listPeers();
  });

  ipcMain.handle('federation:connectPeer', async (_event, hostId: string) => {
    return await federationClientService.connectPeer(hostId);
  });

  ipcMain.handle('federation:disconnectPeer', async (_event, hostId: string) => {
    return await federationClientService.disconnectPeer(hostId);
  });

  /**
   * Проброс RPC на удалённый хост. Права проверяет он сам по токену нашего устройства —
   * здесь намеренно нет никакой «доверенной» ветки в обход его проверок.
   */
  ipcMain.handle('federation:call', async (_event, hostId: string, method: string, params?: Record<string, unknown>) => {
    return await federationClientService.call(hostId, method, params || {});
  });

  /** Каталог хостов, известных локальному хосту (свой + пришедшие с релея/LAN). */
  ipcMain.handle('federation:getHosts', async () => {
    return remoteControlService.getFederationHostsList();
  });
}
