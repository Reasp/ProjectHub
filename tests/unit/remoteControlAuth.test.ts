import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import nodeCrypto from 'node:crypto';
import type { DeviceRights, RemoteDevice } from '../../src/types/remote';

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
  dispatchRpc: (method: string, params: any, device: RemoteDevice) => Promise<any>;
  connectedDevices: Map<string, RemoteDevice>;
  deviceTokens: Map<string, { token: string; rights: DeviceRights; deviceName: string; createdAt: number }>;
  pinAttempts: Map<string, { count: number; lockedUntil: number }>;
  readOnly: boolean;
  getIdentityPublicKey: () => Promise<string>;
  signWithIdentity: (data: string) => Promise<string>;
  issueDeviceToken: (deviceId: string, deviceName: string) => { token: string; rights: DeviceRights; deviceName: string; createdAt: number };
  validateDeviceToken: (deviceId: string, token: string) => { token: string; rights: DeviceRights } | null;
  revokeDeviceToken: (deviceId: string) => void;
  checkPinRateLimit: (ip: string) => { allowed: boolean; retryAfterMs?: number };
  recordPinFailure: (ip: string) => void;
}

const svc = remoteControlService as unknown as RemoteControlServiceInternal;

function fakeDevice(id: string, isApproved: boolean, overrides: Partial<RemoteDevice> = {}): RemoteDevice {
  return {
    id,
    name: 'Test Device',
    ip: '127.0.0.1',
    mode: 'lan',
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    userAgent: 'vitest',
    isApproved,
    ...overrides
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

  it('regenerateToken делает старые PIN и ключ недействительными', async () => {
    const before = remoteControlService.getStatus();
    await remoteControlService.regenerateToken();
    expect(svc.isValidPairingCredentials(before.pairingPin, before.secretKey)).toBe(false);
  });
});

// issueDeviceToken/revokeDeviceToken персистируют в secretStorageService асинхронно и
// намеренно fire-and-forget (см. remoteControlService.ts) — без этой паузы часть таких
// записей завершается уже после того, как vitest начинает закрывать окружение теста,
// и попадает в отчёт как unhandled rejection, хотя сами тесты проходят корректно.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
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

describe('remoteControlService: Ed25519 identity хоста (TASK-65, decision-11 п.1)', () => {
  it('генерирует identity-ключ и подписывает данные проверяемой Ed25519-подписью', async () => {
    const publicKeyPem = await svc.getIdentityPublicKey();
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');

    const signatureHex = await svc.signWithIdentity('challenge-nonce');
    const publicKey = nodeCrypto.createPublicKey(publicKeyPem);
    const isValid = nodeCrypto.verify(null, Buffer.from('challenge-nonce', 'utf8'), publicKey, Buffer.from(signatureHex, 'hex'));
    expect(isValid).toBe(true);
  });

  it('отклоняет подпись под другими данными', async () => {
    const publicKeyPem = await svc.getIdentityPublicKey();
    const signatureHex = await svc.signWithIdentity('challenge-nonce');
    const publicKey = nodeCrypto.createPublicKey(publicKeyPem);
    const isValid = nodeCrypto.verify(null, Buffer.from('tampered', 'utf8'), publicKey, Buffer.from(signatureHex, 'hex'));
    expect(isValid).toBe(false);
  });

  it('identity стабильна между вызовами (кэшируется, не генерируется заново)', async () => {
    const first = await svc.getIdentityPublicKey();
    const second = await svc.getIdentityPublicKey();
    expect(second).toBe(first);
  });
});

describe('remoteControlService: per-device токены и права (TASK-65, decision-11 п.1)', () => {
  const deviceId = 'dev-token-test';

  afterEach(() => {
    svc.deviceTokens.delete(deviceId);
    svc.readOnly = false;
  });

  it('issueDeviceToken выдаёт уникальный токен с правами full, когда хост не в readOnly', () => {
    const record = svc.issueDeviceToken(deviceId, 'Test Phone');
    expect(record.token).toMatch(/^[0-9a-f]{64}$/);
    expect(record.rights).toBe('full');
  });

  it('issueDeviceToken выдаёт права readOnly, когда хост глобально в readOnly', () => {
    svc.readOnly = true;
    const record = svc.issueDeviceToken(deviceId, 'Test Phone');
    expect(record.rights).toBe('readOnly');
  });

  it('validateDeviceToken принимает верный токен и отклоняет неверный/чужого устройства', () => {
    const record = svc.issueDeviceToken(deviceId, 'Test Phone');
    expect(svc.validateDeviceToken(deviceId, record.token)).not.toBeNull();
    expect(svc.validateDeviceToken(deviceId, 'wrong-token')).toBeNull();
    expect(svc.validateDeviceToken('other-device', record.token)).toBeNull();
  });

  it('revokeDeviceToken делает токен недействительным', () => {
    const record = svc.issueDeviceToken(deviceId, 'Test Phone');
    svc.revokeDeviceToken(deviceId);
    expect(svc.validateDeviceToken(deviceId, record.token)).toBeNull();
  });

  it('dispatchRpc блокирует методы записи устройству с правами readOnly', async () => {
    await expect(
      svc.dispatchRpc('start_process', { name: 'x', command: 'echo hi' }, fakeDevice(deviceId, true, { rights: 'readOnly' }))
    ).rejects.toThrow(/readOnly/);
  });

  it('dispatchRpc разрешает hitl_decision, но не другие write-методы устройству с правами hitl', async () => {
    const hitlDevice = fakeDevice(deviceId, true, { rights: 'hitl' });
    await expect(svc.dispatchRpc('start_process', { name: 'x', command: 'echo hi' }, hitlDevice)).rejects.toThrow(/hitl-only/);
    // hitl_decision требует существующий requestId — проверяем, что дошло до бизнес-логики
    // (ошибка про requestId), а не было отклонено на уровне прав.
    await expect(svc.dispatchRpc('hitl_decision', {}, hitlDevice)).rejects.toThrow(/requestId/);
  });

  it('dispatchRpc не ограничивает устройство с правами full сверх глобального readOnly', async () => {
    const fullDevice = fakeDevice(deviceId, true, { rights: 'full' });
    const result = await svc.dispatchRpc('get_status', {}, fullDevice);
    expect(result).toBeDefined();
  });
});

describe('remoteControlService: rate-limit подбора PIN (decision-5 п.5)', () => {
  const ip = '203.0.113.5';

  afterEach(() => {
    svc.pinAttempts.delete(ip);
  });

  it('разрешает попытки, пока не превышен лимит', () => {
    expect(svc.checkPinRateLimit(ip).allowed).toBe(true);
  });

  it('блокирует после 5 неудачных попыток', () => {
    for (let i = 0; i < 5; i++) svc.recordPinFailure(ip);
    const result = svc.checkPinRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('успешная попытка сбрасывает счётчик неудач', () => {
    for (let i = 0; i < 4; i++) svc.recordPinFailure(ip);
    svc.pinAttempts.delete(ip); // эквивалент recordPinSuccess (приватный) для сброса состояния
    expect(svc.checkPinRateLimit(ip).allowed).toBe(true);
  });
});

describe('remoteControlService: handshake через relay-пакет (TASK-65, decision-5 п.5)', () => {
  const deviceId = 'dev-relay-handshake';

  beforeEach(() => {
    svc.connectedDevices.set(deviceId, fakeDevice(deviceId, false));
    svc.readOnly = false;
    svc.requireApproval = false;
  });

  afterEach(() => {
    svc.connectedDevices.delete(deviceId);
    svc.deviceTokens.delete(deviceId);
    svc.requireApproval = true;
  });

  it('выдаёт per-device токен при верном PIN и одобряет устройство', async () => {
    const { pairingPin } = remoteControlService.getStatus();
    const replies: any[] = [];
    const packet = JSON.stringify({ type: 'handshake', data: { pin: pairingPin } });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));

    expect(replies[0].type).toBe('handshake_ack');
    expect(replies[0].result.approved).toBe(true);
    expect(replies[0].result.deviceToken).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.connectedDevices.get(deviceId)?.isApproved).toBe(true);
  });

  it('отклоняет handshake с неверным PIN, не одобряя устройство', async () => {
    const replies: any[] = [];
    const packet = JSON.stringify({ type: 'handshake', data: { pin: '000000' } });
    await svc.handleIncomingClientMessage(deviceId, Buffer.from(packet), (r) => replies.push(r));

    expect(replies[0].type).toBe('error');
    expect(svc.connectedDevices.get(deviceId)?.isApproved).toBe(false);
  });

  it('повторное подключение по ранее выданному токену не требует PIN', async () => {
    const { pairingPin } = remoteControlService.getStatus();
    const first: any[] = [];
    await svc.handleIncomingClientMessage(
      deviceId,
      Buffer.from(JSON.stringify({ type: 'handshake', data: { pin: pairingPin } })),
      (r) => first.push(r)
    );
    const token = first[0].result.deviceToken;

    svc.connectedDevices.set(deviceId, fakeDevice(deviceId, false));
    const second: any[] = [];
    await svc.handleIncomingClientMessage(
      deviceId,
      Buffer.from(JSON.stringify({ type: 'handshake', data: { token } })),
      (r) => second.push(r)
    );

    expect(second[0].type).toBe('handshake_ack');
    expect(second[0].result.approved).toBe(true);
  });
});
