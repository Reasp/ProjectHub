import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { RemoteDevice } from '../../src/types/remote';

/**
 * Поверхность безопасности Remote Control (TASK-58, decision-14 п.8): PIN/ключ сопряжения,
 * формат пакетов (JSON, ping/pong, rpc_req) и read-only режим. Сервис слушает 0.0.0.0
 * (мобильные клиенты в LAN), поэтому в тесте сокеты не поднимаются реально — вместо этого
 * вызываются те же обработчики (`handleIncomingClientMessage`, `isValidPairingCredentials`),
 * которые вызвал бы `wss.on('connection', ...)`, с замоканным `reply`/устройством.
 */

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-remote-'));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => true }
}));

const { remoteControlService } = await import('../../electron/services/remoteControlService');

interface RemoteControlServiceInternal {
  isValidPairingCredentials: (pin: string | null | undefined, key: string | null | undefined) => boolean;
  handleIncomingClientMessage: (deviceId: string, raw: unknown, reply: (resp: any) => void) => Promise<void>;
  connectedDevices: Map<string, RemoteDevice>;
  readOnly: boolean;
}

const svc = remoteControlService as unknown as RemoteControlServiceInternal;

function fakeDevice(id: string, isApproved: boolean): RemoteDevice {
  return {
    id,
    name: 'Test Device',
    ip: '127.0.0.1',
    mode: 'lan',
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    userAgent: 'vitest',
    isApproved
  };
}

describe('remoteControlService: PIN/ключ сопряжения', () => {
  it('принимает верный PIN', () => {
    const { pairingPin } = remoteControlService.getStatus();
    expect(svc.isValidPairingCredentials(pairingPin, null)).toBe(true);
  });

  it('принимает верный секретный ключ', () => {
    const { secretKey } = remoteControlService.getStatus();
    expect(svc.isValidPairingCredentials(null, secretKey)).toBe(true);
  });

  it('отклоняет неверные PIN и ключ', () => {
    expect(svc.isValidPairingCredentials('000000', 'deadbeefdeadbeef')).toBe(false);
    expect(svc.isValidPairingCredentials(null, null)).toBe(false);
    expect(svc.isValidPairingCredentials(undefined, undefined)).toBe(false);
  });

  it('regenerateToken делает старые PIN и ключ недействительными', () => {
    const before = remoteControlService.getStatus();
    remoteControlService.regenerateToken();
    expect(svc.isValidPairingCredentials(before.pairingPin, before.secretKey)).toBe(false);
  });
});

describe('remoteControlService: формат пакетов и авторизация устройств', () => {
  const deviceId = 'dev-test-1';

  beforeEach(() => {
    svc.connectedDevices.set(deviceId, fakeDevice(deviceId, true));
    svc.readOnly = false;
  });

  afterEach(() => {
    svc.connectedDevices.delete(deviceId);
    svc.readOnly = false;
  });

  it('отвечает ошибкой на некорректный (не-JSON) пакет вместо падения', async () => {
    const replies: any[] = [];
    await svc.handleIncomingClientMessage(deviceId, Buffer.from('not-json{{{'), (r) => replies.push(r));
    expect(replies).toHaveLength(1);
    expect(replies[0].type).toBe('error');
  });

  it('отклоняет rpc_req от неодобренного устройства', async () => {
    svc.connectedDevices.set(deviceId, fakeDevice(deviceId, false));
    const replies: any[] = [];
    const packet = JSON.stringify({ type: 'rpc_req', id: '1', method: 'get_status', params: {} });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));
    expect(replies[0].type).toBe('error');
    expect(replies[0].error).toMatch(/not approved/i);
  });

  it('отвечает pong на ping без требования одобрения устройства', async () => {
    const replies: any[] = [];
    const packet = JSON.stringify({ type: 'ping', id: 'p1' });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));
    expect(replies[0]).toEqual({ type: 'pong', id: 'p1' });
  });

  it('read-only режим блокирует методы записи (rpc_res с ошибкой, а не падение)', async () => {
    svc.readOnly = true;
    const replies: any[] = [];
    const packet = JSON.stringify({
      type: 'rpc_req',
      id: '2',
      method: 'start_process',
      params: { name: 'x', command: 'echo hi' }
    });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));
    expect(replies[0].type).toBe('rpc_res');
    expect(replies[0].error).toMatch(/Read-Only/);
  });

  it('read-only режим не блокирует методы чтения', async () => {
    svc.readOnly = true;
    const replies: any[] = [];
    const packet = JSON.stringify({ type: 'rpc_req', id: '3', method: 'get_status', params: {} });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));
    expect(replies[0].type).toBe('rpc_res');
    expect(replies[0].error).toBeUndefined();
    expect(replies[0].result).toBeDefined();
  });
});

describe('remoteControlService: версия протокола федерации (TASK-58, задел TASK-66)', () => {
  it('свой хост объявляет текущую версию протокола', () => {
    const info = remoteControlService.getHostFederationInfo();
    expect(info.protocolVersion).toBeGreaterThan(0);
  });

  it('isProtocolCompatible принимает совпадающую версию и отклоняет отличающуюся', () => {
    const info = remoteControlService.getHostFederationInfo();
    expect(remoteControlService.isProtocolCompatible({ protocolVersion: info.protocolVersion })).toBe(true);
    expect(remoteControlService.isProtocolCompatible({ protocolVersion: (info.protocolVersion || 1) + 1 })).toBe(false);
  });

  it('registerPeerHost помечает несовместимый по протоколу хост', () => {
    const info = remoteControlService.getHostFederationInfo();
    remoteControlService.registerPeerHost({
      hostId: 'peer-incompatible',
      machineName: 'Old PC',
      platform: 'win32',
      isOnline: true,
      projectsCount: 0,
      activeProcessesCount: 0,
      lastSeen: Date.now(),
      protocolVersion: (info.protocolVersion || 1) + 1
    });
    const hosts = remoteControlService.getFederationHostsList();
    const peer = hosts.find((h) => h.hostId === 'peer-incompatible');
    expect(peer?.protocolIncompatible).toBe(true);
  });
});
